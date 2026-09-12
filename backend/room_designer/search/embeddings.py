import asyncio
import io
import logging
import re
import unicodedata
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from room_designer.domain.room import Json
from room_designer.search.index import unit


def mixed_hash(text: str) -> int:
    value = 0x811C9DC5
    for char in text:
        value = ((value ^ ord(char)) * 0x01000193) & 0xFFFFFFFF
    value = ((value ^ (value >> 16)) * 0x85EBCA6B) & 0xFFFFFFFF
    value = ((value ^ (value >> 13)) * 0xC2B2AE35) & 0xFFFFFFFF
    return (value ^ (value >> 16)) & 0xFFFFFFFF


class HashingEmbedder:
    version = "hashing-v3"

    def __init__(self, dim: int = 1024):
        if dim <= 0:
            raise ValueError("Dimensión no positiva")
        self.dim = dim

    def add_text(self, vector, text: str, weight: float):
        text = "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))
        for word in re.findall(r"[a-z0-9]+", text):
            tokens = [word] + ["#" + word[i : i + 3] for i in range(len(word) - 2)]
            for token in tokens:
                vector[mixed_hash(token) % self.dim] += (
                    1 if mixed_hash("s" + token) % 2 == 0 else -1
                ) * weight

    async def embed_query(self, query: str):
        vector = np.zeros(self.dim, dtype=np.float32)
        self.add_text(vector, query, 1)
        return vector

    async def embed_products(self, products: list[Json]):
        result = []
        for p in products:
            vector = np.zeros(self.dim, dtype=np.float32)
            price = p["price"]
            bucket = (
                "barato" if price < 50 else "medio" if price < 150 else "caro" if price < 400 else "premium"
            )
            price_text = f"precio {bucket} {int(price / 50 + 0.5) * 50} eur" if price > 0 else ""
            self.add_text(vector, p["name"], 3)
            self.add_text(vector, p["description"] + " " + price_text, 1)
            result.append(vector)
        return result


class JinaEmbedder:
    version, dim = "jina-clip-v2", 1024

    def __init__(self, client: httpx.AsyncClient, key: str):
        if not key:
            raise ValueError("JINA_API_KEY no definida")
        self.client, self.key = client, key

    async def request(self, inputs):
        response = await self.client.post(
            "https://api.jina.ai/v1/embeddings",
            headers={"Authorization": f"Bearer {self.key}"},
            json={"model": self.version, "dimensions": self.dim, "input": inputs},
            timeout=120,
        )
        response.raise_for_status()
        rows = sorted(response.json()["data"], key=lambda r: r["index"])
        if [r["index"] for r in rows] != list(range(len(inputs))):
            raise ValueError("Respuesta de Jina incompleta")
        return [unit(r["embedding"]) for r in rows]

    async def embed_query(self, query):
        return (await self.request([{"text": query}]))[0]

    async def embed_products(self, products):
        output = []
        for offset in range(0, len(products), 16):
            inputs, spans = [], []
            for p in products[offset : offset + 16]:
                spans.append((len(inputs), bool(p.get("imageUrl"))))
                inputs.append({"text": product_text(p)})
                if p.get("imageUrl"):
                    inputs.append({"image": p["imageUrl"]})
            vectors = await self.request(inputs)
            output.extend((vectors[i] + vectors[i + 1]) / 2 if photo else vectors[i] for i, photo in spans)
        return output


def product_text(p):
    return f"{p['name']}. {p['description']}. Precio: {int(p['price'] + 0.5)} EUR"


