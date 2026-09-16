"""Aceptación de la división funcional y del amueblado aislado."""
from copy import deepcopy

import pytest
from conftest import scenario
from room_designer.application.design import DesignTools
from room_designer.domain.room import footprint

ZONES = [
    {"id": "study", "name": "Estudio", "x": 0, "z": 0, "w": 2.5, "d": 4},
    {"id": "sleep", "name": "Descanso", "x": 2.5, "z": 0, "w": 2.5, "d": 4},
]


class ZoneRuntime:
    def __init__(self):
        self.visited = []

    async def run(self, brief, state, tools):
        functions = {t.__name__: t for t in tools}
        zone = state["activeZone"]
        self.visited.append((zone["id"], deepcopy(state["items"])))
        result = await functions["place_furniture"]("wooden desk", zone["x"] + 1, 2)
        assert result["status"] == "success"
        return f"Preparada {zone['name']}"


@scenario("A zoning agent divides the room before furnishing each zone independently")
async def test_zones_before_independent_furnishing(design_tools):
    runtime = ZoneRuntime()
    design_tools.runtime = runtime
    assert (await design_tools.set_zones(ZONES))["status"] == "success"
    result = await design_tools.furnish_zones(["study", "sleep"], "Un escritorio en cada zona")
    assert result["status"] == "success"
    assert [z for z, _ in runtime.visited] == ["study", "sleep"]
    assert len(runtime.visited[1][1]) == 0
    state = design_tools.editor.state
    assert state["zones"] == ZONES
    assert [a["kind"] for a in design_tools.editor.actions][1] == "setZones"
    assert len(state["items"]) == 2
    for item, zone in zip(state["items"], ZONES, strict=True):
        x0, x1, z0, z1 = footprint(item, design_tools.editor.catalog[item["productId"]])
        assert zone["x"] <= x0 < x1 <= zone["x"] + zone["w"]
        assert zone["z"] <= z0 < z1 <= zone["z"] + zone["d"]
    assert "activeZone" not in state


@scenario("Invalid zoning leaves the previous plan intact")
@pytest.mark.parametrize("change", [{"x": 2}, {"w": 4}, {"id": "study"}])
async def test_invalid_zones_are_atomic(design_tools, change):
    await design_tools.set_zones(ZONES)
    before = deepcopy(design_tools.editor.state)
    proposed = [ZONES[0], ZONES[1] | change]
    result = await design_tools.set_zones(proposed)
    assert result["status"] == "rejected"
    assert design_tools.editor.state == before


def test_zone_validation_rejects_nonfinite_bounds(editor):
    with pytest.raises(ValueError):
        editor.set_zones([ZONES[0] | {"w": float("nan")}])


def test_zone_scoped_editor_cannot_repair_into_neighbor(editor):
    editor.set_zones(ZONES)
    editor.active_zone = ZONES[0]
    with pytest.raises(ValueError):
        editor.place("bed", 4.5, 2, 0, "bed", "", uid=None)


async def test_zone_scope_rejects_foreign_items_and_room_changes(design_tools):
    await design_tools.set_zones(ZONES)
    editor = design_tools.editor
    item = editor.place("chair", 4, 2, 0, "chair", "")
    editor.active_zone = ZONES[0]
    scoped = DesignTools(editor, design_tools.search, design_tools.picker, "estudio")
    before = deepcopy(editor.state)
    for operation in [scoped.remove_furniture(item["uid"]), scoped.move_furniture(item["uid"], 1, 2),
                      scoped.rotate_furniture(item["uid"], 90), scoped.set_room(10, 10)]:
        assert (await operation)["status"] == "rejected"
    assert editor.state == before


async def test_adk_exposes_only_planning_tools_before_furnishing(design_tools, monkeypatch):
    from room_designer.adapters import adk_runtime

    async def run(model, instruction, parts, tools):
        names = {t.__name__ for t in tools}
        assert {"set_zones", "get_room"} <= names
        assert "furnish_zones" not in names
        assert "place_furniture" not in names
        assert "set_zones" in instruction
        return "Primero distribuiré los usos."

    monkeypatch.setattr(adk_runtime, "run_agent", run)
    runtime = adk_runtime.AdkRuntime(None)
    await runtime.run("dormitorio y estudio", design_tools.editor.state, design_tools.functions())


