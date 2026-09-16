import asyncio
import base64
import copy

import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import create_designer_app
from room_designer.adapters.storage import FileRoomRepository, LocalScreenshots
from room_designer.adapters.vision import ConstantJudge, decode_png
from room_designer.domain.room import apply_action, empty_state, repair, violations
from starlette.websockets import WebSocketDisconnect


@scenario("An office brief becomes a furnished room with grounded products")
async def test_office_adk(session, catalog):
    result = await session.chat("créame una oficina para 4", "office")
    items = result["state"]["items"]
    assert len([i for i in items if i["productId"] == "desk"]) == 4
    assert len([i for i in items if i["productId"] == "chair"]) == 4
    assert all(not violations(result["state"], catalog, i) for i in items)
    assert all(i["y"] == 0 for i in items)


@scenario("placeNew lets the picker choose among the searcher's top candidates")
async def test_picker_can_choose_second(design_tools):
    class Picker:
        async def pick(self, brief, query, candidates):
            assert all("imageUrl" in c and "price" in c and "description" in c for c in candidates)
            return {"productId": candidates[1]["id"], "reason": "visual"}

    design_tools.picker = Picker()
    candidates = (await design_tools.search_catalog("desk"))["products"]
    result = await design_tools.place_furniture("desk", 2, 2)
    assert result["action"]["productId"] == candidates[1]["id"]


@scenario("replace swaps the product but keeps the spot")
async def test_replace(design_tools):
    old = (await design_tools.place_furniture("wooden desk", 2, 2))["action"]
    result = await design_tools.replace_furniture(old["uid"], "white modern desk")
    assert result["action"]["productId"] == "desk2"
    for k in ("uid", "x", "z", "rotDeg"):
        assert result["action"][k] == old[k]


@scenario("Nothing lands outside the room or colliding")
async def test_repair_and_reject(design_tools, catalog):
    await design_tools.place_furniture("desk", 0.1, 0.1)
    await design_tools.place_furniture("desk", 0.1, 0.1)
    result = await design_tools.place_furniture("desk", 100, 100)
    assert result["status"] == "rejected"
    assert len(design_tools.editor.state["items"]) == 2
    for item in design_tools.editor.state["items"]:
        assert not violations(design_tools.editor.state, catalog, item)


@scenario("Furniture never blocks a window or a door swing")
@pytest.mark.parametrize("wall,x,z", [("N", 2, 0.2), ("S", 2, 3.8), ("W", 0.2, 2), ("E", 4.8, 2)])
@pytest.mark.parametrize("kind", ["window", "door"])
async def test_openings(design_tools, catalog, wall, x, z, kind):
    await design_tools.add_opening(wall, kind, 1.5, 1)
    result = await design_tools.place_furniture("bookshelf", x, z)
    if result["status"] == "success":
        assert not violations(design_tools.editor.state, catalog, design_tools.editor.state["items"][0])


@scenario("The room file records the state and the full action log")
async def test_persistence_replay(session):
    result = await session.chat("añade una silla", "persist")
    saved = await session.state()
    assert saved == result["state"]
    replay = empty_state()
    for entry in saved["log"]:
        apply_action(replay, entry["action"], entry["requestId"], entry["at"], entry["source"])
    assert replay == {k: v for k, v in saved.items() if k not in ("conversation", "revision")}


@scenario("The websocket serves chat, state and the judge")
async def test_websocket_contract(session, tmp_path, png):
    app = create_designer_app(session, ConstantJudge(), LocalScreenshots(tmp_path), "fake")
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as socket:
            assert socket.receive_json()["type"] == "state"
            socket.send_json({"type": "chat", "requestId": "chat-1", "text": "añade una silla"})
            reply = socket.receive_json()
            assert reply["type"] == "reply" and reply["requestId"] == "chat-1" and reply["actions"]
            socket.send_json(
                {
                    "type": "judge",
                    "requestId": "judge-1",
                    "brief": "silla",
                    "image": base64.b64encode(png).decode(),
                    **reply["evaluation"],
                }
            )
            verdict = socket.receive_json()
            assert verdict["type"] == "judge.result"
            assert verdict["verdict"]["overall"] == 7
            assert __import__("pathlib").Path(verdict["evidence"]).read_bytes() == png
        assert client.get("/state").json()["items"] == reply["state"]["items"]
        assert client.get("/metrics").json()["routes"]["chat"]["count"] == 1


@scenario("The judge scores the rubric dimensions from a screenshot")
async def test_judge(png):
    verdict = await ConstantJudge().judge("office", png)
    assert all(1 <= verdict[k] <= 10 for k in ("cohesion", "colors", "style", "adherence", "rotation", "completeness", "overall"))


