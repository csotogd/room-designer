"""Cada carga local empieza un ensayo nuevo; una reconexión conserva el ensayo."""

import pytest
from conftest import scenario
from fastapi.testclient import TestClient
from room_designer.adapters.http import create_designer_app


@scenario("Reloading the local editor starts a fresh room")
async def test_new_page_resets_but_reconnection_keeps_work(session, editor):
    editor.place("chair", 1, 1, 0, "chair", "")
    previous = {**editor.state, "conversation": [{"role": "user", "text": "anterior"}],
                "verdicts": [{"mean": 5}], "revision": "previous"}
    await session.repository.save(previous)
    with TestClient(create_designer_app(session, None, None, "fake", fresh_local_sessions=True)) as client:
        with client.websocket_connect("/ws?localPage=first") as socket:
            fresh = socket.receive_json()["state"]
            assert fresh["room"] is None and fresh["items"] == []
            assert not fresh.get("conversation") and not fresh.get("verdicts")
            assert fresh["revision"] != "previous"
        await session.repository.save(previous)
        with client.websocket_connect("/ws?localPage=first") as socket:
            assert socket.receive_json()["state"]["items"] == previous["items"]
        with client.websocket_connect("/ws?localPage=reloaded") as socket:
            assert socket.receive_json()["state"]["items"] == []
    await session.repository.save(previous)
    with TestClient(create_designer_app(session, None, None, "fake")) as client:
        with client.websocket_connect("/ws?localPage=another") as socket:
            assert socket.receive_json()["state"] == previous


async def test_reset_for_a_page_is_idempotent(session, editor):
    from room_designer.application.workflow import DesignWorkflow

    await session.repository.save(editor.state)
    workflow = DesignWorkflow(session, None, None)
    await workflow.reset_for_page("page")
    assert (await session.state())["room"] is None
    await session.repository.save(editor.state)
    await workflow.reset_for_page("page")
    assert (await session.state())["room"] == editor.state["room"]


@pytest.mark.parametrize("page", ["", "x" * 129])
def test_invalid_local_page_id_is_rejected(session, page):
    from starlette.websockets import WebSocketDisconnect

    with TestClient(create_designer_app(session, None, None, "fake", fresh_local_sessions=True)) as client:
        with client.websocket_connect("/ws?localPage=" + page) as socket:
            with pytest.raises(WebSocketDisconnect):
                socket.receive_json()


def test_local_launcher_enables_page_resets(monkeypatch):
    from room_designer import local

    monkeypatch.setattr(local, "read_secret", lambda _: "test-key")
    assert local.local_configuration({})["DESIGNER_LOCAL_FRESH_SESSIONS"] == "1"


def test_bootstrap_passes_local_mode_to_the_websocket(tmp_path, editor):
    import json

    from room_designer.bootstrap import designer_app

    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps(list(editor.catalog.values())))
    room = tmp_path / "room.json"
    room.write_text(json.dumps(editor.state))
    config = {"DESIGNER_PROVIDER": "fake", "DESIGNER_PICKER_PROVIDER": "fake", "DESIGNER_JUDGE_PROVIDER": "fake",
              "CATALOG_INDEX": str(catalog), "DESIGNER_ROOM_FILE": str(room), "DESIGNER_LOCAL_FRESH_SESSIONS": "1"}
    with TestClient(designer_app(config)) as client:
        with client.websocket_connect("/ws?localPage=fresh") as socket:
            assert socket.receive_json()["state"]["room"] is None
