"""Transport contract compatible with the existing browser clients."""

import hmac
import json
import logging
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from room_designer.adapters.reliability import RateLimiter
from room_designer.adapters.vision import decode_png
from room_designer.application.observability import (
    observation_context,
    request_id_from_headers,
    trace_id_from_headers,
)
from room_designer.application.workflow import DesignWorkflow

log = logging.getLogger(__name__)
MAX_WS_BYTES = 16 * 1024 * 1024


class Metrics:
    def __init__(self):
        self.started, self.routes = time.monotonic(), {}
        self.last_sync = self.last_sync_error = None
        self.searches = self.empty = self.low = 0
        self.top_sum = 0

    def observe(self, route, status, ms):
        row = self.routes.setdefault(route, {"count": 0, "errors": 0, "totalMs": 0, "maxMs": 0})
        row["count"] += 1
        row["errors"] += int(status >= 500)
        row["totalMs"] += ms
        row["maxMs"] = max(row["maxMs"], ms)

    def snapshot(self):
        return {
            "uptimeSeconds": round(time.monotonic() - self.started),
            "routes": {
                k: {
                    "count": v["count"],
                    "errors": v["errors"],
                    "avgMs": round(v["totalMs"] / v["count"], 2),
                    "maxMs": v["maxMs"],
                }
                for k, v in self.routes.items()
            },
            "lastSync": self.last_sync,
            "lastSyncError": self.last_sync_error,
            "searchQuality": {
                "searches": self.searches,
                "emptyRate": self.empty / self.searches if self.searches else None,
                "lowConfidenceRate": self.low / self.searches if self.searches else None,
                "avgTopScore": self.top_sum / (self.searches - self.empty)
                if self.searches > self.empty
                else None,
                "lowConfidenceThreshold": 0.25,
            },
        }


def base_app(lifespan=None, rate_limit: RateLimiter | None = None):
    app = FastAPI(lifespan=lifespan)
    metrics = Metrics()
    limiter = rate_limit or RateLimiter()
    app.state.rate_limiter = limiter
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization", "X-Request-Id", "X-Trace-Id", "Traceparent"],
        expose_headers=["X-Request-Id", "X-Trace-Id", "Retry-After"],
    )

    @app.middleware("http")
    async def observe(request: Request, call_next):
        request_id = request_id_from_headers(request.headers)
        trace_id = trace_id_from_headers(request.headers)
        request.state.request_id = request_id
        request.state.trace_id = trace_id
        started = time.monotonic()
        with observation_context(request_id, trace_id):
            limited_for = None
            if request.url.path not in {"/healthz", "/metrics"}:
                client_key = request.client.host if request.client else "unknown"
                limited_for = limiter.retry_after(client_key)
            if limited_for is not None:
                response = JSONResponse(
                    {"error": "Límite de peticiones alcanzado", "requestId": request_id},
                    status_code=429,
                    headers={"Retry-After": str(limited_for)},
                )
            else:
                try:
                    response = await call_next(request)
                except Exception:
                    log.exception(
                        "Petición fallida",
                        extra={
                            "structured": {
                                "event": "http.request.failed",
                                "requestId": request_id,
                                "traceId": trace_id,
                            }
                        },
                    )
                    response = JSONResponse({"error": "Error interno", "requestId": request_id}, status_code=500)
            elapsed = (time.monotonic() - started) * 1000
            route = request.scope.get("route")
            route_name = f"{request.method} {route.path if route else 'unknown'}"
            metrics.observe(route_name, response.status_code, elapsed)
            log.info(
                "Petición completada",
                extra={
                    "structured": {
                        "event": "http.request.rate_limited" if limited_for is not None else "http.request.completed",
                        "requestId": request_id,
                        "traceId": trace_id,
                        "route": route_name,
                        "status": response.status_code,
                        "durationMs": round(elapsed, 2),
                    }
                },
            )
            response.headers["x-request-id"] = request_id
            response.headers["x-trace-id"] = trace_id
            return response

    @app.get("/metrics")
    async def get_metrics():
        return metrics.snapshot()

    return app, metrics


def authorized(actual, expected):
    return not expected or hmac.compare_digest(actual or "", expected)


