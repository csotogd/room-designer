"""Real socket fixture for the TypeScript clients' cross-language integration tests."""

import asyncio
import json
import socket
import sys
from pathlib import Path

import httpx
import uvicorn
from room_designer.adapters.adk_runtime import AdkRuntime, OfflineModel
from room_designer.adapters.http import create_designer_app, create_search_app
from room_designer.adapters.storage import FileRoomRepository, HttpProductSearch, LocalScreenshots
from room_designer.adapters.vision import ConstantJudge, DeterministicPicker
from room_designer.application.design import DesignSession
from room_designer.search.embeddings import HashingEmbedder
from room_designer.search.index import SearchIndex


async def main(directory):
    catalog = {
        "chair-1": {
            "id": "chair-1",
            "name": "Office chair",
            "description": "chair",
            "price": 100,
            "width": 0.5,
            "depth": 0.5,
            "height": 0.8,
        }
    }
    sockets = []
    for _ in range(2):
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        sockets.append(sock)
    search_port, designer_port = [s.getsockname()[1] for s in sockets]
    index = SearchIndex(HashingEmbedder())
    await index.sync(list(catalog.values()))
    async with httpx.AsyncClient() as client:
        session = DesignSession(
            FileRoomRepository(directory / "room.json"),
            catalog,
            HttpProductSearch(client, f"http://127.0.0.1:{search_port}", catalog),
            DeterministicPicker(),
            AdkRuntime(OfflineModel()),
        )
        search = uvicorn.Server(uvicorn.Config(create_search_app(index), log_level="error"))
        designer = uvicorn.Server(
            uvicorn.Config(
                create_designer_app(session, ConstantJudge(), LocalScreenshots(directory), "fake"),
                log_level="error",
            )
        )
        print(json.dumps({"searchPort": search_port, "designerPort": designer_port}), flush=True)
        await asyncio.gather(search.serve(sockets=[sockets[0]]), designer.serve(sockets=[sockets[1]]))


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
