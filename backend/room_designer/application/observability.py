"""Contexto de correlación y formato común para los logs del servicio."""

import json
import logging
import re
import traceback
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from uuid import uuid4

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
_trace_id: ContextVar[str | None] = ContextVar("trace_id", default=None)
_TRACEPARENT = re.compile(r"^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$")
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _generated_id() -> str:
    return uuid4().hex


def request_id_from_headers(headers) -> str:
    candidate = headers.get("x-request-id", "")
    return candidate if _SAFE_ID.fullmatch(candidate) else _generated_id()


def trace_id_from_headers(headers) -> str:
    parent = headers.get("traceparent", "")
    match = _TRACEPARENT.fullmatch(parent)
    if match and set(match.group(1)) != {"0"}:
        return match.group(1)
    candidate = headers.get("x-trace-id", "")
    return candidate if _SAFE_ID.fullmatch(candidate) and candidate != "0" * len(candidate) else _generated_id()


@contextmanager
def observation_context(request_id: str, trace_id: str):
    request_token = _request_id.set(request_id)
    trace_token = _trace_id.set(trace_id)
    try:
        yield
    finally:
        _trace_id.reset(trace_token)
        _request_id.reset(request_token)


class JsonLogFormatter(logging.Formatter):
    """Emite una línea JSON estable y añade el contexto de la operación actual."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(getattr(record, "structured", {}))
        payload["requestId"] = _request_id.get() or payload.get("requestId")
        payload["traceId"] = _trace_id.get() or payload.get("traceId")
        if record.exc_info:
            payload["exception"] = "".join(traceback.format_exception(*record.exc_info)).rstrip()
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