def create_search_app(service, token="", lifespan=None, rate_limit: RateLimiter | None = None):
    app, metrics = base_app(lifespan, rate_limit)
    app.state.index = service
    app.state.restored = False

    @app.get("/healthz")
    async def health():
        return {
            "ok": True,
            "version": "2.0.0",
            "products": len(service.ids),
            "provider": service.embedder.version,
            "dim": service.embedder.dim,
            "restored": app.state.restored,
        }

    @app.get("/search")
    async def search(q: str = "", limit: str = "20"):
        if not q.strip():
            return JSONResponse({"error": "Falta el parámetro q"}, status_code=400)
        try:
            count = max(1, min(100, int(float(limit))))
        except (ValueError, OverflowError):
            count = 20
        started = time.monotonic()
        results = await service.search(q.strip(), count)
        metrics.searches += 1
        metrics.empty += int(not results)
        if results:
            metrics.top_sum += results[0]["score"]
            metrics.low += int(results[0]["score"] < 0.25)
        return {"results": results, "tookMs": round((time.monotonic() - started) * 1000, 2)}

    @app.post("/sync")
    async def sync(request: Request):
        if token and not authorized(request.headers.get("authorization"), "Bearer " + token):
            return JSONResponse({"error": "Token de sync inválido"}, status_code=401)
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 64 * 1024 * 1024:
                return JSONResponse({"error": "Cuerpo demasiado grande"}, status_code=413)
        started = time.monotonic()
        try:
            body = json.loads(raw)
            if not isinstance(body, dict) or not isinstance(body.get("products"), list):
                raise ValueError("products debe ser una lista")
            report = await service.sync(body["products"])
        except (ValueError, TypeError, KeyError) as error:
            metrics.last_sync_error = {"at": datetime.now(timezone.utc).isoformat(), "detail": str(error)}
            return JSONResponse({"error": str(error)}, status_code=400)
        metrics.last_sync = {
            "at": datetime.now(timezone.utc).isoformat(),
            "durationMs": (time.monotonic() - started) * 1000,
            "report": report,
        }
        return report

    return app


def allowed_origin(origin: str | None, allowed: tuple[str, ...]) -> bool:
    if not origin:
        return True
    parsed = urlparse(origin)
    return origin in allowed or (
        parsed.scheme in ("http", "https") and parsed.hostname in ("localhost", "127.0.0.1", "::1")
    )


