"""Copy-on-write cosine index; a failed sync never changes the live snapshot."""

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Protocol
from uuid import uuid4

import numpy as np

from room_designer.adapters.storage import atomic_write, backup_path, rotate_backup, write_json
from room_designer.domain.room import Json, finite


class Embedder(Protocol):
    version: str
    dim: int

    async def embed_products(self, products: list[Json]) -> list[np.ndarray]: ...
    async def embed_query(self, query: str) -> np.ndarray: ...


def unit(vector) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float32)
    if vector.ndim != 1 or not np.all(np.isfinite(vector)):
        raise ValueError("Vector no finito o no unidimensional")
    return vector / (np.linalg.norm(vector) or 1)


class SnapshotStore:
    """Reads the original Node JSON + little-endian float32 format."""

    def __init__(self, directory: Path, backup_count: int = 3):
        self.directory, self.backup_count = directory, backup_count

    def _load(self, metadata_path: Path):
        meta = json.loads(metadata_path.read_text())
        path = (self.directory / meta["vectorsFile"]).resolve()
        if not path.is_relative_to(self.directory.resolve()):
            raise ValueError("Ruta de vectores inválida")
        vectors = np.frombuffer(path.read_bytes(), dtype="<f4").copy()
        if len(vectors) != len(meta["records"]) * meta["dim"] or not np.all(np.isfinite(vectors)):
            raise ValueError("Snapshot de búsqueda corrupto")
        return meta, vectors.reshape((-1, meta["dim"]))

    def load(self):
        paths = [self.directory / "index.json"] + [
            backup_path(self.directory / "index.json", index) for index in range(self.backup_count)
        ]
        for path in paths:
            try:
                return self._load(path)
            except (FileNotFoundError, json.JSONDecodeError, KeyError, OSError, TypeError, ValueError):
                continue
        return None

    def save(self, version: str, dim: int, ids: list[str], hashes: dict, vectors: np.ndarray):
        name = f"vectors-{uuid4().hex}.f32"
        atomic_write(self.directory / name, vectors.astype("<f4").tobytes())
        rotate_backup(self.directory / "index.json", self.backup_count)
        write_json(
            self.directory / "index.json",
            {
                "embedderVersion": version,
                "dim": dim,
                "vectorsFile": name,
                "records": [{"id": i, "contentHash": hashes[i]} for i in ids],
            },
        )

class SearchIndex:
    def __init__(self, embedder: Embedder, store: SnapshotStore | None = None):
        self.embedder, self.store = embedder, store
        self.ids: list[str] = []
        self.hashes: dict[str, str] = {}
        self.vectors = np.empty((0, embedder.dim), dtype=np.float32)
        self.lock = asyncio.Lock()

    async def restore(self) -> bool:
        saved = self.store.load() if self.store else None
        if saved is None:
            return False
        meta, vectors = saved
        if meta["embedderVersion"] != self.embedder.version or meta["dim"] != self.embedder.dim:
            return False
        ids = [r["id"] for r in meta["records"]]
        if len(ids) != len(set(ids)):
            raise ValueError("IDs duplicados en el snapshot")
        self.ids, self.hashes = ids, {r["id"]: r["contentHash"] for r in meta["records"]}
        self.vectors = np.array([unit(v) for v in vectors], dtype=np.float32).reshape((-1, self.embedder.dim))
        return True

    def content_hash(self, product: Json) -> str:
        price = product["price"]
        price_text = str(int(price)) if price == int(price) else str(price)
        fields = [
            self.embedder.version,
            str(self.embedder.dim),
            product["id"],
            product["name"],
            product["description"],
            price_text,
            product.get("imageUrl") or "",
        ]
        return hashlib.sha256("\0".join(fields).encode()).hexdigest()

    async def sync(self, products: list[Json]) -> Json:
        async with self.lock:
            unique = {}
            for p in products:
                if not isinstance(p, dict):
                    raise ValueError("Cada producto debe ser un objeto")
                for field in ("id", "name", "description"):
                    if not isinstance(p.get(field), str) or (field == "id" and not p[field]):
                        raise ValueError(f"Producto inválido: {field}")
                finite(p.get("price"), "price")
                if p.get("imageUrl") is not None and not isinstance(p["imageUrl"], str):
                    raise ValueError("imageUrl debe ser texto")
                unique.setdefault(p["id"], p)
            hashes = {i: self.content_hash(p) for i, p in unique.items()}
            changed = [i for i in unique if hashes[i] != self.hashes.get(i)]
            old = {i: v for i, v in zip(self.ids, self.vectors)}
            embedded = await self.embedder.embed_products([unique[i] for i in changed]) if changed else []
            if len(embedded) != len(changed):
                raise ValueError("Número incorrecto de embeddings")
            for i, vector in zip(changed, embedded):
                v = unit(vector)
                if v.shape != (self.embedder.dim,):
                    raise ValueError("Dimensión incorrecta del embedding")
                old[i] = v
            ids = list(unique)
            matrix = np.array([old[i] for i in ids], dtype=np.float32).reshape((-1, self.embedder.dim))
            removed = len(set(self.ids) - set(ids))
            report = {
                "added": len(set(ids) - set(self.ids)),
                "updated": len(set(changed) & set(self.ids)),
                "removed": removed,
                "unchanged": len(ids) - len(changed),
                "total": len(ids),
            }
            if self.store and (changed or removed):
                self.store.save(self.embedder.version, self.embedder.dim, ids, hashes, matrix)
            self.ids, self.hashes, self.vectors = ids, hashes, matrix
            return report

    async def search(self, query: str, limit: int = 20) -> list[Json]:
        vector = unit(await self.embedder.embed_query(query))
        if vector.shape != (self.embedder.dim,):
            raise ValueError("Dimensión incorrecta de la consulta")
        ids, matrix = self.ids, self.vectors
        scores = matrix @ vector
        order = np.argsort(-scores, kind="stable")[: max(0, limit)]
        return [{"id": ids[i], "score": float(scores[i])} for i in order]
