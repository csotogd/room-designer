"""La conversación libre decide su continuidad en el servicio Python."""

from copy import deepcopy

import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import create_designer_app
from room_designer.application.workflow import DesignWorkflow


class ConversationRuntime:
    async def run(self, brief, state, tools):
        self.received = (brief, deepcopy(state))
        await next(tool for tool in tools if tool.__name__ == "respond_conversationally")()
        return "¿Qué ambiente te gustaría conseguir?"


@scenario("The backend can answer freely without changing or evaluating the room")
@pytest.mark.parametrize("message", ["hola", "quiero algo más acogedor", "¿cuánto mide el sofá?"])
async def test_conversation_is_controlled_by_service(session, message):
    await session.chat("oficina", "setup")
    before = await session.state()
    runtime = ConversationRuntime()
    session.runtime = runtime
    events = []

    async def emit(event):
        events.append(event)

    workflow = DesignWorkflow(session, None, None)
    await workflow.start("browser", message, "message", emit)
    await workflow.task
    assert events[0]["type"] == "reply"
    assert events[0]["evaluation"] is None
    assert events[0]["reply"] == "¿Qué ambiente te gustaría conseguir?"
    assert runtime.received[0] == message
    after = await session.state()
    for key in ("room", "items", "openings"):
        assert after[key] == before[key]
    assert after["conversation"][-2]["text"] == message
    assert workflow.cycle is None
    assert not await workflow.capture("browser", events[0]["runId"], after["revision"], b"", "capture")


async def test_conversation_tool_prevents_mutations(design_tools):
    before = deepcopy(design_tools.editor.state)
    await design_tools.respond_conversationally()
    result = await design_tools.set_room(8, 8)
    assert result["status"] == "rejected"
    assert design_tools.editor.state == before


async def test_conversation_tool_rejects_a_turn_with_changes(design_tools):
    await design_tools.set_room(8, 8)
    result = await design_tools.respond_conversationally()
    assert result["status"] == "rejected"
    assert not design_tools.conversational


def test_websocket_conversation_remembers_answers_and_retries(session):
    runtime = ConversationRuntime()
    session.runtime = runtime
    with TestClient(create_designer_app(session, None, None, "fake")) as client:
        with client.websocket_connect("/ws") as socket:
            socket.receive_json()
            message = {"type": "chat", "requestId": "c1", "text": "quiero ideas"}
            socket.send_json(message)
            first = socket.receive_json()
            assert first["evaluation"] is None
            assert first["state"]["room"] is None
            socket.send_json(message)
            duplicate = socket.receive_json()
            assert duplicate["duplicate"] is True
            assert duplicate["state"]["conversation"] == first["state"]["conversation"]
            socket.send_json({"type": "chat", "requestId": "c2", "text": "algo cálido"})
            followup = socket.receive_json()
            assert followup["evaluation"] is None
            assert runtime.received[1]["conversation"][-1]["text"] == first["reply"]


async def test_gemini_can_choose_conversation_through_real_adk(session, monkeypatch):
    from google.genai import types
    from google.genai.models import AsyncModels
    from room_designer.adapters.adk_runtime import AdkRuntime, create_model
    from room_designer.config import ModelConfig

    calls = []

    async def generate(self, **kwargs):
        calls.append(kwargs)
        part = (
            types.Part(function_call=types.FunctionCall(name="respond_conversationally", args={}, id="c1"))
            if len(calls) == 1 else types.Part(text="¿Prefieres tonos cálidos o fríos?")
        )
        return types.GenerateContentResponse(candidates=[
            types.Candidate(content=types.Content(role="model", parts=[part]), finish_reason="STOP")
        ])

    monkeypatch.setattr(AsyncModels, "generate_content", generate)
    session.runtime = AdkRuntime(create_model(ModelConfig("gemini", "gemini-3.5-flash", "dummy")))
    result = await session.chat("no sé por dónde empezar", "adk-conversation")
    assert result["conversational"] is True
    assert result["actions"] == []
    assert result["reply"] == "¿Prefieres tonos cálidos o fríos?"
    assert any(part.function_response for content in calls[-1]["contents"] for part in content.parts or [])
