"""Tandas de cambios ordenadas dentro de un único turno del diseñador."""

import pytest
from conftest import scenario
from room_designer.application.workflow import DesignWorkflow


async def furnished_room(session, editor):
    for uid, x in [("a", 0.8), ("b", 1.8), ("c", 2.8), ("d", 3.8)]:
        editor.apply({"kind": "placeNew", "uid": uid, "productId": "chair",
                      "x": x, "y": 0, "z": 1, "rotDeg": 0})
    await session.repository.save(editor.state)


def corrections():
    return [
        {"operation": "move", "uid": "a", "x": 0.8, "z": 2},
        {"operation": "move", "uid": "b", "x": 1.8, "z": 2},
        {"operation": "rotate", "uid": "c", "rotation": 90},
        {"operation": "replace", "uid": "d", "search_query": "potted plant"},
    ]


class BatchRuntime:
    async def run(self, brief, state, tools):
        batch = next(tool for tool in tools if tool.__name__ == "apply_furniture_changes")
        self.result = await batch(corrections())
        return "He movido dos sillas, girado otra y sustituido la cuarta."


class Judge:
    async def judge(self, brief, png):
        return dict(cohesion=5, colors=5, style=5, adherence=5, notes="Reorganiza las cuatro sillas")


class Screenshots:
    async def save(self, request_id, png):
        return "evidence/" + request_id


@scenario("A judge refinement applies multiple furniture changes before the next evaluation")
async def test_judge_turn_delivers_the_complete_batch(session, editor, png):
    await furnished_room(session, editor)

    class InitialRuntime:
        async def run(self, brief, state, tools):
            return "Revisa la distribución actual."

    session.runtime = InitialRuntime()
    events = []

    async def emit(event):
        events.append(event)

    workflow = DesignWorkflow(session, Judge(), Screenshots())
    await workflow.start("browser", "Mejora la distribución", "initial", emit)
    await workflow.task
    initial = events[-1]
    session.runtime = BatchRuntime()
    await workflow.capture("browser", initial["runId"], initial["state"]["revision"], png, "capture")
    await workflow.task

    assert [event["type"] for event in events] == ["reply", "judge.result", "reply"]
    reply = events[-1]
    assert reply["round"] == 1
    assert [action["kind"] for action in reply["actions"]] == ["move", "move", "rotate", "replace"]
    items = {item["uid"]: item for item in reply["state"]["items"]}
    assert items["a"]["z"] == items["b"]["z"] == 2
    assert items["c"]["rotDeg"] == 90
    assert items["d"]["productId"] == "plant"
    assert reply["evaluation"]["revision"] == (await session.state())["revision"]
    assert workflow.cycle.awaiting_capture
    await workflow.stop("browser")


@scenario("A rejected change does not discard the other changes in a turn")
async def test_batch_reports_rejections_without_losing_other_changes(design_tools):
    item = design_tools.editor.place("chair", 1, 1, 0, "silla", "preparación")
    result = await design_tools.apply_furniture_changes([
        {"operation": "move", "uid": item["uid"], "x": 2, "z": 1},
        {"operation": "remove", "uid": "missing"},
        {"operation": "rotate", "uid": item["uid"], "rotation": 90},
    ])
    assert [entry["status"] for entry in result["results"]] == ["success", "rejected", "success"]
    assert "missing" in result["results"][1]["reason"]
    assert len(design_tools.rejected) == 1
    assert design_tools.editor.existing(item["uid"])["x"] == 2
    assert design_tools.editor.existing(item["uid"])["rotDeg"] == 90


async def test_batch_executes_dependent_changes_in_order(design_tools):
    item = design_tools.editor.place("chair", 1, 1, 0, "silla", "preparación")
    result = await design_tools.apply_furniture_changes([
        {"operation": "rotate", "uid": item["uid"], "rotation": 90},
        {"operation": "remove", "uid": item["uid"]},
    ])
    assert [entry["action"]["kind"] for entry in result["results"]] == ["rotate", "remove"]
    assert design_tools.editor.state["items"] == []


@pytest.mark.parametrize("invalid", [
    {"operation": "unknown"}, {}, {"operation": "rotate", "uid": "a"},
    {"operation": "move", "uid": "a", "x": 1, "z": 2, "extra": True},
    {"operation": []}, None,
])
async def test_malformed_change_is_rejected_and_batch_continues(design_tools, invalid):
    item = design_tools.editor.place("chair", 1, 1, 0, "silla", "preparación")
    result = await design_tools.apply_furniture_changes([
        invalid, {"operation": "rotate", "uid": item["uid"], "rotation": 90},
    ])
    assert [entry["status"] for entry in result["results"]] == ["rejected", "success"]
    assert result["results"][0]["reason"]
    assert len(design_tools.rejected) == 1


async def test_conversational_turn_rejects_all_batch_mutations(design_tools):
    await design_tools.respond_conversationally()
    result = await design_tools.apply_furniture_changes(corrections())
    assert all(entry["status"] == "rejected" for entry in result["results"])
    assert len(design_tools.editor.actions) == 1


async def test_gemini_receives_batch_guidance_and_executes_it_through_adk(session, editor, monkeypatch):
    from google.genai import types
    from google.genai.models import AsyncModels
    from room_designer.adapters.adk_runtime import AdkRuntime, create_model
    from room_designer.config import ModelConfig

    await furnished_room(session, editor)
    calls = []

    async def generate(self, **kwargs):
        calls.append(kwargs)
        instruction = kwargs["config"].system_instruction
        assert "apply_furniture_changes" in instruction
        part = (
            types.Part(function_call=types.FunctionCall(
                name="apply_furniture_changes", args={"changes": corrections()}, id="batch"
            )) if len(calls) == 1 else types.Part(text="He aplicado los cuatro cambios.")
        )
        return types.GenerateContentResponse(candidates=[
            types.Candidate(content=types.Content(role="model", parts=[part]), finish_reason="STOP")
        ])

    monkeypatch.setattr(AsyncModels, "generate_content", generate)
    session.runtime = AdkRuntime(create_model(ModelConfig("gemini", "gemini-3.5-flash", "dummy")))
    result = await session.chat("Mueve dos sillas, gira otra y cambia la cuarta por una planta", "batch")
    assert [action["kind"] for action in result["actions"]] == ["move", "move", "rotate", "replace"]
    assert result["rejected"] == []
    assert len(calls) == 2


def test_batch_tool_describes_each_change_to_the_model(design_tools):
    from google.adk.tools import FunctionTool

    declaration = FunctionTool(design_tools.apply_furniture_changes)._get_declaration()
    schema = declaration.parameters_json_schema
    change = schema["properties"]["changes"]["items"]
    if "$ref" in change:
        change = schema["$defs"][change["$ref"].split("/")[-1]]
    assert set(change["properties"]["operation"]["enum"]) == {"move", "rotate", "replace", "remove"}
    assert set(change["properties"]) == {"operation", "uid", "x", "y", "z", "rotation", "search_query"}
    assert change["required"] == ["operation", "uid"]
