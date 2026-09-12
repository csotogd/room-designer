import argparse
import copy
import io
import json
import struct

import httpx
import numpy as np
import pytest
from conftest import scenario
from PIL import Image, ImageDraw
from room_designer.pipeline.catalog import AssetStore, carry_over, to_entry
from room_designer.pipeline.cli import generate_or_judge, ingest, publish
from room_designer.pipeline.generation import ModelJudge, packshot_score
from room_designer.pipeline.geometry import furniture_dimensions, parse_glb, scene_size
from room_designer.pipeline.sources import CatalogSources, jsonld_product


@pytest.fixture
def product():
    return {
        "id": "chair",
        "site": "sklum",
        "sourceUrl": "https://shop.test/chair.html",
        "name": "Silla de roble",
        "imageUrl": "https://cdn.test/photo.png",
        "imagePath": "sklum/images/chair.png",
        "price": 100,
        "widthCm": 50,
        "depthCm": 40,
        "heightCm": 90,
        "extraDims": {},
    }


@scenario("A product page with JSON-LD yields name, image, price and dimensions")
def test_jsonld():
    data = {
        "@type": "Product",
        "name": "Silla",
        "image": ["https://cdn.test/a.jpg"],
        "offers": {"price": "120", "priceCurrency": "EUR"},
        "additionalProperty": [
            {"@type": "QuantitativeValue", "name": name, "value": value}
            for name, value in (("ancho", "55,5"), ("fondo", "40"), ("alto", "90"))
        ],
    }
    html = "<script type='application/ld+json'>" + json.dumps({"@graph": [data]}) + "</script>"
    p = jsonld_product(html, "https://shop.test/silla.html", "sklum")
    assert (p["name"], p["price"], p["widthCm"], p["depthCm"], p["heightCm"]) == ("Silla", 120, 55.5, 40, 90)
    assert p["imageUrl"] == "https://cdn.test/a.jpg" and p["currency"] == "EUR"
    assert jsonld_product("not a product", "https://shop.test", "sklum") is None


@scenario("A lamp page with diameter in the spec table yields width and depth")
def test_lamp_diameter():
    html = '<script type="application/ld+json">{"@type":"Product","name":"Lamp","image":"/lamp.png"}</script><label>Diámetro:</label><span>Ø 30 cm</span>'
    p = jsonld_product(html, "https://shop.test/lamp.html", "sklum")
    assert p["widthCm"] == p["depthCm"] == 30


@scenario("Scraped assets are laid out like a bucket")
def test_store(tmp_path, product, png):
    store = AssetStore(tmp_path)
    path = store.save("sklum", "images", "chair", png, "png")
    assert path == "sklum/images/chair.png"
    assert store.absolute(path).read_bytes() == png
    store.save_products("sklum", [product])
    assert store.read_products("sklum") == [product]
    with pytest.raises(ValueError):
        store.save_part("sklum", "chair", "../../../escape", b"bad")


@scenario("The generation queue only picks products without a model")
async def test_generation_queue_and_checkpoint(tmp_path, product, monkeypatch):
    store = AssetStore(tmp_path)
    ready = dict(product, id="ready", modelPath="sklum/models/ready.glb")
    store.save_products("sklum", [ready, product, dict(product, id="other")])
    calls = []
    data = glb_bytes()

    class Generator:
        def __init__(self, *args):
            pass

        async def generate(self, path):
            calls.append(path)
            return data, None

    monkeypatch.setattr("room_designer.pipeline.cli.TrellisGenerator", Generator)
    args = argparse.Namespace(site="sklum", command="generate", set=None, count=100, all=False)
    async with httpx.AsyncClient() as client:
        assert await generate_or_judge(args, {}, client, store) == 0
        assert await generate_or_judge(args, {}, client, store) == 0
    assert len(calls) == 2
    assert all(p.get("modelPath") for p in store.read_products("sklum"))


@scenario("The packshot scorer prefers clean studio shots over lifestyle photos")
def test_packshots():
    studio = Image.new("RGB", (64, 64), "white")
    ImageDraw.Draw(studio).rectangle((20, 20, 44, 44), fill="black")
    lifestyle = Image.fromarray(np.random.default_rng(42).integers(0, 256, (64, 64, 3), dtype=np.uint8))

    def png(image):
        out = io.BytesIO()
        image.save(out, "PNG")
        return out.getvalue()

    assert packshot_score(png(studio)) > packshot_score(png(lifestyle))
    assert packshot_score(png(studio)) > packshot_score(png(Image.new("RGB", (64, 64), "white")))


