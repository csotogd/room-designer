"""Source adapters; accepts an injected HTTP client for deterministic tests."""

import asyncio
import json
import logging
import math
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

from room_designer.domain.room import Json

log = logging.getLogger(__name__)
ALIASES = {
    "ancho": "widthCm",
    "anchura": "widthCm",
    "width": "widthCm",
    "profundo": "depthCm",
    "profundidad": "depthCm",
    "fondo": "depthCm",
    "depth": "depthCm",
    "largo": "depthCm",
    "alto": "heightCm",
    "altura": "heightCm",
    "height": "heightCm",
}
CATEGORIES = [
    "3427-comprar-sillas-de-comedor",
    "633-comprar-sofas",
    "544-comprar-sillones",
    "12230-comprar-camas",
    "3976-comprar-mesitas-de-noche",
    "538-comprar-mesas-comedor",
    "539-comprar-mesas-bajas-y-auxiliares",
    "525-comprar-lamparas",
    "550-comprar-estanterias",
    "4057-comprar-aparadores",
]


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts, self.links, self.current = [], [], None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("type") == "application/ld+json":
            self.current = ""
        if tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])

    def handle_data(self, data):
        if self.current is not None:
            self.current += data

    def handle_endtag(self, tag):
        if tag == "script" and self.current is not None:
            self.scripts.append(self.current)
            self.current = None


def jsonld_product(html: str, url: str, site: str) -> Json | None:
    parser = PageParser()
    parser.feed(html)

    def nodes(value):
        if isinstance(value, list):
            for v in value:
                yield from nodes(v)
        elif isinstance(value, dict):
            yield value
            yield from nodes(value.get("@graph", []))

    for script in parser.scripts:
        try:
            data = json.loads(script)
        except ValueError:
            continue
        for raw in nodes(data):
            if raw.get("@type") != "Product" or not raw.get("name"):
                continue
            photo = raw.get("image")
            if isinstance(photo, list):
                photo = photo[0] if photo else None
            if isinstance(photo, dict):
                photo = photo.get("url")
            if not isinstance(photo, str):
                continue
            p = {
                "id": re.sub(r"\.html?$", "", urlparse(url).path.rsplit("/", 1)[-1])[:80],
                "site": site,
                "country": "es",
                "sourceUrl": url,
                "name": raw["name"],
                "imageUrl": urljoin(url, photo),
                "extraDims": {},
            }
            if raw.get("description"):
                p["description"] = raw["description"]
            offers = raw.get("offers", {})
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            spec = offers.get("priceSpecification", {})
            try:
                price = float(offers.get("price", spec.get("price")))
                if math.isfinite(price):
                    p["price"] = price
            except (ValueError, TypeError):
                pass
            currency = offers.get("priceCurrency", spec.get("priceCurrency"))
            if currency:
                p["currency"] = currency
            for prop in raw.get("additionalProperty", []):
                try:
                    name = str(prop.get("name", "")).lower().strip()
                    value = float(str(prop["value"]).replace(",", "."))
                    if not math.isfinite(value):
                        continue
                    if name in ALIASES:
                        p.setdefault(ALIASES[name], value)
                    else:
                        p["extraDims"][name] = value
                except (ValueError, KeyError):
                    continue
            diameter = p["extraDims"].get("diámetro", p["extraDims"].get("diametro"))
            if diameter:
                p.setdefault("widthCm", diameter)
                p.setdefault("depthCm", diameter)
            for name, value in re.findall(
                r"(diámetro|diametro|ancho|anchura|fondo|profundidad|largo|alto|altura)\s*:?\s*</label>\s*<span>\s*Ø?\s*(\d+(?:[.,]\d+)?)\s*cm",
                html,
                re.I,
            ):
                fields = (
                    ("widthCm", "depthCm")
                    if name.lower() in ("diametro", "diámetro")
                    else (ALIASES[name.lower()],)
                )
                for field in fields:
                    p.setdefault(field, float(value.replace(",", ".")))
            slug = urlparse(photo).path.rsplit("/", 1)[-1]
            gallery = re.findall(r"https?://[^\"'\s<>]+/\d+(?:-[a-z_]+)?/[^\"'\s<>]+\.jpe?g", html)
            p["galleryUrls"] = list(
                dict.fromkeys(
                    u for u in gallery if u.endswith("/" + slug) and u != photo and "-large_default" not in u
                )
            )[:8]
            return p
    return None


