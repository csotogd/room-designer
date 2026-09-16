"""Persisted design criticism and the score-based refinement policy."""

import math
from dataclasses import dataclass

from room_designer.domain.room import Json

DIMENSION_LABELS = {
    "cohesion": "cohesión",
    "colors": "colores",
    "style": "estilo",
    "adherence": "brief",
    "rotation": "rotación correcta",
    "completeness": "completitud",
}
DIMENSIONS = tuple(DIMENSION_LABELS)


def validate_target(target: float) -> None:
    if isinstance(target, bool) or not math.isfinite(target) or not 1 <= target <= 10:
        raise ValueError("DESIGNER_JUDGE_TARGET debe estar entre 1 y 10")


def mean_score(verdict: Json) -> float:
    """La media pondera por igual las seis dimensiones; overall es informativo."""
    scores = [verdict[k] for k in DIMENSIONS]
    if any(
        isinstance(s, bool) or not isinstance(s, (int, float)) or not math.isfinite(s) or not 1 <= s <= 10
        for s in scores
    ):
        raise ValueError("Las notas deben ser números entre 1 y 10")
    # Do not round before comparing with the target (6.999 is still below 7).
    return sum(scores) / len(scores)


def verdict_text(verdict: Json, mean: float) -> str:
    scores = " · ".join(f"{DIMENSION_LABELS[k]} {verdict[k]:g}/10" for k in DIMENSIONS)
    return f"Nota {mean:g}/10 ({scores}). {verdict.get('notes', '').strip()}".strip()


def record_verdict(
    state: Json,
    verdict: Json,
    request_id: str,
    at: str,
    brief: str,
    *,
    run_id: str = "",
    round: int = 0,
    target: float = 7,
    evidence: str = "",
    activity: list[Json] | None = None,
) -> Json:
    entry = {
        **verdict,
        "at": at,
        "requestId": request_id,
        "brief": brief,
        "mean": mean_score(verdict),
        "revision": state.get("revision"),
        "runId": run_id,
        "round": round,
        "target": target,
        "evidence": evidence,
    }
    state["verdict"] = entry
    state["verdicts"] = (state.get("verdicts", []) + [entry])[-20:]
    state["conversation"] = (
        state.get("conversation", [])
        + [{"role": "judge", "text": verdict_text(verdict, entry["mean"]), "round": round, "activity": activity or []}]
    )[-40:]
    return entry


@dataclass(frozen=True)
class RefinePlan:
    brief: str
    round: int


def plan_refinement(state: Json, target: float) -> tuple[RefinePlan | None, str]:
    """No iteration or stagnation limit. Cancellation/errors belong to the workflow."""
    validate_target(target)
    latest = state["verdict"]
    if latest["mean"] >= target:
        return None, f"objetivo alcanzado ({latest['mean']:g}/10 ≥ {target:g})"
    issues = latest.get("notes", "").strip() or "sin notas del juez"
    low = [f"{DIMENSION_LABELS[k]} {latest[k]:g}/10" for k in DIMENSIONS if float(latest[k]) < target]
    brief = (
        f"El juez de diseño puntúa la habitación con {latest['mean']:g}/10 "
        f"(objetivo {target:g}). Dimensiones flojas: {', '.join(low) or 'ninguna en concreto'}. "
        f"Sus notas: «{issues}». El encargo original era: «{latest.get('brief', '')}». "
        "Corrige los problemas señalados con las herramientas; cambia solo lo necesario. "
        "Revisa los intentos anteriores: si no mejoraron, prueba otra solución."
    )
    return RefinePlan(brief=brief, round=latest.get("round", 0) + 1), ""
