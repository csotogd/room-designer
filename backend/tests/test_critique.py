"""Score policy, persisted memory, capture handoff and cancellation regressions."""

import asyncio
import base64
from copy import deepcopy

import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import create_designer_app
from room_designer.application.critique import mean_score, plan_refinement, record_verdict
from room_designer.application.workflow import DesignWorkflow
from room_designer.domain.room import empty_state


def verdict(score, notes="equilibra los colores"):
    return dict(cohesion=score, colors=score, style=score, adherence=score, rotation=score, completeness=score, overall=10, notes=notes)


class ScriptedJudge:
    def __init__(self, scores):
        self.scores = iter(scores)
        self.briefs = []

    async def judge(self, brief, png):
        self.briefs.append(brief)
        return verdict(next(self.scores))


class NullScreenshots:
    async def save(self, request_id, png):
        return "evidence/" + request_id


class RecordingRuntime:
    def __init__(self):
        self.contexts = []

    async def run(self, brief, state, tools):
        self.contexts.append((brief, deepcopy(state)))
        if not state["room"]:
            await next(t for t in tools if t.__name__ == "set_room")(5, 4)
        # Deliberately no actions after the first turn: the cycle must still evaluate.
        return "He revisado el diseño."


@scenario("The judge's verdict becomes memory the agent can read")
async def test_verdict_is_memory_but_old_scores_are_not_current(session):
    session.runtime = RecordingRuntime()
    first = await session.chat("salón luminoso", "c1")
    recorded = await session.record_verdict(
        verdict(5.5), "j1", "salón luminoso", revision=first["state"]["revision"]
    )
    assert recorded["entry"]["mean"] == 5.5
    assert recorded["state"]["conversation"][-1]["role"] == "judge"
    second = await session.chat("mejóralo", "c2")
    assert "5.5/10" in session.runtime.contexts[-1][1]["conversation"][-1]["text"]
    assert second["state"]["revision"] != first["state"]["revision"]
    assert "verdict" not in second["state"]
    assert second["state"]["verdicts"][-1]["mean"] == 5.5
    with pytest.raises(ValueError, match="revisión anterior"):
        await session.record_verdict(verdict(10), "late", "salón", revision=first["state"]["revision"])
    assert "verdict" not in await session.state()


@scenario("The judge and the agent iterate until the mean grade reaches the target")
def test_mean_controls_stop_instead_of_overall_or_rounded_score():
    state = empty_state()
    record_verdict(state, {**verdict(6.999), "overall": 10}, "r", "now", "oficina", round=5)
    plan, reason = plan_refinement(state, 7)
    assert plan is not None and plan.round == 6 and reason == ""
    assert "equilibra los colores" in plan.brief and "oficina" in plan.brief
    record_verdict(state, {**verdict(7), "overall": 1}, "r2", "now", "oficina")
    assert plan_refinement(state, 7)[0] is None
    assert mean_score(dict(cohesion=4, colors=6, style=8, adherence=6, rotation=6, completeness=6)) == 6


@scenario("A refinement loop continues through stagnation until the target is reached")
def test_stagnation_and_history_retention_do_not_limit_rounds():
    state = empty_state()
    for round in range(31):
        record_verdict(state, verdict(5 if round % 2 else 4), str(round), "now", "oficina", round=round)
        plan, _ = plan_refinement(state, 7)
        assert plan is not None and plan.round == round + 1
    assert len(state["verdicts"]) == 20


@pytest.mark.parametrize("target", [0, 11, float("nan"), float("inf"), True])
def test_invalid_target_is_a_startup_error(session, target):
    with pytest.raises(ValueError, match="entre 1 y 10"):
        DesignWorkflow(session, ScriptedJudge([]), NullScreenshots(), target)


@pytest.mark.parametrize("score", [0, 11, float("nan"), float("inf"), True, "7"])
def test_invalid_scores_are_not_persisted_as_verdicts(score):
    state = empty_state()
    with pytest.raises(ValueError, match="entre 1 y 10"):
        record_verdict(state, verdict(score), "r1", "now", "oficina")
    assert "verdict" not in state


def send_capture(socket, reply, png, request_id):
    socket.send_json(
        {
            "type": "judge",
            "requestId": request_id,
            **reply["evaluation"],
            "brief": "this text must not replace the original brief",
            "image": base64.b64encode(png).decode(),
        }
    )