class CatalogSources:
    def __init__(self, client):
        self.client = client

    async def json(self, url, headers=None):
        response = await self.client.get(url, headers=headers, timeout=30, follow_redirects=True)
        response.raise_for_status()
        return response.json()

    async def scrape(self, site: str, limit: int) -> list[Json]:
        if site == "polyhaven":
            return await self.polyhaven(limit)
        if site == "sketchfab":
            return await self.sketchfab(limit)
        if site == "sklum":
            return await self.sklum(limit)
        raise ValueError("Sitio desconocido")

    async def polyhaven(self, limit):
        assets = await self.json("https://api.polyhaven.com/assets?type=models")
        semaphore = asyncio.Semaphore(6)

        async def product(slug, meta):
            async with semaphore:
                files = await self.json(f"https://api.polyhaven.com/files/{slug}")
                variants = files.get("gltf", {})
                entry = (variants.get("1k") or next(iter(variants.values()), {})).get("gltf")
                if not entry or not entry.get("url"):
                    return None
                dims = meta.get("dimensions", [])
                p = {
                    "id": slug,
                    "site": "polyhaven",
                    "country": "int",
                    "name": meta["name"],
                    "sourceUrl": f"https://polyhaven.com/a/{slug}",
                    "description": " · ".join(
                        filter(
                            None,
                            [
                                meta.get("description", meta["name"]),
                                meta.get("category"),
                                ", ".join(meta.get("tags", [])),
                            ],
                        )
                    ),
                    "imageUrl": f"https://cdn.polyhaven.com/asset_img/thumbs/{slug}.png?width=512&height=512",
                    "license": "CC0",
                    "author": ", ".join(meta.get("authors", {})),
                    "extraDims": {},
                    "modelSourceHash": meta.get("files_hash", ""),
                    "modelSource": {
                        "kind": "gltf-files",
                        "entry": slug + ".gltf",
                        "files": {
                            slug + ".gltf": entry["url"],
                            **{k: v["url"] for k, v in entry.get("include", {}).items()},
                        },
                    },
                }
                p.update({k: round(v) / 10 for k, v in zip(("widthCm", "depthCm", "heightCm"), dims) if v})
                return p

        output = []
        for start in range(0, min(limit, len(assets)), 6):
            rows = list(assets.items())[start : min(start + 6, limit)]
            for result in await asyncio.gather(*(product(s, m) for s, m in rows), return_exceptions=True):
                if isinstance(result, Exception):
                    log.warning("Fallo de fuente Poly Haven: %s", result)
                elif result:
                    output.append(result)
        return output

    async def sketchfab(self, limit):
        output, seen, visited = [], set(), set()
        for license_id in ("cc0", "by"):
            url = f"https://api.sketchfab.com/v3/search?type=models&downloadable=true&license={license_id}&categories=furniture-home&count=24"
            while url and url not in visited and len(output) < limit:
                if urlparse(url).hostname != "api.sketchfab.com":
                    raise ValueError("URL de paginación Sketchfab inválida")
                visited.add(url)
                page = await self.json(url)
                for raw in page.get("results", []):
                    size = raw.get("archives", {}).get("glb", {}).get("size", 0)
                    photos = sorted(
                        (
                            p
                            for p in raw.get("thumbnails", {}).get("images", [])
                            if p.get("url") and p.get("width")
                        ),
                        key=lambda p: p["width"],
                    )
                    if not raw.get("isDownloadable") or not 0 < size <= 40 * 1024 * 1024 or not photos:
                        continue
                    if raw["uid"] in seen or len(output) >= limit:
                        continue
                    seen.add(raw["uid"])
                    photo = next((p for p in photos if p["width"] >= 512), photos[-1])
                    output.append(
                        {
                            "id": raw["uid"],
                            "site": "sketchfab",
                            "country": "int",
                            "name": raw["name"],
                            "description": " · ".join(
                                filter(
                                    None,
                                    [
                                        raw.get("description", ""),
                                        ", ".join(t["name"] for t in raw.get("tags", []) if t.get("name")),
                                    ],
                                )
                            )
                            or raw["name"],
                            "sourceUrl": raw.get(
                                "viewerUrl", f"https://sketchfab.com/3d-models/{raw['uid']}"
                            ),
                            "imageUrl": photo["url"],
                            "license": raw.get("license", {}).get("label", license_id),
                            "author": raw.get("user", {}).get("username", ""),
                            "extraDims": {},
                            "modelSource": {
                                "kind": "glb",
                                "url": f"https://api.sketchfab.com/v3/models/{raw['uid']}/download",
                            },
                            "modelSourceHash": f"{raw.get('updatedAt', raw.get('publishedAt', ''))}:{size}",
                        }
                    )
                url = page.get("next")
        return output

    async def sklum(self, limit):
        links, products = [], []
        for category in CATEGORIES:
            response = await self.client.get("https://www.sklum.com/es/" + category, follow_redirects=True)
            response.raise_for_status()
            parser = PageParser()
            parser.feed(response.text)
            for link in parser.links:
                parsed = urlparse(urljoin("https://www.sklum.com", link))
                if parsed.hostname == "www.sklum.com" and re.fullmatch(r"/es/comprar-.+\.html", parsed.path):
                    url = "https://www.sklum.com" + parsed.path
                    if url not in links:
                        links.append(url)
            if len(links) >= limit:
                break
        for url in links[:limit]:
            response = await self.client.get(url, follow_redirects=True)
            response.raise_for_status()
            if product := jsonld_product(response.text, url, "sklum"):
                products.append(product)
        return products
