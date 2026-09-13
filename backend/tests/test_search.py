import copy
import json
import time

import httpx
import numpy as np
import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import Metrics, create_search_app
from room_designer.pipeline.catalog import search_products
from room_designer.pipeline.cli import sync_entries
from room_designer.search.embeddings import HashingEmbedder, HybridEmbedder, JinaEmbedder
from room_designer.search.evaluation import evaluate_hits, evaluate_search
from room_designer.search.index import SearchIndex, SnapshotStore, unit


class CountingEmbedder(HashingEmbedder):
    def __init__(self):
        super().__init__()
        self.calls = []

    async def embed_products(self, products):
        self.calls.append(copy.deepcopy(products))
        return await super().embed_products(products)


@scenario("A product is indexed as one embedding of photo, description and price")
async def test_product_embedding(catalog):
    embedder = CountingEmbedder()
    index = SearchIndex(embedder)
    p = catalog["desk"]
    await index.sync([p])
    assert index.vectors.shape == (1, embedder.dim)
    assert embedder.calls == [[p]]
    for field, value in (("name", "new"), ("description", "new"), ("price", 200), ("imageUrl", "/new.png")):
        assert index.content_hash(p) != index.content_hash(dict(p, **{field: value}))


@scenario("Catalog sync is idempotent")
async def test_idempotence(catalog):
    embedder = CountingEmbedder()
    index = SearchIndex(embedder)
    await index.sync(list(catalog.values()))
    report = await index.sync(list(catalog.values()))
    assert report == {"added": 0, "updated": 0, "removed": 0, "unchanged": 6, "total": 6}
    assert len(embedder.calls) == 1


@scenario("Catalog refresh adds new embeddings and removes stale ones")
async def test_refresh(catalog):
    index = SearchIndex(HashingEmbedder())
    await index.sync([catalog["desk"], catalog["chair"]])
    result = await index.sync([catalog["chair"], catalog["plant"]])
    assert result == {"added": 1, "updated": 0, "removed": 1, "unchanged": 1, "total": 2}
    assert (await index.search("potted plant"))[0]["id"] == "plant"
    assert "desk" not in index.ids


@scenario("Unchanged products are not re-embedded on refresh")
async def test_only_changed(catalog):
    embedder = CountingEmbedder()
    index = SearchIndex(embedder)
    await index.sync(list(catalog.values()))
    catalog["desk"]["price"] = 250
    report = await index.sync(list(catalog.values()))
    assert report["updated"] == 1
    assert [p["id"] for p in embedder.calls[-1]] == ["desk"]


@scenario("Search ranks the most relevant products first")
async def test_ranking(catalog):
    index = SearchIndex(HashingEmbedder())
    await index.sync(list(catalog.values()))
    for query, expected in (("office chair", "chair"), ("potted plant", "plant"), ("bed frame", "bed")):
        assert (await index.search(query))[0]["id"] == expected


@scenario("Search stays fast with one hundred thousand products")
async def test_large_index():
    class Embedder:
        version, dim = "test", 256

        async def embed_query(self, query):
            return np.ones(self.dim, dtype=np.float32)

    index = SearchIndex(Embedder())
    rng = np.random.default_rng(42)
    matrix = rng.standard_normal((100000, 256), dtype=np.float32)
    matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
    index.ids = [str(i) for i in range(100000)]
    index.vectors = matrix
    await index.search("warmup")
    start = time.monotonic()
    results = await index.search("query")
    assert len(results) == 20
    assert time.monotonic() - start < 1
    assert results == sorted(results, key=lambda r: -r["score"])


