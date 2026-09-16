"""Rúbrica de seis dimensiones y criterios del juez visual."""

import json

import pytest
from conftest import scenario
from room_designer.adapters.vision import AdkJudge, Verdict
from room_designer.application.critique import mean_score, plan_refinement, record_verdict
from room_designer.domain.room import empty_state


def grades():
    return dict(cohesion=9, colors=9, style=9, adherence=9, rotation=2, completeness=4, overall=10, notes="Reorienta el sofá y añade los asientos necesarios.")


@scenario("Rotation and completeness count towards the judge target")
def test_rotation_and_completeness_drive_refinement():
    state = empty_state()
    record_verdict(state, grades(), "j1", "now", "salón para cuatro", target=8)
    assert state["verdict"]["mean"] == 7
    assert state["verdict"]["rotation"] == 2
    assert state["verdict"]["completeness"] == 4
    plan, _ = plan_refinement(state, 8)
    assert plan is not None
    assert "rotación correcta 2/10" in plan.brief
    assert "completitud 4/10" in plan.brief
    assert "completitud 4/10" in state["conversation"][-1]["text"]


def test_mean_weights_all_six_dimensions_equally():
    assert mean_score(grades()) == 7


@pytest.mark.parametrize("dimension", ["rotation", "completeness"])
@pytest.mark.parametrize("invalid", [0, 11, float("nan"), True, "7"])
def test_new_dimensions_reject_invalid_scores(dimension, invalid):
    with pytest.raises(ValueError):
        mean_score({**grades(), dimension: invalid})


@pytest.mark.parametrize("dimension", ["rotation", "completeness"])
def test_visual_verdict_requires_both_new_dimensions(dimension):
    value = grades()
    del value[dimension]
    with pytest.raises(ValueError):
        Verdict.model_validate(value)


async def test_visual_judge_explains_rotation_and_balanced_furnishing(monkeypatch, png):
    instructions = []

    async def run(model, instruction, parts, tools):
        instructions.append(instruction)
        return json.dumps(grades())

    monkeypatch.setattr("room_designer.adapters.vision.run_agent", run)
    result = await AdkJudge(None).judge("salón para cuatro", png)
    assert result["rotation"] == 2 and result["completeness"] == 4
    assert all(term in instructions[0] for term in ("rotation", "completeness", "facing", "required furniture", "empty", "overcrowded"))