def test_ws_complete_cycle_persists_scores_and_rejects_duplicate_captures(session, png):
    session.runtime = RecordingRuntime()
    scores = [5, 5, 4, 6, 7]
    judge = ScriptedJudge(scores)
    with TestClient(create_designer_app(session, judge, NullScreenshots(), "fake")) as client:
        with client.websocket_connect("/ws") as socket:
            socket.receive_json()
            socket.send_json({"type": "chat", "requestId": "c1", "text": "oficina para 2"})
            reply = first_reply = socket.receive_json()
            run_id = reply["runId"]
            for round, score in enumerate(scores):
                assert reply["round"] == round and reply["runId"] == run_id
                if round:
                    assert reply["actions"] == []  # no hidden no-actions stop
                send_capture(socket, reply, png, f"j{round}")
                judged = socket.receive_json()
                assert judged["type"] == "judge.result"
                assert judged["mean"] == score
                assert judged["refining"] == (score < 7)
                assert judged["state"]["verdict"]["revision"] == reply["state"]["revision"]
                if score < 7:
                    reply = socket.receive_json()
            send_capture(socket, first_reply, png, "duplicate")
            assert socket.receive_json()["type"] == "judge.ignored"
            saved = client.get("/state").json()
            assert [v["mean"] for v in saved["verdicts"]] == scores
            assert saved["verdict"]["evidence"] == "evidence/j4"
            assert judge.briefs == ["oficina para 2"] * len(scores)
            assert len(session.runtime.contexts) == 5
            # Same text is still a NEW cycle, with round numbering reset.
            socket.send_json({"type": "chat", "requestId": "c2", "text": "oficina para 2"})
            fresh = socket.receive_json()
            assert fresh["round"] == 0 and fresh["runId"] != run_id


async def workflow_fixture(session, scores):
    session.runtime = RecordingRuntime()
    events = []

    async def emit(event):
        events.append(event)

    workflow = DesignWorkflow(session, ScriptedJudge(scores), NullScreenshots())
    await workflow.start("owner", "oficina", "c1", emit)
    await workflow.task
    return workflow, events, emit


async def test_capture_from_wrong_client_or_revision_is_ignored(session, png):
    workflow, events, _ = await workflow_fixture(session, [5])
    ticket = events[-1]["evaluation"]
    assert not await workflow.capture("other", ticket["runId"], ticket["revision"], png, "j1")
    assert not await workflow.capture("owner", ticket["runId"], "old-revision", png, "j1")
    assert workflow.judge.briefs == []
    await workflow.stop("owner")
    assert not await workflow.capture("owner", ticket["runId"], ticket["revision"], png, "late")


async def test_stop_interrupts_agent_before_commit(session, png):
    workflow, events, _ = await workflow_fixture(session, [5])
    entered = asyncio.Event()

    class BlockingRuntime:
        async def run(self, brief, state, tools):
            await next(t for t in tools if t.__name__ == "set_room")(8, 8)
            entered.set()
            await asyncio.Event().wait()

    session.runtime = BlockingRuntime()
    ticket = events[-1]["evaluation"]
    await workflow.capture("owner", ticket["runId"], ticket["revision"], png, "j1")
    await asyncio.wait_for(entered.wait(), 2)
    await asyncio.wait_for(workflow.stop("owner"), 2)
    saved = await session.state()
    assert saved["room"]["w"] == 5  # staged 8m room was rolled back
    assert saved["verdict"]["mean"] == 5
    assert events[-1]["type"] == "loop.stopped"
    assert workflow.task is None and workflow.cycle is None
    assert len([e for e in events if e["type"] == "reply"]) == 1


async def test_new_request_cancels_inflight_judge_without_old_verdict(session, png):
    workflow, events, emit = await workflow_fixture(session, [])
    entered = asyncio.Event()
    cancelled = asyncio.Event()

    class BlockingJudge:
        async def judge(self, brief, png):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

    workflow.judge = BlockingJudge()
    old = events[-1]["evaluation"]
    await workflow.capture("owner", old["runId"], old["revision"], png, "j1")
    await asyncio.wait_for(entered.wait(), 2)
    await workflow.start("second-tab", "otro encargo", "c2", emit)
    await workflow.task
    assert cancelled.is_set()
    assert "verdicts" not in await session.state()
    assert not await workflow.capture("owner", old["runId"], old["revision"], png, "late")
    assert events[-1]["round"] == 0 and events[-1]["runId"] != old["runId"]
    # An old/disconnecting tab cannot cancel a different owner's cycle.
    await workflow.stop("owner")
    assert workflow.cycle is not None
    await workflow.stop("second-tab")


async def test_judge_error_is_visible_and_does_not_launch_another_turn(session, png):
    workflow, events, _ = await workflow_fixture(session, [])  # raises: no next score
    ticket = events[-1]["evaluation"]
    await workflow.capture("owner", ticket["runId"], ticket["revision"], png, "j1")
    await workflow.task
    assert events[-1]["type"] == "error"
    assert workflow.cycle is None
    assert len(session.runtime.contexts) == 1
    assert "verdict" not in await session.state()


def test_ws_can_stop_while_agent_is_running(session):
    import threading

    entered = threading.Event()

    class BlockingRuntime:
        async def run(self, brief, state, tools):
            entered.set()
            await asyncio.Event().wait()

    session.runtime = BlockingRuntime()
    with TestClient(create_designer_app(session, ScriptedJudge([]), NullScreenshots(), "fake")) as client:
        with client.websocket_connect("/ws") as socket:
            socket.receive_json()
            socket.send_json({"type": "chat", "text": "oficina", "requestId": "c1"})
            assert entered.wait(2)
            socket.send_json({"type": "stop", "requestId": "s1"})
            assert socket.receive_json()["type"] == "loop.stopped"
            assert client.get("/state").json()["room"] is None