@scenario("The search microservice serves sync and search over HTTP")
async def test_http(catalog):
    app = create_search_app(SearchIndex(HashingEmbedder()), "secret")
    with TestClient(app) as client:
        assert client.post("/sync", json={"products": []}).status_code == 401
        r = client.post(
            "/sync",
            json={"products": list(catalog.values())},
            headers={"Authorization": "Bearer secret", "X-Request-Id": "sync-test"},
        )
        assert r.status_code == 200 and r.json()["total"] == len(catalog)
        assert r.headers["x-request-id"] == "sync-test"
        r = client.get("/search?q=office+chair")
        assert r.json()["results"][0]["id"] == "chair"
        assert client.get("/search").status_code == 400
        assert len(client.get("/search?q=chair&limit=1").json()["results"]) == 1
        assert client.get("/search?q=chair&limit=nan").status_code == 200
        for body in ({"products": None}, {"products": [{"id": "bad"}]}, []):
            assert (
                client.post("/sync", json=body, headers={"Authorization": "Bearer secret"}).status_code == 400
            )


@scenario("The index survives a restart through its persisted snapshot")
async def test_restart_and_incompatible_version(tmp_path, catalog):
    store = SnapshotStore(tmp_path)
    first = SearchIndex(HashingEmbedder(), store)
    await first.sync(list(catalog.values()))
    second = SearchIndex(CountingEmbedder(), store)
    assert await second.restore()
    assert not second.embedder.calls
    assert await first.search("chair") == await second.search("chair")
    third = SearchIndex(HashingEmbedder(64), store)
    assert not await third.restore()


@scenario("The embedding photo is the packshot, never the lifestyle shot")
def test_packshot_projection():
    entry = {
        "id": "p",
        "name": "p",
        "description": "d",
        "price": 2,
        "assets": {"imageUrl": "/lifestyle.jpg", "packshotUrl": "/packshot.jpg"},
    }
    assert search_products([entry], "https://cdn.test")[0]["imageUrl"] == "https://cdn.test/packshot.jpg"
    entry["assets"].pop("packshotUrl")
    assert search_products([entry])[0]["imageUrl"] == "/lifestyle.jpg"
    entry["assets"]["imageUrl"] = "https://other.test/a.jpg"
    assert search_products([entry], "https://cdn.test")[0]["imageUrl"] == "https://other.test/a.jpg"


@scenario("Search quality is measured with IR metrics against a golden set")
async def test_ir(catalog):
    index = SearchIndex(HashingEmbedder())
    await index.sync(list(catalog.values()))
    result = await evaluate_search(index.search, [{"query": "office chair", "relevant": ["chair"]}])
    assert result["meanReciprocalRank"] == result["meanRecallAtK"] == result["meanNdcgAtK"] == 1
    assert evaluate_hits([{"id": "x"}], [], 5)["recallAtK"] == 1
    assert evaluate_hits([{"id": "x"}], ["y"], 5)["reciprocalRank"] == 0
    assert evaluate_hits([{"id": "x"}], ["x", "y"], 1)["recallAtK"] == 0.5


@scenario("The service exposes online quality signals beyond latency")
async def test_metrics(catalog):
    service = SearchIndex(HashingEmbedder())
    app = create_search_app(service)
    with TestClient(app) as client:
        client.get("/search?q=empty")
        client.post("/sync", json={"products": list(catalog.values())})
        client.get("/search?q=office+chair")
        client.get("/search?q=qzvxxy")
        metrics = client.get("/metrics").json()
        assert metrics["searchQuality"]["searches"] == 3
        assert metrics["searchQuality"]["emptyRate"] == pytest.approx(1 / 3)
        assert metrics["searchQuality"]["lowConfidenceRate"] > 0
        assert metrics["lastSync"]["report"]["total"] == 6
    m = Metrics()
    m.observe("GET /test", 200, 10)
    m.observe("GET /test", 500, 30)
    assert m.snapshot()["routes"]["GET /test"] == {"count": 2, "errors": 1, "avgMs": 20, "maxMs": 30}


@pytest.mark.parametrize("failure", ["embed", "size", "nan", "persist"])
async def test_failed_sync_preserves_memory_and_disk(tmp_path, catalog, failure):
    embedder = CountingEmbedder()
    store = SnapshotStore(tmp_path)
    service = SearchIndex(embedder, store)
    await service.sync([catalog["desk"]])
    before = (tmp_path / "index.json").read_bytes()

    async def fail(products):
        if failure == "embed":
            raise RuntimeError("remote failed")
        return [np.full(1024 if failure == "nan" else 2, np.nan if failure == "nan" else 1)]

    if failure == "persist":

        def fail_save(*args):
            raise OSError("disk full")

        store.save = fail_save
    else:
        embedder.embed_products = fail
    with pytest.raises((RuntimeError, ValueError, OSError)):
        await service.sync([catalog["chair"]])
    assert service.ids == ["desk"]
    assert (tmp_path / "index.json").read_bytes() == before


