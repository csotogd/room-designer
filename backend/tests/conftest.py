import io

import pytest
from PIL import Image
from room_designer.adapters.adk_runtime import AdkRuntime, OfflineModel
from room_designer.adapters.storage import FileRoomRepository
from room_designer.adapters.vision import DeterministicPicker
from room_designer.application.design import DesignSession, DesignTools
from room_designer.domain.room import RoomEditor, empty_state
from room_designer.search.embeddings import HashingEmbedder
from room_designer.search.index import SearchIndex


def scenario(name):
    return pytest.mark.scenario(name)


@pytest.fixture
def catalog():
    entries = [
        ("desk", "Wooden desk work table", 1.0, 0.5, 0.75),
        ("desk2", "Desk white modern", 1.0, 0.5, 0.75),
        ("chair", "Office chair", 0.4, 0.4, 0.95),
        ("shelf", "Bookshelf shelves storage", 0.5, 0.25, 1.5),
        ("plant", "Potted plant", 0.25, 0.25, 0.4),
        ("bed", "Bed frame", 1.2, 1.8, 0.5),
    ]
    return {
        i: {
            "id": i,
            "name": name,
            "description": name,
            "price": 100,
            "width": w,
            "depth": d,
            "height": h,
            "imageUrl": "/catalog/photo.png",
        }
        for i, name, w, d, h in entries
    }


@pytest.fixture
async def search(catalog):
    index = SearchIndex(HashingEmbedder())
    await index.sync(list(catalog.values()))

    class Search:
        async def search(self, query, limit=20):
            return [dict(catalog[h["id"]], score=h["score"]) for h in await index.search(query, limit)]

    return Search()


@pytest.fixture
def editor(catalog):
    editor = RoomEditor(empty_state(), catalog, "test", "2026-09-11T00:00:00Z")
    editor.set_room({"shape": "rect", "w": 5, "d": 4, "h": 2.6}, [])
    return editor


@pytest.fixture
def design_tools(editor, search):
    return DesignTools(editor, search, DeterministicPicker(), "oficina")


@pytest.fixture
def session(tmp_path, catalog, search):
    return DesignSession(
        FileRoomRepository(tmp_path / "room.json"),
        catalog,
        search,
        DeterministicPicker(),
        AdkRuntime(OfflineModel()),
    )


@pytest.fixture
def png():
    data = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(data, "PNG")
    return data.getvalue()
