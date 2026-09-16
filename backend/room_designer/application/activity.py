"""Publica actividad del proveedor sin acoplar los agentes al transporte."""

from collections.abc import Awaitable, Callable
from contextlib import contextmanager
from contextvars import ContextVar

from room_designer.domain.room import Json

ActivitySink = Callable[[Json], Awaitable[None]]
_sink: ContextVar[ActivitySink | None] = ContextVar("agent_activity", default=None)
_agent: ContextVar[str] = ContextVar("activity_agent", default="Diseñador")


@contextmanager
def activity_scope(sink: ActivitySink):
    token = _sink.set(sink)
    try:
        yield
    finally:
        _sink.reset(token)


async def publish_activity(entry: Json) -> None:
    sink = _sink.get()
    if sink is not None:
        await sink(entry)


@contextmanager
def agent_scope(label: str):
    token = _agent.set(label)
    try:
        yield
    finally:
        _agent.reset(token)


def current_agent() -> str:
    return _agent.get()
