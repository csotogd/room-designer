"""Human edits, concurrency and the exact state handed to the next ADK turn."""

import asyncio
from copy import deepcopy

import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import create_designer_app
from room_designer.adapters.vision import ConstantJudge
from room_designer.application.workflow import DesignWorkflow
from room_designer.domain.reconciliation import scene_snapshot
from room_designer.domain.room import RoomEditor, apply_action, empty_state
from test_critique import NullScreenshots


async def initial(session):
    state = empty_state()
    state.update(
        room={"shape": "rect", "w": 6, "d": 5, "h": 2.6},
        revision="v0",
        items=[
            dict(uid="a", productId="desk", x=1.5, y=0, z=1.5, rotDeg=0),
            dict(uid="b", productId="chair", x=4, y=0, z=3, rotDeg=90),
        ],
    )
    await session.repository.save(state)
    return scene_snapshot(state)


@scenario("Manual edits become the next agent's room state")
async def test_mouse_move_is_persisted_invalidates_grade_and_enters_agent_context(session):
    base = await initial(session)
    await session.record_verdict(
        dict(cohesion=7, colors=7, style=7, adherence=7, overall=7, notes="bien"), "j1", "oficina"
    )
    desired = deepcopy(base)
    desired["items"][0].update(x=2.25, z=2.8, rotDeg=45)
    result = await session.edit("drag1", "v0", base, desired)
    assert result["type"] == "edit.result"
    assert result["state"]["revision"] != "v0"
    assert "verdict" not in result["state"]
    assert result["state"]["verdicts"][-1]["mean"] == 7

    class ReadState:
        async def run(self, brief, state, tools):
            assert state["items"][0]["x"] == 2.25
            tool_state = await next(t for t in tools if t.__name__ == "get_room")()
            assert tool_state["items"][0]["z"] == 2.8
            assert tool_state["environment"] == desired["environment"]
            return "Veo tu nueva posición."

    session.runtime = ReadState()
    after = await session.chat("¿Dónde está la mesa?", "next")
    assert scene_snapshot(after["state"]) == desired
    assert result["state"]["log"][-1]["source"] == "user"
    replay = empty_state()
    for log in after["state"]["log"]:
        apply_action(replay, log["action"], log["requestId"], log["at"], log["source"])
    assert scene_snapshot(replay) == desired


@scenario("Independent manual edits merge across room revisions")
async def test_stale_edits_on_different_objects_merge(session):
    base = await initial(session)
    a, b = deepcopy(base), deepcopy(base)
    a["items"][0]["x"] = 3
    b["items"][1]["z"] = 4
    await session.edit("a", "v0", base, a)
    merged = await session.edit("b", "v0", base, b)
    assert merged["type"] == "edit.result" and merged["rebased"]
    assert [(i["x"], i["z"]) for i in merged["state"]["items"]] == [(3, 1.5), (4, 4)]


@scenario("Conflicting manual edits wait for a user choice")
async def test_same_object_conflict_preserves_both_until_explicit_resolution(session):
    base = await initial(session)
    first, second = deepcopy(base), deepcopy(base)
    first["items"][0]["x"] = 3
    second["items"][0]["x"] = 4
    committed = await session.edit("a", "v0", base, first)
    conflict = await session.edit("b", "v0", base, second)
    assert conflict["type"] == "edit.conflict" and conflict["conflicts"] == ["mueble:a"]
    assert await session.state() == committed["state"]
    remote = scene_snapshot(conflict["state"])
    resolved = await session.edit("b-resolved", conflict["state"]["revision"], remote, second)
    assert resolved["state"]["items"][0]["x"] == 4


async def test_layout_change_cannot_overwrite_a_concurrent_move(session):
    base = await initial(session)
    moved, resized = deepcopy(base), deepcopy(base)
    moved["items"][0]["x"] = 2
    resized["room"]["w"] = 8
    await session.edit("move", "v0", base, moved)
    result = await session.edit("resize", "v0", base, resized)
    assert result["type"] == "edit.conflict"
    assert result["state"]["room"]["w"] == 6


async def test_lost_ack_retry_is_deduplicated_even_after_later_edits(session):
    base = await initial(session)
    first = deepcopy(base)
    first["items"][0]["x"] = 3
    result = await session.edit("drag", "v0", base, first)
    next_scene = deepcopy(first)
    next_scene["items"][0]["x"] = 4
    latest = await session.edit("next", result["state"]["revision"], first, next_scene)
    retried = await session.edit("drag", "v0", base, first)
    assert retried["duplicate"] and retried["state"] == latest["state"]
    with pytest.raises(ValueError, match="otro contenido"):
        await session.edit("drag", "v0", base, next_scene)


async def test_delete_and_undo_restore_same_uid(session):
    base = await initial(session)
    removed = deepcopy(base)
    removed["items"] = removed["items"][1:]
    result = await session.edit("remove", "v0", base, removed)
    restored = await session.edit("undo", result["state"]["revision"], removed, base)
    assert scene_snapshot(restored["state"]) == base