class ClipEmbedder:
    dim = 512

    def __init__(
        self,
        client: httpx.AsyncClient,
        model: str = "openai/clip-vit-base-patch32",
        public_dir: Path = Path("public"),
        image_weight: float = 0.25,
    ):
        if not 0 <= image_weight <= 1:
            raise ValueError("SEARCH_CLIP_IMAGE_WEIGHT debe estar entre 0 y 1")
        self.client, self.model_id, self.public_dir, self.weight = (
            client,
            model,
            public_dir.resolve(),
            image_weight,
        )
        # PyTorch and the old quantized ONNX embeddings are different vector spaces.
        self.version = f"clip-python-{model}-w{image_weight}"
        self.backend = None
        self.lock = asyncio.Lock()

    async def load(self):
        async with self.lock:
            if self.backend is None:

                def load():
                    try:
                        from transformers import CLIPModel, CLIPProcessor
                    except ImportError as error:
                        raise RuntimeError("Instala el extra Python [clip] para CLIP/hybrid") from error
                    return (
                        CLIPModel.from_pretrained(self.model_id).eval(),
                        CLIPProcessor.from_pretrained(self.model_id),
                    )

                self.backend = await asyncio.to_thread(load)
        return self.backend

    async def features(self, text=None, image=None):
        model, processor = await self.load()

        def embed():
            import torch

            with torch.inference_mode():
                if text is not None:
                    inputs = processor(
                        text=[text[:400]], padding=True, truncation=True, max_length=77, return_tensors="pt"
                    )
                    result = model.get_text_features(**inputs)
                else:
                    result = model.get_image_features(**processor(images=image, return_tensors="pt"))
                return unit(result[0].cpu().numpy())

        return await asyncio.to_thread(embed)

    async def embed_query(self, query):
        return await self.features(text=f"a photo of {query}, furniture product")

    async def embed_products(self, products):
        output = []
        for p in products:
            text = await self.features(text=product_text(p))
            photo = None
            if p.get("imageUrl"):
                try:
                    from room_designer.adapters.vision import ImageLoader

                    part = await ImageLoader(self.client, self.public_dir).part(p["imageUrl"])
                    with Image.open(io.BytesIO(part.inline_data.data)) as image:
                        photo = await self.features(image=image.convert("RGB"))
                except (OSError, ValueError, httpx.HTTPError):
                    logging.getLogger(__name__).warning("Foto no embebible: %s", p["id"])
            output.append((1 - self.weight) * text + self.weight * photo if photo is not None else text)
        return output


class HybridEmbedder:
    def __init__(self, clip, weight=0.6, lexical=None):
        if not 0 <= weight <= 1:
            raise ValueError("SEARCH_HYBRID_LEX_WEIGHT debe estar entre 0 y 1")
        self.lexical, self.clip, self.weight = lexical or HashingEmbedder(), clip, weight
        self.dim = self.lexical.dim + clip.dim
        self.version = f"hybrid-{self.lexical.version}+{clip.version}-lex{weight}"

    def combine(self, a, b):
        return np.concatenate([unit(a) * np.sqrt(self.weight), unit(b) * np.sqrt(1 - self.weight)])

    async def embed_query(self, query):
        a, b = await asyncio.gather(self.lexical.embed_query(query), self.clip.embed_query(query))
        return self.combine(a, b)

    async def embed_products(self, products):
        a, b = await asyncio.gather(self.lexical.embed_products(products), self.clip.embed_products(products))
        return [self.combine(x, y) for x, y in zip(a, b, strict=True)]


def create_embedder(env, client):
    provider = env.get("EMBEDDINGS_PROVIDER", "hybrid")
    if provider == "hashing":
        return HashingEmbedder()
    if provider == "jina":
        return JinaEmbedder(client, env.get("JINA_API_KEY", ""))
    if provider not in ("clip", "hybrid"):
        raise ValueError(f"EMBEDDINGS_PROVIDER desconocido: {provider}")
    clip = ClipEmbedder(
        client,
        env.get("SEARCH_CLIP_MODEL", "openai/clip-vit-base-patch32"),
        Path(env.get("CATALOG_PUBLIC_DIR", "public")),
        float(env.get("SEARCH_CLIP_IMAGE_WEIGHT", 0.25)),
    )
    return (
        clip if provider == "clip" else HybridEmbedder(clip, float(env.get("SEARCH_HYBRID_LEX_WEIGHT", 0.6)))
    )
