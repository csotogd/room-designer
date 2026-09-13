from typing import Protocol

from room_designer.domain.room import Json


class RoomRepository(Protocol):
    async def load(self) -> Json: ...
    async def save(self, state: Json) -> None: ...


class ProductSearch(Protocol):
    async def search(self, query: str, limit: int = 20) -> list[Json]: ...


class ProductPicker(Protocol):
    async def pick(self, brief: str, query: str, candidates: list[Json]) -> Json: ...


class RoomJudge(Protocol):
    async def judge(self, brief: str, png: bytes) -> Json: ...


class ScreenshotStore(Protocol):
    async def save(self, request_id: str, png: bytes) -> str: ...


class AgentRuntime(Protocol):
    async def run(self, brief: str, state: Json, tools: list) -> str: ...