@pytest.mark.parametrize("value", [None, float("nan"), float("inf"), True, "2"])
async def test_invalid_coordinates_do_not_persist(design_tools, value):
    before = copy.deepcopy(design_tools.editor.state)
    result = await design_tools.place_furniture("desk", value, 1)
    assert result["status"] == "rejected"
    assert design_tools.editor.state == before


async def test_edit_tools_and_unknown_uid(design_tools):
    action = (await design_tools.place_furniture("chair", 2, 2))["action"]
    uid = action["uid"]
    assert (await design_tools.move_furniture(uid, 3, 3))["status"] == "success"
    assert (await design_tools.rotate_furniture(uid, 90))["status"] == "success"
    assert (await design_tools.remove_furniture(uid))["status"] == "success"
    assert (await design_tools.remove_furniture(uid))["status"] == "rejected"


async def test_resize_replay_converges(design_tools, catalog):
    await design_tools.place_furniture("desk", 4.4, 3.5)
    await design_tools.set_room(2, 2)
    state = design_tools.editor.state
    assert all(not violations(state, catalog, i) for i in state["items"])
    assert any(a["kind"] in ("remove", "move") for a in design_tools.editor.actions)
    replay = empty_state()
    for a in design_tools.editor.actions:
        apply_action(replay, a, "test", "2026-09-11T00:00:00Z")
    assert replay == state


async def test_picker_cannot_select_other_catalog_product(design_tools):
    class Picker:
        async def pick(self, *args):
            return {"productId": "desk2", "reason": "inventado"}

    class Search:
        async def search(self, *args):
            return [{"id": "desk", "score": 1}]

    design_tools.picker, design_tools.search = Picker(), Search()
    result = await design_tools.place_furniture("desk", 2, 2)
    assert result["status"] == "rejected" and not design_tools.editor.state["items"]


async def test_failed_runtime_rolls_back(session):
    class Runtime:
        async def run(self, brief, state, tools):
            functions = {t.__name__: t for t in tools}
            await functions["set_room"](5, 4)
            await functions["place_furniture"]("desk", 2, 2)
            raise RuntimeError("provider unavailable")

    session.runtime = Runtime()
    with pytest.raises(RuntimeError):
        await session.chat("office", "failed")
    assert await session.state() == empty_state()
    assert not session.repository.path.exists()


async def test_timeout_rolls_back_and_releases_lock(session):
    runtime = session.runtime

    class Slow:
        async def run(self, *args):
            await asyncio.sleep(1)

    session.runtime, session.timeout = Slow(), 0.001
    with pytest.raises(TimeoutError):
        await session.chat("brief", "timeout")
    session.runtime, session.timeout = runtime, 10
    assert (await session.chat("añade una silla", "next"))["actions"]


async def test_concurrent_turns_serialized(session):
    a, b = await asyncio.gather(session.chat("añade una silla", "a"), session.chat("añade una silla", "b"))
    saved = await session.state()
    assert len(saved["items"]) == 2
    assert len(saved["conversation"]) == 4
    assert saved == b["state"]
    assert len(a["state"]["items"]) == 1


async def test_corrupt_room_fails(tmp_path):
    repository = FileRoomRepository(tmp_path / "room.json")
    assert await repository.load() == empty_state()
    repository.path.write_text("not json")
    with pytest.raises(ValueError):
        await repository.load()


async def test_auth_origins_and_malformed_message(session, tmp_path):
    app = create_designer_app(session, ConstantJudge(), LocalScreenshots(tmp_path), "fake", token="secret")
    with TestClient(app) as client:
        assert client.get("/state").status_code == 401
        assert client.get("/state?token=secret").status_code == 200
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect("/ws") as socket:
                socket.receive_json()
        assert error.value.code == 4401
        with client.websocket_connect("/ws?token=secret") as socket:
            socket.receive_json()
            for message in ("null", "[]", "broken", '{"type":"chat","text":null}'):
                socket.send_text(message)
                assert socket.receive_json()["type"] == "error"
    app = create_designer_app(session, ConstantJudge(), LocalScreenshots(tmp_path), "fake")
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as socket:
                socket.receive_json()
        assert error.value.code == 4403


@pytest.mark.parametrize("image", ["abc", "data:image/jpeg;base64,YWJj", "!" * 20])
def test_invalid_screenshot(image):
    with pytest.raises(ValueError):
        decode_png(image)


def test_chosen_height_floor_and_ceiling(editor, catalog):
    candidate = {"uid": "new", "productId": "shelf", "x": 2, "y": 1.1, "z": 2, "rotDeg": 0}
    assert not violations(editor.state, catalog, candidate)  # Top exactly touches the ceiling.
    assert repair(editor.state, catalog, candidate)["y"] == 1.1
    for height, violation in [(-0.1, "below-floor"), (1.2, "above-ceiling")]:
        invalid = dict(candidate, y=height)
        assert violation in violations(editor.state, catalog, invalid)
        assert repair(editor.state, catalog, invalid) is None


