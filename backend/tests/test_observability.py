import json
import logging

from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import create_designer_app, create_search_app
from room_designer.adapters.vision import ConstantJudge
from room_designer.application.observability import (
    JsonLogFormatter,
    request_id_from_headers,
    trace_id_from_headers,
)
from room_designer.search.embeddings import HashingEmbedder
from test_critique import NullScreenshots


def app():
    return create_search_app(type("Service", (), {"ids": [], "embedder": HashingEmbedder()})())


@scenario("An HTTP request propagates trace context into structured logs")
def test_http_request_propagates_trace_context_into_structured_logs(caplog):
    traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    with TestClient(app()) as client, caplog.at_level(logging.INFO):
        response = client.get(
            "/healthz",
            headers={"traceparent": traceparent, "x-request-id": "client-42"},
        )

    assert response.headers["x-request-id"] == "client-42"
    assert response.headers["x-trace-id"] == "4bf92f3577b34da6a3ce929d0e0e4736"
    completed = [record for record in caplog.records if record.name.endswith("adapters.http")][-1]
    payload = json.loads(JsonLogFormatter().format(completed))
    assert payload["event"] == "http.request.completed"
    assert payload["requestId"] == "client-42"
    assert payload["traceId"] == "4bf92f3577b34da6a3ce929d0e0e4736"
    assert payload["route"] == "GET /healthz"
    assert payload["status"] == 200
    assert payload["durationMs"] >= 0


@scenario("A generated trace context is returned when the client sends none")
def test_generated_trace_context_is_safe():
    with TestClient(app()) as client:
        response = client.get("/healthz")

    assert len(response.headers["x-request-id"]) == 32
    assert len(response.headers["x-trace-id"]) == 32
    assert all(char in "0123456789abcdef" for char in response.headers["x-request-id"])
    assert all(char in "0123456789abcdef" for char in response.headers["x-trace-id"])


def test_trace_headers_reject_invalid_values_and_generate_safe_ids():
    assert trace_id_from_headers({"traceparent": "not-a-trace"}) is not None
    assert trace_id_from_headers({"x-trace-id": "tenant/secret"}) is not None
    assert request_id_from_headers({"x-request-id": "tenant/secret"}) is not None
    assert len(trace_id_from_headers({"traceparent": "not-a-trace"})) == 32


@scenario("A WebSocket operation keeps trace context in its structured log")
def test_websocket_operation_keeps_trace_context_in_its_structured_log(session, caplog):
    traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    app = create_designer_app(session, ConstantJudge(), NullScreenshots(), "fake")
    with TestClient(app) as client, caplog.at_level(logging.INFO):
        with client.websocket_connect(
            "/ws", headers={"traceparent": traceparent, "x-request-id": "socket-connection"}
        ) as socket:
            socket.receive_json()
            socket.send_json({"type": "unknown", "requestId": "socket-message"})
            assert socket.receive_json()["type"] == "error"

    records = [record for record in caplog.records if record.name.endswith("adapters.http")]
    payload = json.loads(JsonLogFormatter().format(records[-1]))
    assert payload["event"] == "websocket.message.completed"
    assert payload["requestId"] == "socket-message"
    assert payload["traceId"] == "4bf92f3577b34da6a3ce929d0e0e4736"
