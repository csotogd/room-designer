"""Image selection, mesh providers and ADK visual quality review."""

import asyncio
import io
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
from google.genai import types
from PIL import Image

from room_designer.adapters.adk_runtime import create_model, run_agent
from room_designer.adapters.reliability import retry_async
from room_designer.adapters.vision import parse_json


def packshot_score(data: bytes) -> float:
    with Image.open(io.BytesIO(data)) as source:
        image = np.asarray(source.convert("RGB").resize((64, 64)), dtype=float).mean(axis=2)
    mask = np.ones((64, 64), dtype=bool)
    mask[4:60, 4:60] = False
    border, center = image[mask], image[20:44, 20:44]
    evidence = center.std() + abs(center.mean() - border.mean())
    return float(border.mean() - 2 * border.std() + min(evidence, 80) - (150 if evidence < 25 else 0))


async def download(client, url, headers=None) -> bytes:
    async def get():
        response = await client.get(url, headers=headers, timeout=120, follow_redirects=True)
        response.raise_for_status()
        return response.content

    return await retry_async(get, base_delay=1.5, max_delay=3)


class TripoGenerator:
    def __init__(self, client, key):
        if not key:
            raise ValueError("TRIPO_API_KEY no definida")
        self.client, self.key = client, key

    async def call(self, path, **kwargs):
        method = "POST" if kwargs else "GET"

        async def request():
            response = await self.client.request(
                method,
                "https://api.tripo3d.ai/v2/openapi" + path,
                headers={"Authorization": f"Bearer {self.key}"},
                timeout=60,
                **kwargs,
            )
            response.raise_for_status()
            return response

        # Reintentar el sondeo es seguro; reintentar un POST sin clave de
        # idempotencia del proveedor podría crear dos tareas de pago.
        response = await retry_async(request) if method == "GET" else await request()
        data = response.json()
        if data.get("code") != 0:
            raise ValueError("Tripo: " + data.get("message", "error"))
        return data["data"]

    async def generate(self, image: Path):
        with Image.open(image) as source:
            output = io.BytesIO()
            source.convert("RGB").save(output, format="JPEG")
        upload = await self.call(
            "/upload/sts", files={"file": ("product.jpg", output.getvalue(), "image/jpeg")}
        )
        task = await self.call(
            "/task",
            json={
                "type": "image_to_model",
                "file": {"type": "jpg", "file_token": upload["image_token"]},
                "texture": True,
                "pbr": True,
            },
        )
        async with asyncio.timeout(600):
            while True:
                await asyncio.sleep(4)
                status = await self.call("/task/" + task["task_id"])
                if status["status"] in ("failed", "cancelled", "banned", "expired"):
                    raise ValueError("Tripo terminó en " + status["status"])
                if status["status"] == "success":
                    out = status["output"]
                    url = out.get("pbr_model") or out.get("model")
                    if not url:
                        raise ValueError("Tripo terminó sin modelo")
                    model = await download(self.client, url)
                    preview = (
                        await download(self.client, out["rendered_image"])
                        if out.get("rendered_image")
                        else None
                    )
                    return model, preview


class TrellisGenerator:
    def __init__(self, token=None, version=2):
        self.token, self.version = token, version

    async def generate(self, image: Path):
        # Gradio's sync SDK runs outside the event loop. Each job has its own server session.
        def generate():
            try:
                from gradio_client import Client, handle_file
            except ImportError as error:
                raise RuntimeError("Instala el extra Python [mesh] para TRELLIS") from error
            space = "microsoft/TRELLIS.2" if self.version == 2 else "trellis-community/TRELLIS"
            client = Client(space, token=self.token)

            def predict(endpoint, **kwargs):
                job = client.submit(api_name=endpoint, **kwargs)
                try:
                    return job.result(timeout=720)
                except TimeoutError:
                    job.cancel()
                    raise

            try:
                try:
                    predict("/start_session")
                except (ValueError, RuntimeError):
                    pass
                processed = predict(
                    "/preprocess_image",
                    **{"input" if self.version == 2 else "image": handle_file(str(image))},
                )
                if isinstance(processed, (list, tuple)):
                    processed = processed[0]
                if self.version == 2:
                    predict(
                        "/image_to_3d",
                        image=processed,
                        seed=42,
                        resolution="1024",
                        ss_guidance_strength=7.5,
                        ss_guidance_rescale=0.7,
                        ss_sampling_steps=12,
                        ss_rescale_t=5.0,
                        shape_slat_guidance_strength=7.5,
                        shape_slat_guidance_rescale=0.5,
                        shape_slat_sampling_steps=12,
                        shape_slat_rescale_t=3.0,
                        tex_slat_guidance_strength=1.0,
                        tex_slat_guidance_rescale=0.0,
                        tex_slat_sampling_steps=12,
                        tex_slat_rescale_t=3.0,
                    )
                    result = predict("/extract_glb", decimation_target=100000, texture_size=1024)
                else:
                    result = predict(
                        "/generate_and_extract_glb",
                        image=processed,
                        multiimages=[],
                        seed=42,
                        ss_guidance_strength=7.5,
                        ss_sampling_steps=12,
                        slat_guidance_strength=3.0,
                        slat_sampling_steps=12,
                        multiimage_algo="stochastic",
                        mesh_simplify=0.95,
                        texture_size=1024,
                    )
                for entry in result if isinstance(result, (list, tuple)) else [result]:
                    path = entry.get("path", entry.get("url")) if isinstance(entry, dict) else entry
                    if (
                        isinstance(path, str)
                        and urlparse(path).path.endswith(".glb")
                        and Path(path).is_file()
                    ):
                        return Path(path).read_bytes(), None
                raise ValueError("TRELLIS no devolvió un fichero GLB")
            finally:
                client.close()

        return await asyncio.to_thread(generate)


class ModelJudge:
    def __init__(self, config):
        self.config = config

    async def judge(self, product, store):
        if self.config is None or self.config.provider == "fake":
            return {"status": "approved", "judge": "noop", "reason": "sin juez configurado"}
        # A render is essential: the packshot alone cannot prove mesh quality.
        if not product.get("previewPath") or not product.get("generationImagePath"):
            return {
                "status": "pending",
                "reason": "Se necesitan packshot y render del modelo",
                "judge": self.config.model,
            }
        parts = [types.Part(text="Compara el producto original con el render generado, en ese orden.")]
        for field in ("generationImagePath", "previewPath"):
            with Image.open(store.absolute(product[field])) as image:
                out = io.BytesIO()
                image.convert("RGB").save(out, "JPEG")
                parts.append(types.Part.from_bytes(data=out.getvalue(), mime_type="image/jpeg"))
        async with asyncio.timeout(180):
            raw = await run_agent(
                create_model(self.config),
                'Devuelve solo JSON {"status":"approved" o "rejected", "reason":"motivo"}. '
                "Rechaza geometría rota, objetos fusionados o modelos que no correspondan al producto.",
                parts,
                [],
            )
        result = parse_json(raw)
        if result.get("status") not in ("approved", "rejected") or not isinstance(result.get("reason"), str):
            raise ValueError("Veredicto inválido")
        return {"status": result["status"], "reason": result["reason"], "judge": self.config.model}
