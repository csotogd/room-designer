"""El progreso muestra cambios aceptados sin confirmar una transacción incompleta."""

import asyncio
from copy import deepcopy

import pytest
from conftest import scenario
from room_designer.application.design import DesignTools
from room_designer.domain.room import RoomEditor


@scenario("Furniture changes appear before the agent finishes its turn")
async def test_live_changes_precede_next_decision(session, editor):
    await session.repository.save(editor.state)
    saved = await session.state()
    previews = []

    async def report(state):
        previews.append(deepcopy(state))
        assert await session.repository.load() == saved

    class Runtime:
        async def run(self, brief, state, tools):
            commands = {t.__name__: t for t in tools}
            item = (await commands["place_furniture"]("wooden desk", 1, 1))["action"]
            assert previews[-1]["items"][0]["uid"] == item["uid"]
            await commands["move_furniture"](item["uid"], 2, 2)
            assert previews[-1]["items"][0]["x"] == 2
            await commands["rotate_furniture"](item["uid"], 90)
            assert previews[-1]["items"][0]["rotDeg"] == 90
            await commands["replace_furniture"](item["uid"], "office chair")
            assert previews[-1]["items"][0]["productId"] == "chair"
            await commands["remove_furniture"](item["uid"])
            assert previews[-1]["items"] == []
            return "Listo"

    session.runtime = Runtime()
    result = await session.chat("amueblar", "live", on_progress=report)
    assert len(previews) == 5
    assert previews[0]["items"][0]["x"] == 1
    assert result["state"]["items"] == []


@scenario("Independent agents share a combined live preview")
async def test_independent_editors_merge_previews(session, editor):
    await session.repository.save(editor.state)
    before = await session.state()
    previews = []

    async def report(state):
        previews.append(deepcopy(state))
        assert await session.repository.load() == before

    class Runtime:
        async def run(self, brief, state, tools):
            children = [DesignTools(RoomEditor(state, session.catalog, "child", "now"),
                                    session.search, session.picker, brief) for _ in range(2)]
            first_ready, second_ready = asyncio.Event(), asyncio.Event()

            async def first():
                result = await children[0].place_furniture("office chair", 1, 1)
                first_ready.set()
                await second_ready.wait()
                await children[0].rotate_furniture(result["action"]["uid"], 90)

            async def second():
                await first_ready.wait()
                await children[1].place_furniture("office chair", 4, 3)
                second_ready.set()

            await asyncio.gather(first(), second())
            assert [len(p["items"]) for p in previews] == [1, 2, 2]
            assert [i["rotDeg"] for i in previews[-1]["items"]] == [90, 0]
            raise RuntimeError("Fallo antes de confirmar")

    session.runtime = Runtime()
    with pytest.raises(RuntimeError, match="Fallo antes"):
        await session.chat("dos zonas", "parallel-live", on_progress=report)
    assert await session.state() == before


async def test_rejected_changes_and_reads_do_not_emit_progress(session, editor):
    await session.repository.save(editor.state)
    previews = []

    async def report(state):
        previews.append(state)

    class Runtime:
        async def run(self, brief, state, tools):
            commands = {t.__name__: t for t in tools}
            await commands["get_room"]()
            assert (await commands["remove_furniture"]("missing"))["status"] == "rejected"
            return "Sin cambios"

    session.runtime = Runtime()
    await session.chat("consulta", "no-preview", on_progress=report)
    assert previews == []


@scenario("Local furnishing has time to complete and explains timeouts")
async def test_local_budget_and_timeout_message(monkeypatch, session):
    from room_designer import local
    from room_designer.application.workflow import DesignWorkflow

    monkeypatch.setattr(local, "read_secret", lambda _: "test-key")
    assert local.local_configuration({})["DESIGNER_TURN_TIMEOUT"] == "600"
    assert local.local_configuration({"DESIGNER_TURN_TIMEOUT": "42"})["DESIGNER_TURN_TIMEOUT"] == "42"

    class SlowRuntime:
        async def run(self, brief, state, tools):
            raise TimeoutError()

    session.runtime = SlowRuntime()
    events = []

    async def emit(event):
        events.append(event)

    workflow = DesignWorkflow(session, None, None)
    await workflow.start("browser", "salón", "timeout", emit)
    await workflow.task
    assert events[-1]["type"] == "error"
    assert "tiempo" in events[-1]["error"]
    assert "no se han guardado" in events[-1]["error"]


@pytest.mark.parametrize("progress", [True, False])
def test_websocket_delivers_furniture_before_reply(session, progress):
    from fastapi.testclient import TestClient
    from room_designer.adapters.http import create_designer_app

    class Runtime:
        async def run(self, brief, state, tools):
            commands = {t.__name__: t for t in tools}
            await commands["set_room"](5, 4)
            await commands["place_furniture"]("office chair", 1, 1)
            return "Silla colocada"

    session.runtime = Runtime()
    with TestClient(create_designer_app(session, None, None, "fake")) as client:
        with client.websocket_connect("/ws") as socket:
            socket.receive_json()
            socket.send_json({"type": "chat", "requestId": "live", "text": "silla", "progress": progress})
            if progress:
                assert socket.receive_json()["state"]["items"] == []
                preview = socket.receive_json()
                assert preview["type"] == "design.progress"
                assert len(preview["state"]["items"]) == 1
            final = socket.receive_json()
            assert final["type"] == "reply"
            if progress:
                assert final["state"]["items"] == preview["state"]["items"]
                assert final["runId"] == preview["runId"]
            socket.send_json({"type": "stop", "runId": final["runId"]})
            assert socket.receive_json()["type"] == "loop.stopped"


async def test_stopping_a_turn_does_not_publish_late_cleanup_changes(session, editor):
    from room_designer.application.workflow import DesignWorkflow

    await session.repository.save(editor.state)
    before = await session.state()
    started = asyncio.Event()
    events = []

    class Runtime:
        async def run(self, brief, state, tools):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                await next(t for t in tools if t.__name__ == "place_furniture")("office chair", 1, 1)
                raise

    async def emit(event):
        events.append(event)

    session.runtime = Runtime()
    workflow = DesignWorkflow(session, None, None)
    await workflow.start("browser", "silla", "cancel", emit, progress=True)
    await asyncio.wait_for(started.wait(), 1)
    await workflow.stop("browser")
    assert [e["type"] for e in events] == ["loop.stopped"]
    assert await session.state() == before


def test_other_browsers_only_receive_confirmed_scenes(session):
    from fastapi.testclient import TestClient
    from room_designer.adapters.http import create_designer_app

    class Runtime:
        async def run(self, brief, state, tools):
            commands = {t.__name__: t for t in tools}
            await commands["set_room"](5, 4)
            await commands["place_furniture"]("office chair", 1, 1)
            return "Listo"

    session.runtime = Runtime()
    with TestClient(create_designer_app(session, None, None, "fake")) as client:
        with client.websocket_connect("/ws") as owner, client.websocket_connect("/ws") as observer:
            owner.receive_json()
            observer.receive_json()
            owner.send_json({"type": "chat", "text": "silla", "progress": True})
            final = owner.receive_json()
            while final["type"] == "design.progress":
                final = owner.receive_json()
            assert final["type"] == "reply"
            assert observer.receive_json() == {"type": "state", "state": final["state"]}
