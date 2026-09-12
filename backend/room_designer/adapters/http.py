"""Transport contract compatible with the existing browser clients."""

import asyncio
import hmac
import json
import logging
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from room_designer.adapters.vision import decode_png
from room_designer.application.critique import plan_refinement, verdict_text

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


def base_app(lifespan=None):
    app = FastAPI(lifespan=lifespan)
    metrics = Metrics()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization", "X-Request-Id"],
    )

    @app.middleware("http")
    async def observe(request: Request, call_next):
        request_id = re.sub(r"[^\w.-]", "", request.headers.get("x-request-id", ""))[:64] or uuid4().hex
        request.state.request_id = request_id
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("Petición fallida requestId=%s", request_id)
            response = JSONResponse({"error": "Error interno", "requestId": request_id}, status_code=500)
        elapsed = (time.monotonic() - started) * 1000
        route = request.scope.get("route")
        route_name = f"{request.method} {route.path if route else 'unknown'}"
        metrics.observe(route_name, response.status_code, elapsed)
        log.info(
            json.dumps(
                {
                    "requestId": request_id,
                    "route": route_name,
                    "status": response.status_code,
                    "durationMs": round(elapsed, 2),
                }
            )
        )
        response.headers["x-request-id"] = request_id
        return response

    @app.get("/metrics")
    async def get_metrics():
        return metrics.snapshot()

    return app, metrics


def authorized(actual, expected):
    return not expected or hmac.compare_digest(actual or "", expected)


def create_search_app(service, token="", lifespan=None):
    app, metrics = base_app(lifespan)
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
    session, judge, screenshots, provider: str, token="", allowed_origins=(), lifespan=None,
    judge_target: float = 7.0, judge_patience: int = 2,
):
    app, metrics = base_app(lifespan)
    clients: set[WebSocket] = set()
    # Serialize complete turns including broadcasts so all clients see the same action order.
    turn_lock = asyncio.Lock()

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
                request_id = uuid4().hex
                started = time.monotonic()
                operation = "invalid"
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
                    if operation == "chat":
                        brief = message.get("text")
                        if not isinstance(brief, str) or not brief.strip() or len(brief) > 20000:
                            raise ValueError("text debe contener entre 1 y 20000 caracteres")
                        async with turn_lock:
                            result = await session.chat(brief, request_id)
                            await socket.send_json({"type": "reply", "requestId": request_id,
                                                    "judgeBrief": brief, **result})
                            await broadcast_state(socket, result["state"])
                    elif operation == "judge":
                        brief, image = message.get("brief"), message.get("image")
                        if not isinstance(brief, str) or len(brief) > 20000 or not isinstance(image, str):
                            raise ValueError("brief e image deben ser texto")
                        png = decode_png(image)
                        async with asyncio.timeout(180):
                            evidence = await screenshots.save(request_id, png)
                            verdict = await judge.judge(brief, png)
                        # Nivel 1: el veredicto entra en el estado (nota de la
                        # habitación + conversación) y lo verá cualquier turno.
                        recorded = await session.record_verdict(verdict, request_id, brief)
                        entry = recorded["entry"]
                        # Nivel 2: mientras la media < objetivo, el juez habla
                        # con el agente — el paro primario es la nota, no un
                        # contador; el freno es la falta de mejora sostenida.
                        plan, stop_reason = plan_refinement(recorded["state"], judge_target, judge_patience)
                        await socket.send_json({
                            "type": "judge.result",
                            "requestId": request_id,
                            "verdict": verdict,
                            "mean": entry["mean"],
                            "target": judge_target,
                            "judgeText": verdict_text(verdict, entry["mean"]),
                            "evidence": evidence,
                            "refining": plan is not None,
                            "round": plan.round if plan else None,
                            "stopReason": None if plan else stop_reason,
                        })
                        await broadcast_state(socket, recorded["state"])
                        if plan:
                            async with turn_lock:
                                refine_id = f"{request_id}-r{plan.round}"
                                result = await session.chat(plan.brief, refine_id, source="judge")
                                # El front sigue juzgando contra el ENCARGO
                                # ORIGINAL del usuario, no contra el del juez.
                                await socket.send_json({
                                    "type": "reply",
                                    "requestId": refine_id,
                                    "refinement": True,
                                    "round": plan.round,
                                    "judgeBrief": brief,
                                    **result,
                                })
                                await broadcast_state(socket, result["state"])
                    else:
                        raise ValueError("Tipo de mensaje desconocido")
                    metrics.observe(str(operation), 200, (time.monotonic() - started) * 1000)
                except (ValueError, TypeError) as error:
                    await socket.send_json({"type": "error", "requestId": request_id, "error": str(error)})
                except Exception:
                    log.exception("Turno fallido requestId=%s", request_id)
                    metrics.observe(str(operation), 500, (time.monotonic() - started) * 1000)
                    await socket.send_json(
                        {
                            "type": "error",
                            "requestId": request_id,
                            "error": "No se pudo completar la operación. Revisa los logs del servidor.",
                        }
                    )
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            clients.discard(socket)

    return app
