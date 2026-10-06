"""Importar un plano 2D (foto o dibujo) y convertirlo en borrador editable."""

import base64
import io

import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from PIL import Image
from room_designer.adapters.vision import DeterministicPlanParser
from room_designer.application.plan_import import import_plan
from room_designer.domain.plan import normalize_plan


def plan_png() -> bytes:
    output = io.BytesIO()
    image = Image.new("RGB", (640, 480), "white")
    Image.Image.paste(image, Image.new("RGB", (500, 340), "black"), (70, 70))
    Image.Image.paste(image, Image.new("RGB", (460, 300), "white"), (90, 90))
    image.save(output, format="PNG")
    return output.getvalue()


@scenario("Detected walls are normalized into a closed straight contour")
def test_normalization_snaps_and_closes_the_contour():
    parsed = {
        # Casi rectangular: inclinaciones pequeñas y un hueco de 8 cm al cerrar.
        "corners": [[0.02, 0.0], [5.0, 0.07], [4.97, 4.0], [0.0, 3.95]],
        "openings": [{"wall": 0, "offset": 1.0, "width": 0.9, "kind": "door"}],
        "scaleEstimated": False,
        "confidence": 0.8,
        "notes": "",
    }
    plan = normalize_plan(parsed)
    for (x1, y1), (x2, y2) in zip(plan["corners"], plan["corners"][1:] + plan["corners"][:1]):
        assert x1 == x2 or y1 == y2, "cada tramo queda horizontal o vertical"
    xs = [x for x, _ in plan["corners"]]
    ys = [y for _, y in plan["corners"]]
    assert min(xs) == 0 and min(ys) == 0, "el contorno se traslada al origen"
    assert 4.9 < max(xs) < 5.1 and 3.9 < max(ys) < 4.1
    assert plan["openings"][0]["kind"] == "door"
    assert plan["height"] == 2.5


def test_normalization_keeps_genuinely_diagonal_walls():
    parsed = {
        "corners": [[0, 0], [6, 0], [6, 2.5], [4, 4.5], [0, 4.5]],
        "openings": [],
        "scaleEstimated": False,
        "confidence": 0.9,
        "notes": "",
    }
    plan = normalize_plan(parsed)
    diagonals = [
        (a, b)
        for a, b in zip(plan["corners"], plan["corners"][1:] + plan["corners"][:1])
        if a[0] != b[0] and a[1] != b[1]
    ]
    assert len(diagonals) == 1, "el chaflán real no se aplasta contra un eje"


def test_normalization_rejects_what_is_not_a_room():
    for corners, reason in [
        ([[0, 0], [1, 0]], "contorno"),
        ([[0, 0], [40, 0], [40, 35], [0, 35]], "30"),
        ([[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]], "pequeñ"),
    ]:
        with pytest.raises(ValueError, match=reason):
            normalize_plan({"corners": corners, "openings": [], "scaleEstimated": False,
                            "confidence": 0.5, "notes": ""})


def test_out_of_range_estimated_scale_is_rescaled_not_rejected():
    parsed = {
        # El parser devolvió píxeles en vez de metros: escala estimada.
        "corners": [[0, 0], [500, 0], [500, 340], [0, 340]],
        "openings": [],
        "scaleEstimated": True,
        "confidence": 0.6,
        "notes": "",
    }
    plan = normalize_plan(parsed)
    xs = [x for x, _ in plan["corners"]]
    assert max(xs) <= 30 and plan["scaleEstimated"] is True


def test_openings_outside_their_wall_are_dropped_with_a_note():
    parsed = {
        "corners": [[0, 0], [5, 0], [5, 4], [0, 4]],
        "openings": [
            {"wall": 0, "offset": 1.0, "width": 0.9, "kind": "door"},
            {"wall": 1, "offset": 3.8, "width": 1.2, "kind": "window"},
            {"wall": 9, "offset": 0.5, "width": 0.9, "kind": "door"},
        ],
        "scaleEstimated": False,
        "confidence": 0.7,
        "notes": "",
    }
    plan = normalize_plan(parsed)
    kinds = [o["kind"] for o in plan["openings"]]
    assert kinds == ["door", "window"], "la ventana se acota a su pared y la pared 9 no existe"
    window = plan["openings"][1]
    assert window["offset"] + window["width"] <= 4.01
    assert any("pared" in note for note in plan["dropped"])


@scenario("A floor plan image becomes an editable room draft")
async def test_import_plan_returns_an_editable_draft():
    draft = await import_plan(DeterministicPlanParser(), plan_png())
    assert len(draft["corners"]) >= 4
    assert any(o["kind"] == "door" for o in draft["openings"])
    assert draft["confidence"] > 0
    assert isinstance(draft["scaleEstimated"], bool)


@scenario("Plan measurements stay marked as estimated until confirmed")
async def test_deterministic_parser_marks_scale_as_estimated():
    draft = await import_plan(DeterministicPlanParser(), plan_png())
    assert draft["scaleEstimated"] is True, "sin referencia de escala, las medidas son estimadas"


class FailingParser:
    async def parse(self, image: bytes):
        raise ValueError("La imagen no contiene un plano reconocible")


@scenario("A plan the parser cannot read fails with a clear reason")
async def test_unreadable_plan_fails_with_clear_reason():
    with pytest.raises(ValueError, match="plano reconocible"):
        await import_plan(FailingParser(), plan_png())


# ── Endpoint HTTP del diseñador ──────────────────────────────────────────────


def designer_client(tmp_path, catalog, parser=None):
    from room_designer.adapters.http import create_designer_app
    from room_designer.adapters.storage import FileRoomRepository
    from room_designer.adapters.vision import ConstantJudge, DeterministicPicker
    from room_designer.application.design import DesignSession

    session = DesignSession(FileRoomRepository(tmp_path / "room.json"), catalog, None,
                            DeterministicPicker(), None)
    app = create_designer_app(session, ConstantJudge(), _NullShots(), "fake",
                              plan_parser=parser or DeterministicPlanParser())
    return TestClient(app)


class _NullShots:
    async def save(self, request_id: str, png: bytes) -> str:
        return "memoria"


def data_url(payload: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64," + base64.b64encode(payload).decode()


def test_plan_parse_endpoint_returns_draft(tmp_path, catalog):
    with designer_client(tmp_path, catalog) as client:
        response = client.post("/plan/parse", json={"image": data_url(plan_png())})
    assert response.status_code == 200
    body = response.json()
    assert len(body["corners"]) >= 4 and body["openings"]


def test_plan_parse_accepts_jpeg_photos(tmp_path, catalog):
    photo = io.BytesIO()
    Image.new("RGB", (320, 240), "white").save(photo, format="JPEG")
    with designer_client(tmp_path, catalog) as client:
        response = client.post(
            "/plan/parse", json={"image": data_url(photo.getvalue(), "image/jpeg")}
        )
    assert response.status_code == 200


def test_plan_parse_rejects_bad_payloads(tmp_path, catalog):
    with designer_client(tmp_path, catalog) as client:
        for payload, expected in [
            ({"image": "data:image/png;base64,no-es-base64"}, 400),
            ({"image": data_url(b"GIF89a basura", "image/png")}, 400),
            ({}, 400),
        ]:
            assert client.post("/plan/parse", json=payload).status_code == expected


def test_plan_parse_surfaces_parser_errors_clearly(tmp_path, catalog):
    with designer_client(tmp_path, catalog, FailingParser()) as client:
        response = client.post("/plan/parse", json={"image": data_url(plan_png())})
    assert response.status_code == 422
    assert "plano reconocible" in response.json()["error"]
