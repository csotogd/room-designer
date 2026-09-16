"""Actividad pública del proveedor y herramientas, separada de la respuesta final."""

import json

import pytest
from conftest import scenario
from google.genai import types
from google.genai.models import AsyncModels
from room_designer.adapters.adk_runtime import AdkRuntime, create_model
from room_designer.application.workflow import DesignWorkflow
from room_designer.config import ModelConfig


@scenario("Agent thinking summaries and tool activity are visible during a turn")
async def test_provider_activity_arrives_before_reply_and_is_remembered(session, monkeypatch):
    calls = []
    events = []

    async def generate(self, **kwargs):
        calls.append(kwargs)
        assert kwargs["config"].thinking_config.include_thoughts is True
        parts = [
            types.Part(text="Voy a comprobar las medidas disponibles.", thought=True, thought_signature=b"private"),
            types.Part(function_call=types.FunctionCall(name="get_room", args={}, id="room")),
        ] if len(calls) == 1 else [
            types.Part(function_call=types.FunctionCall(name="respond_conversationally", args={}, id="answer"))
        ] if len(calls) == 2 else [types.Part(text="¿Qué medidas tiene la habitación?")]
        return types.GenerateContentResponse(candidates=[
            types.Candidate(content=types.Content(role="model", parts=parts), finish_reason="STOP")
        ])

    monkeypatch.setattr(AsyncModels, "generate_content", generate)
    session.runtime = AdkRuntime(create_model(ModelConfig("gemini", "gemini-3.5-flash", "dummy")))

    async def emit(event):
        events.append(event)

    workflow = DesignWorkflow(session, None, None)
    await workflow.start("browser", "Ayúdame con la habitación", "c1", emit, activity=True)
    await workflow.task
    assert events[-1]["type"] == "reply"
    activity = [event for event in events if event["type"] == "agent.progress"]
    assert activity[0]["entry"]["kind"] == "thinking"
    assert activity[0]["entry"]["text"] == "Voy a comprobar las medidas disponibles."
    assert any(event["entry"].get("tool") == "get_room" and event["entry"]["kind"] == "tool_call" for event in activity)
    result = next(event["entry"] for event in activity if event["entry"].get("tool") == "get_room" and event["entry"]["kind"] == "tool_result")
    assert result["data"]["room"] is None
    assert all(event["requestId"] == "c1" and event["round"] == 0 for event in activity)
    assert len({event["runId"] for event in activity}) == 1
    assert events[-1]["activity"] == [event["entry"] for event in activity]
    saved = await session.state()
    assert saved["conversation"][-1]["activity"] == events[-1]["activity"]
    assert "private" not in json.dumps(events)
    assert events[-1]["reply"] == "¿Qué medidas tiene la habitación?"


async def test_activity_scope_is_restored_after_failure():
    from room_designer.application.activity import activity_scope, publish_activity

    entries = []

    async def receive(entry):
        entries.append(entry)

    with pytest.raises(RuntimeError):
        with activity_scope(receive):
            await publish_activity({"kind": "thinking", "text": "Revisando la sala"})
            raise RuntimeError("fallo")
    await publish_activity({"kind": "thinking", "text": "Otro turno"})
    assert len(entries) == 1


async def test_public_summary_is_separate_from_the_final_answer():
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from room_designer.adapters.adk_runtime import run_agent
    from room_designer.application.activity import activity_scope

    class SummaryModel(BaseLlm):
        model: str = "summary-fixture"

        async def generate_content_async(self, llm_request, stream=False):
            yield LlmResponse(content=types.Content(role="model", parts=[
                types.Part(text="Compruebo el espacio libre.", thought=True, thought_signature=b"opaque"),
                types.Part(text="La distribución está lista."),
            ]))

    entries = []

    async def receive(entry):
        entries.append(entry)

    with activity_scope(receive):
        answer = await run_agent(SummaryModel(), "Diseña", [types.Part(text="hola")], [])
    assert answer == "La distribución está lista."
    assert entries == [{"kind": "thinking", "agent": "Diseñador", "text": "Compruebo el espacio libre."}]


