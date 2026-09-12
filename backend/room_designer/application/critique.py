"""Bucle juez→agente: el veredicto se recuerda, se conversa y dirige refinamientos.

Nivel 1 — memoria: cada veredicto se anexa al estado (nota actual de la
habitación + conversación en lenguaje natural), así el agente lo ve en
cualquier turno posterior.

Nivel 2 — refinamiento: mientras la nota media (media de cohesión, colores,
estilo y adherencia) quede bajo el objetivo, el servidor relanza al agente
con las notas del juez como encargo. El paro primario es alcanzar el
objetivo; el freno de seguridad no es un tope de iteraciones sino la
convergencia: si la media no mejora durante `patience` rondas seguidas, se
para y se dice — un bucle que no mejora solo quema tokens.
"""

from dataclasses import dataclass

from room_designer.domain.room import Json

DIMENSIONS = ("cohesion", "colors", "style", "adherence")
DIMENSION_LABELS = {"cohesion": "cohesión", "colors": "colores", "style": "estilo", "adherence": "brief"}


def mean_score(verdict: Json) -> float:
    """Nota agregada de la habitación: media de las cuatro métricas del rubric."""
    return round(sum(float(verdict[k]) for k in DIMENSIONS) / len(DIMENSIONS), 2)


def verdict_text(verdict: Json, mean: float) -> str:
    """El veredicto como frase de conversación, legible para usuario y agente."""
    scores = " · ".join(f"{DIMENSION_LABELS[k]} {verdict[k]:g}/10" for k in DIMENSIONS)
    return f"Nota {mean:g}/10 ({scores}). {verdict.get('notes', '').strip()}".strip()


def record_verdict(state: Json, verdict: Json, request_id: str, at: str, brief: str) -> Json:
    """Anexa el veredicto al estado: nota actual, historial y conversación."""
    entry = {"at": at, "requestId": request_id, "brief": brief,
             "mean": mean_score(verdict), **verdict}
    state["verdict"] = entry
    state["verdicts"] = (state.get("verdicts", []) + [entry])[-20:]
    state["conversation"] = (state.get("conversation", [])
                             + [{"role": "judge", "text": verdict_text(verdict, entry["mean"])}])[-20:]
    return entry


@dataclass(frozen=True)
class RefinePlan:
    brief: str
    round: int


def plan_refinement(state: Json, target: float, patience: int = 2) -> tuple[RefinePlan | None, str]:
    """Decide si toca otra ronda: (plan, "") para refinar o (None, motivo del paro)."""
    chain = _current_chain(state)
    latest = chain[-1]
    if latest["mean"] >= target:
        return None, f"objetivo alcanzado ({latest['mean']:g}/10 ≥ {target:g})"
    means = [entry["mean"] for entry in chain]
    if len(means) > patience and all(means[-1 - i] <= means[-2 - i] for i in range(patience)):
        return None, (f"sin mejora en {patience} rondas seguidas "
                      f"({' → '.join(f'{m:g}' for m in means[-patience - 1:])}); mejor revisamos el enfoque juntos")
    issues = latest.get("notes", "").strip() or "sin notas del juez"
    low = [f"{DIMENSION_LABELS[k]} {latest[k]:g}/10" for k in DIMENSIONS if float(latest[k]) < target]
    brief = (f"El juez de diseño puntúa la habitación con {latest['mean']:g}/10 "
             f"(objetivo {target:g}). Dimensiones flojas: {', '.join(low) or 'ninguna en concreto'}. "
             f"Sus notas: «{issues}». El encargo original era: «{latest.get('brief', '')}». "
             "Corrige los problemas señalados con las herramientas; cambia solo lo necesario.")
    return RefinePlan(brief=brief, round=len(chain)), ""


def _current_chain(state: Json) -> list[Json]:
    """Cadena en curso: el tramo final de veredictos que comparte encargo original."""
    verdicts = state.get("verdicts", [])
    if not verdicts:
        raise ValueError("No hay veredictos registrados")
    brief = verdicts[-1].get("brief")
    chain: list[Json] = []
    for entry in reversed(verdicts):
        if entry.get("brief") != brief:
            break
        chain.append(entry)
    return list(reversed(chain))