async def test_adk_zone_agent_cannot_rezone_or_spawn_other_agents(design_tools, monkeypatch):
    import json

    from room_designer.adapters import adk_runtime

    async def run(model, instruction, parts, tools):
        names = {t.__name__ for t in tools}
        assert {"place_furniture", "apply_furniture_changes"} <= names
        assert not {"set_zones", "furnish_zones", "set_room", "add_opening"} & names
        context = json.loads(parts[0].text)["state"]
        assert context["activeZone"] == ZONES[0]
        assert context["zones"] == ZONES
        return "Zona preparada."

    monkeypatch.setattr(adk_runtime, "run_agent", run)
    await adk_runtime.AdkRuntime(None).run("estudio", {
        **design_tools.editor.state, "zones": ZONES, "activeZone": ZONES[0],
    }, design_tools.functions())


async def test_planning_automatically_furnishes_without_another_user_message(session, editor):
    await session.repository.save(editor.state)

    class Planner:
        async def run(self, brief, state, tools):
            if state.get("activeZone"):
                return await ZoneRuntime().run(brief, state, tools)
            await next(t for t in tools if t.__name__ == "set_zones")(ZONES)
            return "Distribución preparada: estudio y descanso."

    session.runtime = Planner()
    result = await session.chat("divide el dormitorio", "plan")
    assert not result["conversational"]
    assert len(result["actions"]) == 2
    assert set(result["state"]["zoneResults"]) == {"study", "sleep"}
    assert result["state"]["zones"] == ZONES
    assert (await session.chat("divide el dormitorio", "plan"))["duplicate"]
    assert (await session.state())["zones"] == ZONES


def test_layout_changes_invalidate_zones_but_furniture_edits_preserve_them(editor):
    from room_designer.domain.reconciliation import scene_snapshot

    editor.set_zones(ZONES)
    editor.place("chair", 1, 2, 0, "chair", "")
    editor.apply({"kind": "syncScene", "scene": scene_snapshot(editor.state)})
    assert editor.state["zones"] == ZONES
    scene = scene_snapshot(editor.state)
    scene["room"]["w"] = 6
    editor.apply({"kind": "syncScene", "scene": scene})
    assert "zones" not in editor.state


async def test_zone_failure_does_not_save_partial_furnishing(session, editor):
    editor.set_zones(ZONES)
    await session.repository.save(editor.state)
    before = await session.state()

    class FailingRuntime(ZoneRuntime):
        async def run(self, brief, state, tools):
            if "activeZone" not in state:
                return await next(t for t in tools if t.__name__ == "furnish_zones")(["study", "sleep"], brief)
            if state["activeZone"]["id"] == "sleep":
                raise RuntimeError("Proveedor no disponible")
            return await super().run(brief, state, tools)

    session.runtime = FailingRuntime()
    with pytest.raises(RuntimeError):
        await session.chat("amuebla las dos zonas", "failure")
    assert await session.state() == before


def test_moving_a_support_cannot_push_its_children_outside_the_zone(editor):
    editor.set_zones(ZONES)
    support = editor.place("desk", 1, 2, 0, "desk", "")
    child = editor.place("chair", 1.5, 2, 0, "chair", "", y=0.8)
    editor.state["items"][-1]["supportedBy"] = support["uid"]
    editor.active_zone = ZONES[0]
    before = deepcopy(editor.state)
    with pytest.raises(ValueError):
        editor.move(support["uid"], 2, 2)
    assert editor.state == before
    assert child["uid"] == editor.state["items"][-1]["uid"]


def test_zone_tool_has_a_typed_geometry_schema(design_tools):
    from google.adk.tools import FunctionTool

    schema = FunctionTool(design_tools.set_zones)._get_declaration().parameters_json_schema
    zone = schema["properties"]["zones"]["items"]
    if "$ref" in zone:
        zone = schema["$defs"][zone["$ref"].split("/")[-1]]
    assert set(zone["properties"]) == {"id", "name", "x", "z", "w", "d"}
    assert set(zone["required"]) == set(zone["properties"])


async def test_offline_adk_furnishes_only_the_selected_zone_and_replays(session, editor):
    from room_designer.domain.room import apply_action, empty_state

    editor.set_zones(ZONES)
    await session.repository.save(editor.state)
    result = await session.chat('Amuebla únicamente la zona «Estudio» (id: study). Respeta las demás zonas.', 'study')
    state = result["state"]
    assert state["items"]
    assert set(state["zoneResults"]) == {"study"}
    assert all(footprint(i, session.catalog[i["productId"]])[1] <= 2.5 for i in state["items"])
    replay = empty_state()
    for entry in state["log"]:
        apply_action(replay, entry["action"], entry["requestId"], entry["at"], entry["source"])
    assert replay == {k: v for k, v in state.items() if k not in ("conversation", "revision")}