@pytest.mark.parametrize("enabled", [True, False])
def test_websocket_progress_is_opt_in(session, enabled):
    from fastapi.testclient import TestClient
    from room_designer.adapters.http import create_designer_app
    from room_designer.application.activity import publish_activity

    class Runtime:
        async def run(self, brief, state, tools):
            await publish_activity({"kind": "thinking", "agent": "Diseñador", "text": "Compruebo las medidas."})
            await next(tool for tool in tools if tool.__name__ == "respond_conversationally")()
            return "Necesito las medidas."

    session.runtime = Runtime()
    with TestClient(create_designer_app(session, None, None, "fake")) as client:
        with client.websocket_connect("/ws") as socket:
            socket.receive_json()
            socket.send_json({"type": "chat", "requestId": "c1", "text": "hola", "activity": enabled})
            first = socket.receive_json()
            assert first["type"] == ("agent.progress" if enabled else "reply")
            if enabled:
                assert socket.receive_json()["type"] == "reply"


@scenario("Judge thinking remains separate from designer thinking")
async def test_judge_activity_is_streamed_and_saved(session, png):
    from room_designer.application.activity import publish_activity

    class Judge:
        async def judge(self, brief, image):
            await publish_activity({"kind": "thinking", "agent": "Juez", "text": "Reviso la circulación."})
            return dict(cohesion=8, colors=8, style=8, adherence=8, rotation=8, completeness=8, notes="Buen acceso")

    class Screenshots:
        async def save(self, request_id, image):
            return "screenshot.png"

    events = []

    async def emit(event):
        events.append(event)

    workflow = DesignWorkflow(session, Judge(), Screenshots())
    await workflow.start("browser", "oficina", "c1", emit, activity=True)
    await workflow.task
    reply = events[-1]
    events.clear()
    await workflow.capture("browser", reply["runId"], reply["state"]["revision"], png, "j1")
    await workflow.task
    assert [event["type"] for event in events] == ["agent.progress", "judge.result"]
    assert events[0]["phase"] == "judge"
    assert events[0]["round"] == 0
    assert events[0]["entry"]["agent"] == "Juez"
    assert events[1]["activity"] == [events[0]["entry"]]
    assert (await session.state())["conversation"][-1]["activity"] == events[1]["activity"]


def test_verdict_remembers_its_public_activity():
    from room_designer.application.critique import record_verdict
    from room_designer.domain.room import empty_state

    state = empty_state()
    activity = [{"kind": "thinking", "agent": "Juez", "text": "Reviso el acceso."}]
    record_verdict(state, dict(cohesion=8, colors=8, style=8, adherence=8, rotation=8, completeness=8), "j", "now", "sala", activity=activity)
    assert state["conversation"][-1]["activity"] == activity


async def test_zone_agent_has_its_own_activity_label(monkeypatch):
    from room_designer.adapters import adk_runtime

    calls = []

    async def run(*args, **kwargs):
        from room_designer.application.activity import current_agent

        calls.append({"agent_label": current_agent()})
        return "Listo"

    monkeypatch.setattr(adk_runtime, "run_agent", run)
    runtime = AdkRuntime(create_model(ModelConfig("fake", "offline", "")))
    await runtime.run("Amuebla", {"activeZone": {"name": "Estudio"}}, [])
    assert calls[-1]["agent_label"] == "Agente · Estudio"


async def test_visual_agents_identify_their_activity(monkeypatch, png):
    from room_designer.adapters import vision

    labels = []

    async def run(*args, **kwargs):
        from room_designer.application.activity import current_agent

        labels.append(current_agent())
        return json.dumps(dict(productId="chair", reason="Adecuado") if len(labels) == 1 else
                          dict(cohesion=8, colors=8, style=8, adherence=8, rotation=8, completeness=8, overall=8, notes="Buen acceso"))

    monkeypatch.setattr(vision, "run_agent", run)
    await vision.AdkPicker(None, None).pick("sala", "silla", [{"id": "chair"}])
    await vision.AdkJudge(None).judge("sala", png)
    assert labels == ["Selector de muebles", "Juez"]
