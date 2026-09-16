"""One cancellable design cycle per room, with a browser capture between turns.

The transport only supplies commands and delivers events. No model/renderer/WS
SDK is needed here. A capture ticket is consumed once and identifies both the
cycle and the exact committed revision, so delayed frames cannot drive new work.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import uuid4

from room_designer.application.activity import activity_scope
from room_designer.application.critique import plan_refinement, validate_target, verdict_text
from room_designer.application.design import DesignSession
from room_designer.application.ports import RoomJudge, ScreenshotStore
from room_designer.domain.room import Json

log = logging.getLogger(__name__)
Emit = Callable[[Json], Awaitable[None]]


@dataclass
class Cycle:
    id: str
    owner: str
    brief: str
    emit: Emit
    round: int = 0
    revision: str | None = None
    awaiting_capture: bool = False
    activity: bool = False


class DesignWorkflow:
    def __init__(
        self,
        session: DesignSession,
        judge: RoomJudge,
        screenshots: ScreenshotStore,
        target: float = 7,
        judge_timeout: float = 180,
    ):
        validate_target(target)
        self.session, self.judge, self.screenshots = session, judge, screenshots
        self.target, self.judge_timeout = target, judge_timeout
        self.cycle: Cycle | None = None
        self.task: asyncio.Task | None = None
        # Held only for command scheduling/cancellation, never while a model is running.
        self.control = asyncio.Lock()

    async def start(
        self, owner: str, brief: str, request_id: str, emit: Emit, expected_revision: str | None = None,
        *, activity: bool = False,
    ) -> None:
        async with self.control:
            if expected_revision is not None:
                state = await self.session.state()
                if expected_revision != (state.get("revision") or "initial"):
                    await emit(
                        {
                            "type": "error",
                            "requestId": request_id,
                            "state": state,
                            "error": "La habitación cambió antes del turno. Revisa los cambios y vuelve a enviar tu encargo.",
                        }
                    )
                    return
            await self._stop("Un nuevo encargo ha sustituido el ciclo anterior.")
            cycle = Cycle(uuid4().hex, owner, brief, emit, activity=activity)
            self.cycle = cycle
            self.task = asyncio.create_task(
                self._run(cycle, request_id, lambda: self._design(cycle, brief, request_id))
            )

    async def edit(self, request_id: str, base_revision: str | None, base: Json, desired: Json) -> Json:
        async with self.control:
            await self._stop("Una edición manual ha detenido el ciclo de diseño.")
            return await self.session.edit(request_id, base_revision, base, desired)

    async def capture(self, owner: str, run_id: str, revision: str, png: bytes, request_id: str) -> bool:
        async with self.control:
            cycle = self.cycle
            if not (
                cycle
                and cycle.owner == owner
                and cycle.id == run_id
                and cycle.revision == revision
                and cycle.awaiting_capture
            ):
                return False
            cycle.awaiting_capture = False
            self.task = asyncio.create_task(
                self._run(cycle, request_id, lambda: self._judge(cycle, png, request_id))
            )
            return True

    async def stop(self, owner: str, run_id: str | None = None, reason: str = "Detenido por ti.") -> None:
        async with self.control:
            if self.cycle and self.cycle.owner == owner and (run_id is None or self.cycle.id == run_id):
                await self._stop(reason)

    async def _stop(self, reason: str) -> None:
        cycle, task = self.cycle, self.task
        self.cycle = None
        self.task = None
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if cycle:
            try:
                await cycle.emit({"type": "loop.stopped", "runId": cycle.id, "reason": reason})
            except Exception:
                # Disconnecting owners must not prevent another client starting work.
                log.debug("Could not deliver cycle stop", exc_info=True)

    async def _run(self, cycle: Cycle, request_id: str, operation: Callable[[], Awaitable[None]]) -> None:
        try:
            await operation()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Design cycle failed runId=%s requestId=%s", cycle.id, request_id)
            if self.cycle is cycle:
                self.cycle = None
            try:
                await cycle.emit(
                    {
                        "type": "error",
                        "requestId": request_id,
                        "runId": cycle.id,
                        "error": "El ciclo se ha detenido por un error. Revisa los logs y vuelve a intentarlo.",
                    }
                )
            except Exception:
                log.debug("Could not deliver cycle failure", exc_info=True)

    async def _design(self, cycle: Cycle, brief: str, request_id: str) -> None:
        async def report(entry: Json) -> None:
            if self.cycle is cycle:
                await cycle.emit({"type": "agent.progress", "requestId": request_id,
                                  "runId": cycle.id, "round": cycle.round, "entry": entry})

        result = await self.session.chat(
            brief, request_id, source="judge" if cycle.round else "user", round=cycle.round,
            on_activity=report if cycle.activity else None,
        )
        cycle.revision = result["state"]["revision"]
        cycle.awaiting_capture = not result.get("conversational", False)
        if not cycle.awaiting_capture:
            self.cycle = None
        await cycle.emit(
            {
                "type": "reply",
                "requestId": request_id,
                "runId": cycle.id,
                "judgeBrief": cycle.brief,
                "refinement": cycle.round > 0,
                "round": cycle.round,
                "evaluation": {"runId": cycle.id, "revision": cycle.revision} if cycle.awaiting_capture else None,
                **result,
            }
        )

    async def _judge(self, cycle: Cycle, png: bytes, request_id: str) -> None:
        activity = []

        async def report(entry: Json) -> None:
            activity.append(entry)
            if cycle.activity and self.cycle is cycle:
                await cycle.emit({"type": "agent.progress", "requestId": request_id,
                                  "runId": cycle.id, "round": cycle.round, "phase": "judge", "entry": entry})

        async with asyncio.timeout(self.judge_timeout):
            evidence = await self.screenshots.save(request_id, png)
            with activity_scope(report):
                verdict = await self.judge.judge(cycle.brief, png)
        recorded = await self.session.record_verdict(
            verdict,
            request_id,
            cycle.brief,
            revision=cycle.revision,
            run_id=cycle.id,
            round=cycle.round,
            target=self.target,
            evidence=evidence,
            activity=activity,
        )
        entry = recorded["entry"]
        plan, reason = plan_refinement(recorded["state"], self.target)
        if not plan:
            self.cycle = None
        await cycle.emit(
            {
                "type": "judge.result",
                "activity": activity,
                "requestId": request_id,
                "runId": cycle.id,
                "revision": cycle.revision,
                "verdict": verdict,
                "mean": entry["mean"],
                "target": self.target,
                "judgeText": verdict_text(verdict, entry["mean"]),
                "feedback": plan.brief if plan else None,
                "evidence": evidence,
                "refining": plan is not None,
                "round": cycle.round,
                "stopReason": reason if not plan else None,
                "state": recorded["state"],
            }
        )
        if plan:
            cycle.round = plan.round
            await self._design(cycle, plan.brief, uuid4().hex)