def create_designer_app(
    session,
    judge,
    screenshots,
    provider: str,
    token="",
    allowed_origins=(),
    lifespan=None,
    judge_target: float = 7.0,
    rate_limit: RateLimiter | None = None,
):
    app, metrics = base_app(lifespan, rate_limit)
    clients: set[WebSocket] = set()
    workflow = DesignWorkflow(session, judge, screenshots, judge_target)

    async def broadcast_state(origin: WebSocket, state):
        for peer in list(clients - {origin}):
            try:
                await peer.send_json({"type": "state", "state": state})
            except (WebSocketDisconnect, RuntimeError):
                clients.discard(peer)

    @app.get("/healthz")
    async def health():
        return {
            "ok": True,
            "framework": "google-adk",
            "captureProtocol": "revision-v1",
            "judgeTarget": judge_target,
            "brain": provider,
            "picker": provider,
            "judge": provider,
            "catalog": len(session.catalog),
        }

    @app.get("/state")
    async def state(request: Request):
        credential = request.query_params.get("token") or request.headers.get(
            "authorization", ""
        ).removeprefix("Bearer ")
        if not authorized(credential, token):
            return JSONResponse({"error": "token inválido"}, status_code=401)
        return await session.state()

    @app.websocket("/ws")
    async def websocket(socket: WebSocket):
        await socket.accept()
        if not authorized(socket.query_params.get("token"), token):
            await socket.close(4401, "token inválido")
            return
        if not token and not allowed_origin(socket.headers.get("origin"), allowed_origins):
            await socket.close(4403, "origin no permitido")
            return
        clients.add(socket)
        owner = uuid4().hex
        client_key = socket.client.host if socket.client else "unknown"
        trace_id = trace_id_from_headers(socket.headers)
        connection_request_id = request_id_from_headers(socket.headers)
        with observation_context(connection_request_id, trace_id):
            log.info(
                "WebSocket conectado",
                extra={
                    "structured": {
                        "event": "websocket.connected",
                        "requestId": connection_request_id,
                        "traceId": trace_id,
                    }
                },
            )

        async def emit(message):
            # Observers get persisted conversation/scores as well as geometry.
            if "state" in message and message["type"] != "design.progress":
                await broadcast_state(socket, message["state"])
            await socket.send_json(message)

        async def handle_message(raw):
            request_id = uuid4().hex
            started = time.monotonic()
            operation = "invalid"
            status = 200
            try:
                message = json.loads(raw)
                if not isinstance(message, dict):
                    raise ValueError("El mensaje debe ser un objeto")
                incoming_id = message.get("requestId")
                if incoming_id is not None:
                    if not isinstance(incoming_id, str) or not 1 <= len(incoming_id) <= 128:
                        raise ValueError("requestId inválido")
                    request_id = incoming_id
                operation = message.get("type")
                with observation_context(request_id, trace_id):
                    if limited_for := app.state.rate_limiter.retry_after(client_key):
                        status = 429
                        metrics.observe(str(operation), status, (time.monotonic() - started) * 1000)
                        await socket.send_json(
                            {
                                "type": "error",
                                "requestId": request_id,
                                "error": "Límite de peticiones alcanzado",
                                "retryAfterSeconds": limited_for,
                            }
                        )
                        return
                    if operation == "chat":
                        brief = message.get("text")
                        if not isinstance(brief, str) or not brief.strip() or len(brief) > 20000:
                            raise ValueError("text debe contener entre 1 y 20000 caracteres")
                        revision = message.get("revision")
                        if revision is not None and not isinstance(revision, str):
                            raise ValueError("revision inválida")
                        await workflow.start(
                            owner, brief, request_id, emit, revision, progress=message.get("progress") is True,
                            activity=message.get("activity") is True
                        )
                    elif operation == "edit":
                        revision = message.get("baseRevision")
                        if revision is not None and not isinstance(revision, str):
                            raise ValueError("baseRevision inválida")
                        result = await workflow.edit(
                            request_id, revision, message.get("base"), message.get("desired")
                        )
                        await socket.send_json(result)
                        if result["type"] == "edit.result":
                            await broadcast_state(socket, result["state"])
                    elif operation == "judge":
                        image = message.get("image")
                        run_id, revision = message.get("runId"), message.get("revision")
                        if (
                            not isinstance(image, str)
                            or not isinstance(run_id, str)
                            or not isinstance(revision, str)
                        ):
                            raise ValueError("La captura debe incluir image, runId y revision de la respuesta")
                        accepted = await workflow.capture(
                            owner, run_id, revision, decode_png(image), request_id
                        )
                        if not accepted:
                            await socket.send_json(
                                {
                                    "type": "judge.ignored",
                                    "requestId": request_id,
                                    "reason": "Captura antigua, duplicada o de otro ciclo",
                                }
                            )
                    elif operation == "stop":
                        run_id = message.get("runId")
                        if run_id is not None and not isinstance(run_id, str):
                            raise ValueError("runId inválido")
                        await workflow.stop(owner, run_id)
                    else:
                        raise ValueError("Tipo de mensaje desconocido")
                    metrics.observe(str(operation), 200, (time.monotonic() - started) * 1000)
            except (ValueError, TypeError) as error:
                status = 400
                with observation_context(request_id, trace_id):
                    await socket.send_json({"type": "error", "requestId": request_id, "error": str(error)})
            except Exception:
                status = 500
                log.exception(
                    "Turno fallido",
                    extra={
                        "structured": {
                            "event": "websocket.message.failed",
                            "requestId": request_id,
                            "traceId": trace_id,
                            "operation": str(operation),
                        }
                    },
                )
                metrics.observe(str(operation), 500, (time.monotonic() - started) * 1000)
                await socket.send_json(
                    {
                        "type": "error",
                        "requestId": request_id,
                        "error": "No se pudo completar la operación. Revisa los logs del servidor.",
                    }
                )
            finally:
                with observation_context(request_id, trace_id):
                    log.info(
                        "Operación WebSocket completada",
                        extra={
                            "structured": {
                                "event": "websocket.message.completed",
                                "requestId": request_id,
                                "traceId": trace_id,
                                "operation": str(operation),
                                "status": status,
                                "durationMs": round((time.monotonic() - started) * 1000, 2),
                            }
                        },
                    )

        try:
            try:
                await socket.send_json({"type": "state", "state": await session.state()})
            except Exception:
                await socket.send_json({"type": "error", "error": "Estado de habitación ilegible"})
            while True:
                raw = await socket.receive_text()
                if len(raw.encode()) > MAX_WS_BYTES:
                    await socket.close(1009, "Mensaje demasiado grande")
                    return
                await handle_message(raw)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            clients.discard(socket)
            await workflow.stop(owner, reason="Se ha desconectado la sesión que captura la habitación.")

    return app
