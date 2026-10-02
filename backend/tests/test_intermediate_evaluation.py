"""El juez corrige avances reales antes de terminar la primera propuesta."""

import asyncio
from copy import deepcopy

from conftest import scenario
from room_designer.application.workflow import DesignWorkflow


def verdict(score):
    return dict(cohesion=score, colors=score, style=score, adherence=score,
                rotation=score, completeness=score, overall=score, notes="Gira la silla 90 grados.")


class Judge:
    def __init__(self):
        self.calls = []

    async def judge(self, brief, png):
        self.calls.append((brief, png))
        return verdict(5 + len(self.calls))


class Screenshots:
    async def save(self, request_id, png):
        return "evidence/" + request_id


@scenario("Judge feedback guides the unfinished furnishing turn")
async def test_review_guides_the_next_action_before_finishing(session, editor, png):
    await session.repository.save(editor.state)
    initial = await session.state()
    events = []
    judge = Judge()
    workflow = DesignWorkflow(session, judge, Screenshots(), preview_every=1)

    class Runtime:
        async def run(self, brief, state, tools):
            commands = {t.__name__: t for t in tools}
            placed = await commands["place_furniture"]("office chair", 1, 1)
            assert placed["judgeFeedback"]["rotation"] == 6
            assert "90" in placed["judgeFeedback"]["notes"]
            uid = placed["action"]["uid"]
            rotated = await commands["rotate_furniture"](uid, 90)
            assert rotated["judgeFeedback"]["mean"] == 7
            assert len(judge.calls) == 2
            assert await session.repository.load() == initial
            return "Propuesta corregida"

    async def emit(event):
        events.append(deepcopy(event))
        if event["type"] == "design.progress" and event.get("evaluation"):
            ticket = event["evaluation"]
            assert await workflow.capture_preview("browser", ticket["runId"], ticket["revision"], png)

    session.runtime = Runtime()
    await workflow.start("browser", "salón", "live-judge", emit, progress=True, live_evaluation=True)
    await workflow.task
    assert events[-1]["type"] == "reply"
    assert events[-1]["state"]["items"][0]["rotDeg"] == 90
    scores = events[-1]["state"]["verdicts"]
    assert [s["mean"] for s in scores] == [6, 7]
    assert all(s["preview"] for s in scores)
    assert "verdict" not in events[-1]["state"]
    assert len([e for e in events if e["type"] == "judge.preview.result"]) == 2
    await workflow.stop("browser")


@scenario("Intermediate evaluation only accepts its matching screenshot")
async def test_old_captures_and_stopped_reviews_are_ignored(session, editor, png):
    await session.repository.save(editor.state)
    initial = await session.state()
    pending = asyncio.Event()
    tickets = []
    judge = Judge()
    workflow = DesignWorkflow(session, judge, Screenshots())

    class Runtime:
        async def run(self, brief, state, tools):
            await next(t for t in tools if t.__name__ == "place_furniture")("office chair", 1, 1)
            raise AssertionError("No debe continuar después de detenerlo")

    async def emit(event):
        if event.get("evaluation") and event["type"] == "design.progress":
            tickets.append(event["evaluation"])
            pending.set()

    session.runtime = Runtime()
    await workflow.start("browser", "salón", "stop-review", emit, progress=True, live_evaluation=True)
    await asyncio.wait_for(pending.wait(), 1)
    ticket = tickets[0]
    assert not await workflow.capture_preview("other", ticket["runId"], ticket["revision"], png)
    assert not await workflow.capture_preview("browser", ticket["runId"], "old", png)
    await workflow.stop("browser")
    assert not await workflow.capture_preview("browser", ticket["runId"], ticket["revision"], png)
    assert judge.calls == []
    assert await session.state() == initial


async def test_feedback_is_returned_by_the_tool_that_triggered_the_preview(session, editor):
    await session.repository.save(editor.state)

    class Runtime:
        async def run(self, brief, state, tools):
            result = await next(t for t in tools if t.__name__ == "place_furniture")("office chair", 1, 1)
            assert result["judgeFeedback"] == {"notes": "Gira la silla"}
            return "Listo"

    async def review(state):
        return {"notes": "Gira la silla"}

    session.runtime = Runtime()
    await session.chat("silla", "feedback", on_progress=review)


def test_websocket_reviews_an_intermediate_capture(session, png):
    import base64

    from fastapi.testclient import TestClient
    from room_designer.adapters.http import create_designer_app

    class Runtime:
        async def run(self, brief, state, tools):
            commands = {t.__name__: t for t in tools}
            await commands["set_room"](5, 4)
            result = await commands["place_furniture"]("office chair", 1, 1)
            assert result["judgeFeedback"]["mean"] == 6
            return "Preparado"

    session.runtime = Runtime()
    with TestClient(create_designer_app(session, Judge(), Screenshots(), "fake")) as client:
        with client.websocket_connect("/ws") as socket:
            socket.receive_json()
            socket.send_json({"type": "chat", "text": "salón", "progress": True, "liveEvaluation": True})
            assert socket.receive_json()["type"] == "design.progress"
            preview = socket.receive_json()
            assert preview.get("evaluation")
            socket.send_json({"type": "judge.preview", **preview["evaluation"],
                              "image": "data:image/png;base64," + base64.b64encode(png).decode()})
            scored = socket.receive_json()
            assert scored["type"] == "judge.preview.result"
            assert scored["verdict"]["mean"] == 6
            assert socket.receive_json()["type"] == "reply"
