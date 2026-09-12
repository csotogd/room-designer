"""Bucle juez→agente: memoria del veredicto, refinamiento hasta objetivo y paro honesto."""

import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import create_designer_app
from room_designer.application.critique import mean_score, plan_refinement, record_verdict, verdict_text
from room_designer.domain.room import empty_state


def verdict(mean_value: float, notes: str = "faltan plantas") -> dict:
    return {"cohesion": mean_value, "colors": mean_value, "style": mean_value,
            "adherence": mean_value, "overall": mean_value, "notes": notes}


@scenario("The judge's verdict becomes memory the agent can read")
def test_verdict_recorded_in_state_and_conversation():
    state = empty_state()
    entry = record_verdict(state, verdict(5.5), "r1", "2026-01-01T00:00:00Z", "oficina moderna")
    assert state["verdict"]["mean"] == 5.5
    assert state["verdicts"][-1] is entry
    judge_turns = [m for m in state["conversation"] if m["role"] == "judge"]
    assert len(judge_turns) == 1
    assert "5.5/10" in judge_turns[0]["text"] and "faltan plantas" in judge_turns[0]["text"]
    # La media agrega las cuatro métricas del rubric.
    assert mean_score({"cohesion": 4, "colors": 6, "style": 8, "adherence": 6}) == 6
    assert "cohesión" in verdict_text(verdict(5.5), 5.5)


@scenario("The judge and the agent iterate until the mean grade reaches the target")
def test_refinement_planned_until_target():
    state = empty_state()
    record_verdict(state, verdict(5, "las sillas no combinan"), "r1", "t1", "oficina para 2")
    plan, reason = plan_refinement(state, target=7)
    assert plan is not None and reason == ""
    assert plan.round == 1
    assert "5/10" in plan.brief and "las sillas no combinan" in plan.brief
    assert "oficina para 2" in plan.brief  # el encargo original viaja con las notas

    # Mejora hasta el objetivo: el bucle para por NOTA, no por contador.
    record_verdict(state, verdict(6.2), "r1-1", "t2", "oficina para 2")
    plan, _ = plan_refinement(state, target=7)
    assert plan is not None and plan.round == 2
    record_verdict(state, verdict(7.4), "r1-2", "t3", "oficina para 2")
    plan, reason = plan_refinement(state, target=7)
    assert plan is None and "objetivo alcanzado" in reason


@scenario("A refinement loop that stops improving is stopped honestly")
def test_stagnation_stops_the_loop():
    state = empty_state()
    for at, score in (("t1", 5.0), ("t2", 5.0), ("t3", 4.8)):
        record_verdict(state, verdict(score), f"r-{at}", at, "dormitorio")
    plan, reason = plan_refinement(state, target=7, patience=2)
    assert plan is None
    assert "sin mejora" in reason

    # Un encargo nuevo del usuario abre cadena nueva: vuelve a intentarlo.
    record_verdict(state, verdict(5.0), "r2", "t4", "dormitorio más cálido")
    plan, _ = plan_refinement(state, target=7, patience=2)
    assert plan is not None and plan.round == 1


class ScriptedJudge:
    """Puntúa según el guion: primero flojo, luego mejor — como un juez real."""

    def __init__(self, scores):
        self.scores = list(scores)

    async def judge(self, brief, png):
        return verdict(self.scores.pop(0), "coloca una alfombra y equilibra colores")


class ScriptedSession:
    """Sesión mínima: registra los briefs que recibe y simula acciones."""

    def __init__(self, tmp_path):
        self.catalog = {"x": {}}
        self.briefs = []
        self._state = empty_state()

    async def state(self):
        return self._state

    async def chat(self, brief, request_id, source="user"):
        self.briefs.append((source, brief))
        return {"reply": "hecho", "actions": [{"kind": "move", "uid": "u1", "x": 1, "z": 1}],
                "state": self._state, "rejected": []}

    async def record_verdict(self, verdict_payload, request_id, brief):
        entry = record_verdict(self._state, verdict_payload, request_id, "now", brief)
        return {"entry": entry, "state": self._state}


class NullScreenshots:
    async def save(self, request_id, png):
        return "memoria"


@pytest.fixture
def png():
    import io

    from PIL import Image
    output = io.BytesIO()
    Image.new("RGB", (24, 24), "white").save(output, format="PNG")
    return output.getvalue()


def ws_judge(client, png, request_id="j1"):
    import base64
    with client.websocket_connect("/ws") as socket:
        assert socket.receive_json()["type"] == "state"
        socket.send_json({"type": "judge", "requestId": request_id, "brief": "oficina",
                          "image": base64.b64encode(png).decode()})
        messages = [socket.receive_json()]
        while messages[-1]["type"] == "judge.result" and messages[-1]["refining"]:
            messages.append(socket.receive_json())  # el reply de refinamiento
            break
        return messages


def test_ws_low_score_triggers_refinement_turn(tmp_path, png):
    session = ScriptedSession(tmp_path)
    app = create_designer_app(session, ScriptedJudge([5.0]), NullScreenshots(), "fake",
                              judge_target=7.0)
    with TestClient(app) as client:
        messages = ws_judge(client, png)
    judged = messages[0]
    assert judged["mean"] == 5.0 and judged["target"] == 7.0 and judged["refining"] is True
    assert "alfombra" in judged["judgeText"]
    refinement = messages[1]
    assert refinement["type"] == "reply" and refinement["refinement"] is True
    assert refinement["judgeBrief"] == "oficina"  # se sigue juzgando el encargo original
    source, brief = session.briefs[-1]
    assert source == "judge" and "alfombra" in brief and "5/10" in brief


def test_ws_target_reached_stops_loop(tmp_path, png):
    session = ScriptedSession(tmp_path)
    app = create_designer_app(session, ScriptedJudge([7.5]), NullScreenshots(), "fake",
                              judge_target=7.0)
    with TestClient(app) as client:
        messages = ws_judge(client, png)
    assert messages[0]["refining"] is False
    assert "objetivo alcanzado" in messages[0]["stopReason"]
    assert session.briefs == []  # sin ronda extra: nadie molesta al agente


async def test_session_record_verdict_persists(tmp_path, catalog):
    from room_designer.adapters.storage import FileRoomRepository
    from room_designer.adapters.vision import DeterministicPicker
    from room_designer.application.design import DesignSession

    repository = FileRoomRepository(tmp_path / "room.json")
    session = DesignSession(repository, catalog, None, DeterministicPicker(), None)
    recorded = await session.record_verdict(verdict(6.5), "req-9", "salón luminoso")
    assert recorded["entry"]["mean"] == 6.5
    saved = await repository.load()
    assert saved["verdict"]["brief"] == "salón luminoso"
    assert saved["conversation"][-1]["role"] == "judge"
