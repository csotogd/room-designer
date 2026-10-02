"""Combina vistas provisionales sin guardar decisiones de un turno incompleto."""

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy

from room_designer.domain.room import Json

SceneSink = Callable[[Json], Awaitable[Json | None]]
_current: ContextVar["SceneProgress | None"] = ContextVar("scene_progress", default=None)
SCENE_FIELDS = ("room", "openings", "environment", "zones", "zoneResults")


class SceneProgress:
    def __init__(self, state: Json, sink: SceneSink):
        self.state, self.sink = deepcopy(state), sink
        self.lock = asyncio.Lock()
        self.feedback: Json | None = None

    async def report(self, state: Json) -> None:
        async with self.lock:
            self.state = deepcopy(state)
            self.feedback = await self.sink(deepcopy(self.state))

    async def merge(self, before: Json, after: Json) -> Json | None:
        async with self.lock:
            previous = deepcopy(self.state)
            for key in SCENE_FIELDS:
                if before.get(key) != after.get(key):
                    if key in after:
                        self.state[key] = deepcopy(after[key])
                    else:
                        self.state.pop(key, None)
            old = {item["uid"]: item for item in before["items"]}
            new = {item["uid"]: item for item in after["items"]}
            combined = {item["uid"]: item for item in self.state["items"]}
            for uid in old.keys() - new.keys():
                combined.pop(uid, None)
            for uid, item in new.items():
                if old.get(uid) != item:
                    combined[uid] = deepcopy(item)
            self.state["items"] = list(combined.values())
            if self.state != previous:
                self.feedback = await self.sink(deepcopy(self.state))
            return deepcopy(self.feedback)


@contextmanager
def scene_progress(state: Json, sink: SceneSink | None):
    progress = SceneProgress(state, sink) if sink else None
    token = _current.set(progress)
    try:
        yield progress.report if progress else None
    finally:
        _current.reset(token)


async def publish_scene(before: Json, after: Json) -> Json | None:
    progress = _current.get()
    if progress is not None:
        return await progress.merge(before, after)
    return None