@scenario("Bucket products become app catalog entries in meters")
def test_entry(product):
    p = dict(product, modelPath="sklum/models/chair.glb", author="Author", license="CC-BY")
    entry = to_entry(p)
    assert (entry["width"], entry["depth"], entry["height"]) == (0.5, 0.4, 0.9)
    assert entry["assets"]["modelUrl"] == "/catalog/sklum/models/chair.glb"
    assert entry["origin"] == "sklum" and entry["license"] == "CC-BY" and entry["author"] == "Author"
    assert "modelUrl" not in to_entry(product)["assets"]
    assert to_entry(dict(product, imagePath=None)) is None
    p = dict(product, imagePath="sklum/images/a b.png")
    p.pop("depthCm")
    assert to_entry(p)["depth"] == 0.5
    assert to_entry(p)["assets"]["imageUrl"].endswith("a%20b.png")


@scenario("Re-ingesting preserves models whose input photo did not change")
def test_carry_generated(product):
    previous = dict(
        product,
        generationImageUrl="https://cdn.test/a.png",
        modelPath="model.glb",
        quality={"status": "approved"},
    )
    next_product = dict(product, generationImageUrl="https://cdn.test/a.png")
    carry_over(previous, next_product)
    assert next_product["modelPath"] == "model.glb"
    changed = dict(product, generationImageUrl="https://cdn.test/b.png")
    carry_over(previous, changed)
    assert "modelPath" not in changed


@scenario("Rejected products do not reach the app catalog")
@pytest.mark.parametrize("status", ["approved", "rejected", "pending"])
def test_quality_gate(product, status):
    assert (to_entry(dict(product, quality={"status": status})) is None) == (status == "rejected")


@scenario("The quality judge port defaults to approving when unconfigured")
async def test_noop_judge(product):
    assert (await ModelJudge(None).judge(product, None))["status"] == "approved"


def gltf_scene():
    return {
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "scale": [2, 1, 1], "translation": [1, 0, 0]}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [{"min": [0, 0, 0], "max": [0.5, 0.9, 0.4]}],
    }


def glb_bytes():
    payload = json.dumps(gltf_scene()).encode()
    payload += b" " * (-len(payload) % 4)
    return struct.pack("<5I", 0x46546C67, 2, 20 + len(payload), len(payload), 0x4E4F534A) + payload


def test_glb_transforms_and_units():
    gltf = parse_glb(glb_bytes())
    assert np.allclose(scene_size(gltf), [1, 0.9, 0.4])
    assert furniture_dimensions(scene_size(gltf)) == {"widthCm": 100, "heightCm": 90, "depthCm": 40}
    assert furniture_dimensions([1000, 900, 400]) == {"widthCm": 100, "heightCm": 90, "depthCm": 40}
    with pytest.raises(ValueError):
        parse_glb(glb_bytes()[:-1])
    with pytest.raises(ValueError):
        parse_glb(b"not glb")
    gltf["nodes"][0]["children"] = [0]
    with pytest.raises(ValueError):
        scene_size(gltf)


def test_carry_native():
    previous = {
        "modelPath": "native.glb",
        "modelSourceHash": "abc",
        "widthCm": 100,
        "heightCm": 90,
        "quality": {"status": "approved"},
    }
    p = {"modelSource": {"kind": "glb"}, "modelSourceHash": "abc"}
    carry_over(previous, p)
    assert p["modelPath"] == "native.glb" and p["widthCm"] == 100
    next_product = {"modelSource": {"kind": "glb"}, "modelSourceHash": "changed"}
    carry_over(previous, next_product)
    assert "modelPath" not in next_product


