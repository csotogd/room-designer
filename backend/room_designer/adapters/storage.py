import asyncio
import json
import logging
import os
import re
import tempfile
from pathlib import Path
from uuid import uuid4

import httpx

from room_designer.adapters.reliability import retry_async
from room_designer.domain.room import Json, empty_state, finite, validate_room


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path: Path, value) -> None:
    atomic_write(path, json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2).encode())


def backup_path(path: Path, index: int = 0) -> Path:
    suffix = ".bak" if index == 0 else f".bak.{index}"
    return path.with_name(path.name + suffix)


def rotate_backup(path: Path, keep: int = 3) -> None:
    if keep < 1:
        return
    for index in range(keep - 1, 0, -1):
        previous, target = backup_path(path, index - 1), backup_path(path, index)
        if previous.exists():
            os.replace(previous, target)
    if path.exists():
        atomic_write(backup_path(path), path.read_bytes())


class FileRoomRepository:
    def __init__(self, path: Path, backup_count: int = 3):
        if backup_count < 1:
            raise ValueError("backup_count debe ser positivo")
        self.path = path
        self.backup_count = backup_count

    async def load(self) -> Json:
        def read():
            try:
                state = json.loads(self.path.read_text())
            except FileNotFoundError:
                return empty_state()
            if state.get("version") != 1:
                raise ValueError("Versión de room file no soportada")
            if not all(isinstance(state.get(k), list) for k in ("items", "openings", "log")):
                raise ValueError("Estado de habitación inválido")
            if state.get("room"):
                validate_room(state["room"], state["openings"])
            return state

        return await asyncio.to_thread(read)

    async def save(self, state: Json) -> None:
        # Do not cancel an in-progress atomic replacement; callers serialize complete turns.
        await asyncio.to_thread(rotate_backup, self.path, self.backup_count)
        write_json(self.path, state)

    async def restore_backup(self, index: int = 0) -> None:
        backup = backup_path(self.path, index)
        if not backup.exists():
            raise FileNotFoundError(f"No existe la copia {backup}")
        await asyncio.to_thread(atomic_write, self.path, backup.read_bytes())


def read_catalog(path: Path) -> dict[str, Json]:
    products = {}
    skipped = 0
    for raw in json.loads(path.read_text()):
        if not raw.get("id") or raw["id"] in products:
            raise ValueError("ID de catálogo ausente o duplicado")
        # Una fila inválida no puede impedir el arranque del servicio: se
        # omite con aviso y el resto del catálogo sigue disponible.
        try:
            for key in ("width", "depth", "height"):
                if finite(raw.get(key), key) <= 0:
                    raise ValueError(f"{key} no positivo")
        except ValueError as error:
            skipped += 1
            logging.getLogger(__name__).warning("Producto omitido %s: %s", raw["id"], error)
            continue
        products[raw["id"]] = {**raw, **raw.get("assets", {})}
    if not products:
        raise ValueError("Catálogo sin productos válidos")
    if skipped:
        logging.getLogger(__name__).warning("Catálogo cargado con %d productos omitidos", skipped)
    return products


class HttpProductSearch:
    def __init__(self, client: httpx.AsyncClient, base_url: str, catalog: dict[str, Json]):
        self.client, self.base_url, self.catalog = client, base_url.rstrip("/"), catalog

    async def search(self, query: str, limit: int = 20) -> list[Json]:
        async def request():
            response = await self.client.get(
                self.base_url + "/search", params={"q": query, "limit": limit}, timeout=5
            )
            response.raise_for_status()
            return response

        response = await retry_async(request)
        return [
            dict(self.catalog[h["id"]], score=h["score"])
            for h in response.json()["results"]
            if h["id"] in self.catalog
        ]


class LocalScreenshots:
    def __init__(self, directory: Path):
        self.directory = directory

    async def save(self, request_id: str, png: bytes) -> str:
        safe_id = re.sub(r"[^\w.-]", "", request_id)[:64] or uuid4().hex
        path = self.directory / f"{safe_id}.png"
        await asyncio.to_thread(atomic_write, path, png)
        return str(path)


class GcsScreenshots:
    def __init__(self, client: httpx.AsyncClient, bucket: str):
        self.client, self.bucket = client, bucket

    async def save(self, request_id: str, png: bytes) -> str:
        safe_id = re.sub(r"[^\w.-]", "", request_id)[:64] or uuid4().hex
        name = f"designer/screenshots/{safe_id}.png"

        async def upload():
            response = await self.client.get(
                "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                headers={"Metadata-Flavor": "Google"},
                timeout=3,
            )
            response.raise_for_status()
            token = response.json()["access_token"]
            response = await self.client.post(
                f"https://storage.googleapis.com/upload/storage/v1/b/{self.bucket}/o",
                params={"uploadType": "media", "name": name},
                content=png,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "image/png"},
                timeout=15,
            )
            response.raise_for_status()

        await retry_async(upload)
        return f"gs://{self.bucket}/{name}"