@scenario("Furniture can be placed and moved at a chosen height")
async def test_3d_tools_and_replay(design_tools, catalog, tmp_path):
    floor = (await design_tools.place_furniture("wooden desk", 2, 2))["action"]
    raised = (await design_tools.place_furniture("wooden desk", 2, 2, y=0.75))["action"]
    assert (raised["x"], raised["y"], raised["z"]) == (2, 0.75, 2)
    uid = raised["uid"]
    moved = (await design_tools.move_furniture(uid, 2, 2, y=1.2))["action"]
    assert moved["y"] == 1.2
    moved = (await design_tools.move_furniture(uid, 3, 2))["action"]
    assert moved["y"] == 1.2  # Omitted height keeps the elevation.
    replaced = (await design_tools.replace_furniture(uid, "white modern desk"))["action"]
    assert replaced["productId"] == "desk2"
    assert (replaced["x"], replaced["y"], replaced["z"]) == (3, 1.2, 2)
    assert (await design_tools.rotate_furniture(uid, 90))["status"] == "success"
    state = design_tools.editor.state
    assert all(not violations(state, catalog, i) for i in state["items"])
    assert state["items"][0]["uid"] == floor["uid"]
    repository = FileRoomRepository(tmp_path / "raised.json")
    await repository.save(state)
    assert await repository.load() == state
    replay = empty_state()
    for entry in state["log"]:
        apply_action(replay, entry["action"], entry["requestId"], entry["at"], entry["source"])
    assert replay == state
    assert (await design_tools.move_furniture(uid, 3, 2, y=0))["action"]["y"] == 0


@pytest.mark.parametrize("height", [-0.1, 2, float("nan"), float("inf"), True, "1"])
async def test_invalid_heights_do_not_persist(design_tools, height):
    placed = (await design_tools.place_furniture("wooden desk", 2, 2, y=0.5))["action"]
    before = copy.deepcopy(design_tools.editor.state)
    assert (await design_tools.place_furniture("wooden desk", 3, 2, y=height))["status"] == "rejected"
    assert (await design_tools.move_furniture(placed["uid"], 2, 2, y=height))["status"] == "rejected"
    assert design_tools.editor.state == before


def test_collision_depends_on_vertical_overlap_and_repair_keeps_height(editor, catalog):
    editor.place("desk", 2, 2, 0, "desk", "test")
    candidate = {"uid": "new", "productId": "desk", "x": 2, "y": 0.5, "z": 2, "rotDeg": 0}
    assert "collision" in violations(editor.state, catalog, candidate)
    assert not violations(editor.state, catalog, dict(candidate, y=0.75))
    fixed = repair(editor.state, catalog, candidate)
    assert fixed["y"] == 0.5
    assert not violations(editor.state, catalog, fixed)


@pytest.mark.parametrize("kind,sill,height", [("window", 0.9, 1.1), ("door", 0, 2)])
def test_opening_clearance_respects_height(editor, catalog, kind, sill, height):
    editor.set_room(editor.state["room"], [
        {"wall": "N", "kind": kind, "offset": 1.5, "width": 1, "sillHeight": sill, "height": height}
    ])
    candidate = {"uid": "new", "productId": "plant", "x": 2, "y": sill, "z": 0.2, "rotDeg": 0}
    assert "blocks-" + kind in violations(editor.state, catalog, candidate)
    assert not violations(editor.state, catalog, dict(candidate, y=sill + height))
    if sill:
        assert not violations(editor.state, catalog, dict(candidate, y=0))


def test_legacy_actions_without_y_and_elevated_resize(editor):
    old = {"kind": "placeNew", "uid": "legacy", "productId": "desk", "x": 2, "z": 2, "rotDeg": 0}
    editor.apply(old)
    assert editor.existing("legacy")["y"] == 0
    editor.move("legacy", 2, 2, y=1)
    editor.apply({"kind": "move", "uid": "legacy", "x": 3, "z": 2})
    editor.apply(dict(old, kind="replace", productId="desk2"))
    assert editor.existing("legacy")["y"] == 1
    editor.set_room({"shape": "rect", "w": 5, "d": 4, "h": 1.5}, [])
    assert not editor.state["items"]  # Resizing never silently lowers a raised piece.


@pytest.mark.parametrize(
    "wall,kind,offset,width",
    [("X", "door", 0, 1), ("N", "door", -1, 1), ("N", "window", 4.5, 1), ("N", "other", 1, 1)],
)
async def test_opening_validation(design_tools, wall, kind, offset, width):
    assert (await design_tools.add_opening(wall, kind, offset, width))["status"] == "rejected"
