import httpx
import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import create_designer_app, create_search_app
from room_designer.adapters.reliability import RateLimiter, retry_async
from room_designer.adapters.storage import FileRoomRepository, HttpProductSearch, LocalScreenshots
from room_designer.adapters.vision import ConstantJudge
from room_designer.domain.room import empty_state
from room_designer.search.embeddings import HashingEmbedder
from room_designer.search.index import SearchIndex, SnapshotStore
from test_critique import NullScreenshots


@scenario("A retried chat request is applied only once")
async def test_retried_chat_request_is_applied_only_once(session):
    first = await session.chat("añade una silla", "same-chat")
    duplicate = await session.chat("añade una silla", "same-chat")

    assert duplicate["duplicate"] is True
    assert duplicate["state"] == first["state"]
    with pytest.raises(ValueError, match="otro contenido"):
        await session.chat("añade una mesa", "same-chat")


@scenario("Transient dependency failures are retried with bounded backoff")
async def test_transient_dependency_failures_are_retried_with_bounded_backoff():
    attempts = 0

    async def operation():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise httpx.ReadTimeout("temporal")
        return "ok"

    assert await retry_async(operation, attempts=3, base_delay=0, max_delay=0) == "ok"
    assert attempts == 3


@scenario("Room state keeps a restorable rotating backup")
async def test_room_state_keeps_a_restorable_rotating_backup(tmp_path):
    path = tmp_path / "room.json"
    repository = FileRoomRepository(path)
    first = empty_state()
    first["revision"] = "first"
    second = empty_state()
    second["revision"] = "second"

    await repository.save(first)
    await repository.save(second)
    await repository.restore_backup()

    assert (await repository.load())["revision"] == "first"
    assert path.with_name("room.json.bak").exists()


@scenario("A client over the request budget receives a retry hint")
def test_client_over_request_budget_receives_a_retry_hint():
    app = create_search_app(
        SearchIndex(HashingEmbedder()),
        rate_limit=RateLimiter(max_requests=2, window_seconds=60),
    )
    with TestClient(app) as client:
        assert client.get("/search?q=chair").status_code == 200
        assert client.get("/search?q=chair").status_code == 200
        response = client.get("/search?q=chair")

    assert response.status_code == 429
    assert response.headers["retry-after"].isdigit()
    assert response.json()["error"] == "Límite de peticiones alcanzado"


@scenario("A WebSocket client over the message budget receives a retry hint")
def test_websocket_client_over_message_budget_receives_a_retry_hint(session):
    app = create_designer_app(
        session,
        ConstantJudge(),
        NullScreenshots(),
        "fake",
        rate_limit=RateLimiter(max_requests=1, window_seconds=60),
    )
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as socket:
            socket.receive_json()
            socket.send_json({"type": "unknown", "requestId": "first"})
            assert socket.receive_json()["error"] == "Tipo de mensaje desconocido"
            socket.send_json({"type": "unknown", "requestId": "second"})
            limited = socket.receive_json()

    assert limited["requestId"] == "second"
    assert limited["error"] == "Límite de peticiones alcanzado"
    assert limited["retryAfterSeconds"] >= 1


def test_rate_limiter_expires_a_client_window():
    limiter = RateLimiter(max_requests=1, window_seconds=10)
    assert limiter.retry_after("client", now=100) is None
    assert limiter.retry_after("client", now=100) == 10
    assert limiter.retry_after("client", now=111) is None


async def test_product_search_retries_a_transient_http_failure():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503, request=request)
        return httpx.Response(200, json={"results": [{"id": "chair", "score": 0.9}]}, request=request)

    catalog = {"chair": {"id": "chair", "name": "Chair"}}
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        results = await HttpProductSearch(client, "https://search.test", catalog).search("chair")

    assert results == [{"id": "chair", "name": "Chair", "score": 0.9}]
    assert calls == 2


def test_search_snapshot_falls_back_to_the_last_valid_backup(tmp_path):
    store = SnapshotStore(tmp_path)
    store.save("v", 1, ["first"], {"first": "a"}, __import__("numpy").array([[1]], dtype="float32"))
    store.save("v", 1, ["second"], {"second": "b"}, __import__("numpy").array([[2]], dtype="float32"))
    (tmp_path / "index.json").write_text("not json")

    metadata, vectors = store.load()

    assert metadata["records"] == [{"id": "first", "contentHash": "a"}]
    assert vectors.tolist() == [[1.0]]


async def test_screenshot_storage_uses_the_same_path_for_a_retried_request(tmp_path):
    store = LocalScreenshots(tmp_path)

    first = await store.save("capture-1", b"first")
    second = await store.save("capture-1", b"second")

    assert first == second
    assert len(list(tmp_path.iterdir())) == 1
    assert (tmp_path / "capture-1.png").read_bytes() == b"second"