async def test_invalid_zone_agent_response_does_not_commit_earlier_zones(design_tools):
    class InvalidRuntime(ZoneRuntime):
        async def run(self, brief, state, tools):
            if state["activeZone"]["id"] == "sleep":
                raise ValueError("Respuesta incompleta del agente")
            return await super().run(brief, state, tools)

    design_tools.runtime = InvalidRuntime()
    await design_tools.set_zones(ZONES)
    before = deepcopy(design_tools.editor.state)
    result = await design_tools.furnish_zones(["study", "sleep"], "escritorios")
    assert result["status"] == "rejected"
    assert design_tools.editor.state == before


@scenario("Zone boundaries are visible while independent agents are furnishing")
async def test_progress_precedes_parallel_agents(session, editor):
    import asyncio

    await session.repository.save(editor.state)
    progress, started = [], []
    both_started = asyncio.Event()

    class ParallelRuntime(ZoneRuntime):
        async def run(self, brief, state, tools):
            if not state.get("activeZone"):
                await next(t for t in tools if t.__name__ == "set_zones")(ZONES)
                return "Reparto listo"
            assert progress and progress[0]["zones"] == ZONES
            started.append(state["activeZone"]["id"])
            if len(started) == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), 1)
            return await super().run(brief, state, tools)

    async def report(state):
        assert state["items"] == []
        progress.append(deepcopy(state))

    session.runtime = ParallelRuntime()
    result = await session.chat("dormitorio con estudio", "automatic", on_progress=report)
    assert sorted(started) == ["sleep", "study"]
    assert len(result["state"]["items"]) == 2


async def test_workflow_emits_opt_in_progress_before_final_reply(session, editor):
    from room_designer.application.workflow import DesignWorkflow

    await session.repository.save(editor.state)

    class Planner(ZoneRuntime):
        async def run(self, brief, state, tools):
            if state.get("activeZone"):
                return await super().run(brief, state, tools)
            await next(t for t in tools if t.__name__ == "set_zones")(ZONES)
            return "Reparto listo"

    session.runtime = Planner()
    events = []

    async def emit(event):
        events.append(event)

    workflow = DesignWorkflow(session, None, None)
    await workflow.start("browser", "estudio y descanso", "progress", emit, progress=True)
    await workflow.task
    assert [e["type"] for e in events] == ["design.progress", "reply"]
    assert events[0]["state"]["zones"] == ZONES
    assert events[0]["state"]["items"] == []
    assert len(events[1]["state"]["items"]) == 2
    assert events[0]["runId"] == events[1]["runId"]
    await workflow.stop("browser")


async def test_cancelling_parallel_furnishing_stops_every_zone_without_saving(session, editor):
    import asyncio

    await session.repository.save(editor.state)
    before = await session.state()
    started, cancelled = set(), set()
    all_started = asyncio.Event()

    class WaitingRuntime:
        async def run(self, brief, state, tools):
            if not state.get("activeZone"):
                await next(t for t in tools if t.__name__ == "set_zones")(ZONES)
                return "Zonas listas"
            zone_id = state["activeZone"]["id"]
            started.add(zone_id)
            if len(started) == 2:
                all_started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.add(zone_id)

    session.runtime = WaitingRuntime()
    turn = asyncio.create_task(session.chat("amueblar", "cancel"))
    await asyncio.wait_for(all_started.wait(), 1)
    turn.cancel()
    with pytest.raises(asyncio.CancelledError):
        await turn
    assert cancelled == {"study", "sleep"}
    assert await session.state() == before


def test_websocket_publishes_zones_before_the_automatic_result(session):
    from fastapi.testclient import TestClient
    from room_designer.adapters.http import create_designer_app

    with TestClient(create_designer_app(session, None, None, "fake")) as client:
        with client.websocket_connect("/ws") as socket:
            socket.receive_json()
            socket.send_json({"type": "chat", "requestId": "auto", "text": "oficina", "progress": True})
            preview = socket.receive_json()
            final = socket.receive_json()
            assert preview["type"] == "design.progress"
            assert preview["state"]["zones"]
            assert preview["state"]["items"] == []
            assert final["type"] == "reply"
            assert final["state"]["items"]
            assert final["requestId"] == preview["requestId"]


def test_manual_edits_keep_zones_when_opening_defaults_are_normalized(editor):
    from room_designer.domain.reconciliation import scene_snapshot

    editor.set_room(editor.state["room"], [{"wall": "N", "kind": "window", "offset": 1, "width": 1}])
    editor.set_zones(ZONES)
    scene = scene_snapshot(editor.state)
    scene["environment"]["timeOfDay"] = 15
    editor.apply({"kind": "syncScene", "scene": scene})
    assert editor.state["zones"] == ZONES
