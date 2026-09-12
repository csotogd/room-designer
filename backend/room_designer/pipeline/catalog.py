"""Catalog transformations and atomic local asset storage."""

import copy
import re
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

from room_designer.adapters.storage import atomic_write, write_json
from room_designer.domain.room import Json

SITES = {"sklum": "es", "polyhaven": "int", "sketchfab": "int"}


class AssetStore:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def absolute(self, relative: str) -> Path:
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Ruta de asset fuera de la raíz")
        return path

    def read_products(self, site: str) -> list[Json]:
        import json

        try:
            return json.loads(self.absolute(f"{site}/products.json").read_text())
        except FileNotFoundError:
            return []

    def save_products(self, site: str, products: list[Json]):
        write_json(self.absolute(f"{site}/products.json"), products)

    def save(self, site: str, folder: str, product_id: str, data: bytes, extension: str) -> str:
        if any(c in product_id for c in ("/", "\\")) or product_id in (".", ".."):
            raise ValueError("ID de producto inválido")
        relative = f"{site}/{folder}/{product_id}.{extension}"
        atomic_write(self.absolute(relative), data)
        return relative

    def save_part(self, site: str, product_id: str, relative: str, data: bytes) -> str:
        directory = self.absolute(f"{site}/models/{product_id}")
        destination = (directory / relative).resolve()
        if not destination.is_relative_to(directory) or "\\" in relative:
            raise ValueError("Ruta glTF inválida")
        atomic_write(destination, data)
        return str(destination.relative_to(self.root))


def carry_over(previous: Json | None, product: Json):
    if not previous or not previous.get("modelPath"):
        return
    native = bool(product.get("modelSource"))
    key = "modelSourceHash" if native else "generationImageUrl"
    if product.get(key) and previous.get(key) == product[key]:
        for field in ("modelPath", "previewPath", "quality"):
            if field in previous:
                product[field] = copy.deepcopy(previous[field])
        if native:
            for field in ("widthCm", "depthCm", "heightCm"):
                if field not in product and field in previous:
                    product[field] = previous[field]


def to_entry(p: Json, base_url: str = "/catalog") -> Json | None:
    if not p.get("widthCm") or not p.get("heightCm") or not p.get("imagePath"):
        return None
    if p.get("quality", {}).get("status") == "rejected":
        return None
    assets = {
        name: base_url.rstrip("/") + "/" + quote(p[field], safe="/")
        for name, field in (
            ("imageUrl", "imagePath"),
            ("packshotUrl", "generationImagePath"),
            ("modelUrl", "modelPath"),
        )
        if p.get(field)
    }
    return {
        "id": f"{p['site']}-{p['id']}",
        "name": p["name"],
        "description": p.get("description")
        or f"{p['name']} · {p['widthCm']}×{p.get('depthCm', '?')}×{p['heightCm']} cm · {p['sourceUrl']}",
        # Clamp a 1 cm: hay objetos planos reales (láminas, sets de postales)
        # con depthCm=0, y una medida 0 rompería la geometría del diseñador.
        # Ojo: depthCm=0 se clampa; solo depthCm AUSENTE cae al ancho.
        "width": max(p["widthCm"], 1) / 100,
        "depth": max(p["depthCm"] if p.get("depthCm") is not None else p["widthCm"], 1) / 100,
        "height": max(p["heightCm"], 1) / 100,
        "price": p.get("price", 0),
        "isSurface": bool(
            re.search(r"mesa|aparador|escritorio|consola|estanter|c[oó]moda|banco|mesita", p["name"], re.I)
        ),
        "color": "#b8ab9b",
        "form": "box",
        "origin": p["site"],
        "assets": assets,
        **{k: p[k] for k in ("license", "author") if p.get(k)},
    }


def search_products(entries: list[Json], public_base_url: str | None = None) -> list[Json]:
    products = []
    for entry in entries:
        p = {key: entry[key] for key in ("id", "name", "description", "price")}
        photo = entry["assets"].get("packshotUrl") or entry["assets"].get("imageUrl")
        if photo:
            p["imageUrl"] = urljoin(public_base_url.rstrip("/") + "/", photo) if public_base_url else photo
        products.append(p)
    return products


def image_extension(url: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower().lstrip(".")
    return suffix if suffix in ("jpg", "jpeg", "png", "webp", "gif") else "jpg"