async def test_polyhaven_adapter():
    def handler(request):
        if request.url.path == "/assets":
            return httpx.Response(
                200,
                json={
                    "chair": {
                        "name": "Chair",
                        "dimensions": [500, 400, 900],
                        "files_hash": "h",
                        "authors": {"Artist": "link"},
                    }
                },
            )
        return httpx.Response(
            200,
            json={
                "gltf": {
                    "1k": {
                        "gltf": {
                            "url": "https://cdn.test/chair.gltf",
                            "include": {"textures/albedo.png": {"url": "https://cdn.test/albedo.png"}},
                        }
                    }
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rows = await CatalogSources(client).polyhaven(1)
    assert rows[0]["widthCm"] == 50 and rows[0]["heightCm"] == 90
    assert rows[0]["license"] == "CC0" and rows[0]["author"] == "Artist"
    assert len(rows[0]["modelSource"]["files"]) == 2


async def test_sketchfab_adapter_filters_and_deduplicates():
    item = {
        "uid": "chair",
        "name": "Chair",
        "isDownloadable": True,
        "archives": {"glb": {"size": 100}},
        "license": {"label": "CC-BY"},
        "user": {"username": "Artist"},
        "updatedAt": "today",
        "thumbnails": {"images": [{"width": 512, "url": "https://cdn.test/photo.png"}]},
    }

    def handler(request):
        return httpx.Response(
            200,
            json={
                "results": [
                    item,
                    dict(item, uid="bad", isDownloadable=False),
                    dict(item, uid="huge", archives={"glb": {"size": 50 * 1024 * 1024}}),
                ],
                "next": None,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        rows = await CatalogSources(client).sketchfab(100)
    assert len(rows) == 1
    assert rows[0]["author"] == "Artist" and rows[0]["license"] == "CC-BY"


async def test_ingest_native_and_resume(tmp_path, png, monkeypatch):
    store = AssetStore(tmp_path)
    product = {
        "id": "chair",
        "site": "sketchfab",
        "name": "Chair",
        "sourceUrl": "https://sketchfab.com/chair",
        "imageUrl": "https://cdn.test/photo.png",
        "modelSourceHash": "hash",
        "modelSource": {"kind": "glb", "url": "https://api.sketchfab.com/v3/models/chair/download"},
    }

    async def scrape(*args):
        return [copy.deepcopy(product)]

    monkeypatch.setattr(CatalogSources, "scrape", scrape)
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("/download"):
            assert request.headers["authorization"] == "Token secret"
            return httpx.Response(200, json={"glb": {"url": "https://cdn.test/model.glb"}})
        return httpx.Response(200, content=glb_bytes() if request.url.path.endswith(".glb") else png)

    args = argparse.Namespace(site="sketchfab", limit=1)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await ingest(args, {"SKETCHFAB_API_TOKEN": "secret"}, client, store) == 0
        assert await ingest(args, {"SKETCHFAB_API_TOKEN": "secret"}, client, store) == 0
    assert len([r for r in calls if r.url.path.endswith(".glb")]) == 1
    p = store.read_products("sketchfab")[0]
    assert p["widthCm"] == 100 and p["quality"]["status"] == "approved"


async def test_publish_inactive_does_not_overwrite_search(tmp_path, product, png):
    store = AssetStore(tmp_path / "data")
    store.save_products("sklum", [product])
    store.save("sklum", "images", "chair", png, "png")

    def fail(request):
        pytest.fail("An inactive catalog must not sync the active index")

    args = argparse.Namespace(site="sklum")
    async with httpx.AsyncClient(transport=httpx.MockTransport(fail)) as client:
        await publish(
            args, {"CATALOG_SITE": "polyhaven", "CATALOG_PUBLIC_DIR": str(tmp_path / "public")}, client, store
        )
    assert (tmp_path / "public/catalog/index-sklum.json").exists()
    assert not (tmp_path / "public/catalog/index.json").exists()


async def test_manual_judge_rejects_ambiguous_prefix(tmp_path, product):
    store = AssetStore(tmp_path)
    store.save_products("sklum", [product, dict(product, id="chair2")])
    args = argparse.Namespace(site="sklum", set="cha=rejected", reason="rota", command="judge")
    with pytest.raises(ValueError):
        await generate_or_judge(args, {}, None, store)
    args.set = "chair=rejected"
    await generate_or_judge(args, {}, None, store)
    assert store.read_products("sklum")[0]["quality"]["status"] == "rejected"


def test_flat_products_publish_with_minimum_depth(product):
    """Un set de postales real tiene depthCm=0: se publica con 1 cm, nunca 0."""
    flat = to_entry(dict(product, depthCm=0))
    assert flat["depth"] == 0.01
    assert to_entry(dict(product, widthCm=0.4, heightCm=0.2))["width"] == 0.01


def test_catalog_with_one_invalid_row_still_boots(tmp_path, product):
    from room_designer.adapters.storage import read_catalog
    good = to_entry(product)
    bad = dict(good, id="roto", depth=0)
    path = tmp_path / "index.json"
    path.write_text(json.dumps([good, bad]))
    catalog = read_catalog(path)
    assert good["id"] in catalog and "roto" not in catalog

    path.write_text(json.dumps([bad]))
    with pytest.raises(ValueError, match="sin productos"):
        read_catalog(path)