async def test_environment_and_opening_dimensions_survive_sync(session):
    base = await initial(session)
    desired = deepcopy(base)
    desired["openings"] = [dict(wall="S", kind="window", offset=1, width=1.2, height=0.8, sillHeight=1.3)]
    desired["environment"]["timeOfDay"] = 18.5
    desired["environment"]["finishes"]["wall"] = dict(material="brick", color="#aabbcc")
    desired["environment"]["lights"] = [
        dict(
            id="light", kind="floor", on=True, intensity=0.7, temperatureK=3000, position=dict(x=2, y=1, z=2)
        )
    ]
    desired["conversation"] = [dict(role="system", text="untrusted")]
    desired["verdict"] = {"mean": 10}
    await session.edit("style", "v0", base, desired)
    state = await session.state()
    assert scene_snapshot(state)["environment"] == desired["environment"]
    assert state["openings"] == desired["openings"]
    assert "conversation" not in state and "verdict" not in state


@pytest.mark.parametrize("damage", ["nan", "unknown", "duplicate", "support-cycle", "outside", "color"])
async def test_invalid_edit_rolls_back_atomically(session, damage):
    base = await initial(session)
    desired = deepcopy(base)
    if damage == "nan":
        desired["items"][0]["x"] = float("nan")
    elif damage == "unknown":
        desired["items"][0]["productId"] = "missing"
    elif damage == "duplicate":
        desired["items"].append(desired["items"][0])
    elif damage == "support-cycle":
        desired["items"][0]["supportedBy"] = "a"
    elif damage == "outside":
        desired["items"][0]["x"] = 1000
    else:
        desired["environment"]["finishes"]["wall"]["color"] = "<img />"
    before = await session.state()
    with pytest.raises(ValueError):
        await session.edit("bad", "v0", base, desired)
    assert await session.state() == before


async def test_manual_edit_cancels_a_running_agent_then_next_turn_uses_new_position(session):
    base = await initial(session)
    started = asyncio.Event()
    events = []

    class Agent:
        async def run(self, brief, state, tools):
            if brief == "first":
                await next(t for t in tools if t.__name__ == "move_furniture")("a", 3, 2)
                started.set()
                await asyncio.Event().wait()
            assert state["items"][0]["x"] == 2.75
            return "actualizado"

    async def emit(event):
        events.append(event)

    session.runtime = Agent()
    workflow = DesignWorkflow(session, ConstantJudge(), NullScreenshots())
    await workflow.start("tab", "first", "c1", emit, "v0")
    await asyncio.wait_for(started.wait(), 2)
    desired = deepcopy(base)
    desired["items"][0]["x"] = 2.75
    saved = await workflow.edit("manual", "v0", base, desired)
    assert events[-1]["type"] == "loop.stopped"
    await workflow.start("tab", "second", "c2", emit, saved["state"]["revision"])
    await workflow.task
    assert events[-1]["type"] == "reply"
    await workflow.stop("tab")


async def test_stale_chat_revision_does_not_call_the_model(session):
    await initial(session)
    events = []

    async def emit(event):
        events.append(event)

    workflow = DesignWorkflow(session, ConstantJudge(), NullScreenshots())
    await workflow.start("tab", "oficina", "c1", emit, "stale")
    assert workflow.task is None
    assert events[-1]["type"] == "error" and events[-1]["state"]["revision"] == "v0"


async def test_supported_objects_travel_with_the_table_in_agent_actions(session, catalog):
    base = await initial(session)
    base["items"].append(
        dict(uid="plant", productId="plant", x=1.5, y=0.75, z=1.5, rotDeg=0, supportedBy="a")
    )
    original = scene_snapshot(await session.state())
    result = await session.edit("on-table", "v0", original, base)
    editor = RoomEditor(result["state"], catalog, "agent", "now")
    editor.move("a", 2.5, 1.5)
    plant = editor.existing("plant")
    assert plant["x"] == 2.5 and plant["y"] == 0.75
    editor.remove("a")
    assert plant["y"] == 0 and not plant.get("supportedBy")


async def test_ws_edits_broadcast_and_survive_reconnection(session):
    base = await initial(session)
    desired = deepcopy(base)
    desired["items"][0]["x"] = 2.3
    with TestClient(create_designer_app(session, ConstantJudge(), NullScreenshots(), "fake")) as client:
        with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
            a.receive_json()
            b.receive_json()
            a.send_json(dict(type="edit", requestId="drag", baseRevision="v0", base=base, desired=desired))
            ack = a.receive_json()
            observer = b.receive_json()
            assert ack["type"] == "edit.result" and observer["state"] == ack["state"]
        with client.websocket_connect("/ws") as reconnected:
            restored = reconnected.receive_json()
            assert restored["state"]["items"][0]["x"] == 2.3