async def test_hybrid_math():
    class Static:
        version, dim = "static", 2

    embedder = HybridEmbedder(Static(), 0.6, Static())
    a = unit(embedder.combine([1, 0], [1, 0]))
    b = unit(embedder.combine([1, 0], [0, 1]))
    assert float(a @ b) == pytest.approx(0.6)
    with pytest.raises(ValueError):
        HybridEmbedder(Static(), 2)


async def test_jina_multimodal_adapter():
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        assert request.headers["authorization"] == "Bearer dummy"
        return httpx.Response(
            200,
            json={
                "data": [
                    {"index": i, "embedding": [1.0] + [0.0] * 1023}
                    for i in reversed(range(len(body["input"])))
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        embedder = JinaEmbedder(client, "dummy")
        vectors = await embedder.embed_products(
            [
                {
                    "name": "chair",
                    "description": "black",
                    "price": 100,
                    "imageUrl": "https://cdn.test/chair.jpg",
                }
            ]
        )
        assert len(vectors) == 1 and vectors[0].shape == (1024,)
        assert len(calls[0]["input"]) == 2 and "image" in calls[0]["input"][1]
        assert len(await embedder.embed_query("chair")) == 1024


async def test_pipeline_sync_token_and_request_id():
    service = SearchIndex(HashingEmbedder())
    app = create_search_app(service, "secret")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as client:
        await sync_entries(
            [], {"SEARCH_URL": "http://test", "SEARCH_SYNC_TOKEN": "secret"}, client, verify=True
        )
    assert service.ids == []


async def test_empty_sync_clears_index(catalog):
    index = SearchIndex(HashingEmbedder())
    await index.sync(list(catalog.values()))
    assert (await index.sync([]))["removed"] == 6
    assert await index.search("chair") == []


async def test_clip_real_torch_inference_without_downloading_weights(tmp_path, png):
    torch = pytest.importorskip("torch")
    transformers = pytest.importorskip("transformers")
    from room_designer.search.embeddings import ClipEmbedder

    config = transformers.CLIPConfig(
        text_config={
            "vocab_size": 32,
            "hidden_size": 16,
            "intermediate_size": 32,
            "num_hidden_layers": 1,
            "num_attention_heads": 2,
            "max_position_embeddings": 77,
        },
        vision_config={
            "hidden_size": 16,
            "intermediate_size": 32,
            "num_hidden_layers": 1,
            "num_attention_heads": 2,
            "image_size": 32,
            "patch_size": 16,
        },
        projection_dim=512,
    )
    model = transformers.CLIPModel(config).eval()

    class Processor:
        def __call__(self, text=None, images=None, **kwargs):
            if text is not None:
                return {"input_ids": torch.tensor([[1, 2, 3]]), "attention_mask": torch.ones((1, 3))}
            pixels = np.asarray(images.resize((32, 32)), dtype=np.float32) / 255
            return {"pixel_values": torch.from_numpy(pixels).permute(2, 0, 1).unsqueeze(0)}

    (tmp_path / "photo.png").write_bytes(png)
    async with httpx.AsyncClient() as client:
        embedder = ClipEmbedder(client, public_dir=tmp_path)
        embedder.backend = model, Processor()
        query = await embedder.embed_query("chair")
        product = {
            "id": "chair",
            "name": "chair",
            "description": "chair",
            "price": 100,
            "imageUrl": "/photo.png",
        }
        vectors = await embedder.embed_products([product])
    assert query.shape == vectors[0].shape == (512,)
    assert np.isfinite(vectors[0]).all()
    assert not np.allclose(query, vectors[0])
