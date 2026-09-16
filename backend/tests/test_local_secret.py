"""Arranque local con autenticación de Google y secretos solo en memoria."""

import base64
import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from conftest import scenario
from google.auth.exceptions import DefaultCredentialsError
from requests import HTTPError
from room_designer.config import ModelConfig

RESOURCE = "projects/room-designer-508414/secrets/room-designer-dev-gemini-api-key/versions/1"


@scenario("Local startup reads the dev secret for every Gemini agent")
def test_local_startup_uses_secret_for_all_roles(monkeypatch, tmp_path, capsys):
    from room_designer import local

    monkeypatch.chdir(tmp_path)
    env_file = tmp_path / ".env"
    env_file.write_text("CATALOG_SITE=polyhaven\n")
    env = {"DESIGNER_PROVIDER": "fake", "DESIGNER_PICKER_PROVIDER": "fake",
           "GOOGLE_API_KEY": "old-key", "DESIGNER_JUDGE_API_KEY": "old-judge-key",
           "DESIGNER_BASE_URL": "https://example.invalid", "GEMINI_BASE_URL": "https://example.invalid"}
    before = dict(env)
    secret = Mock(return_value="test-secret")
    monkeypatch.setattr(local, "read_secret", secret)
    config = local.local_configuration(env)
    secret.assert_called_once_with(RESOURCE)
    for role in ("DESIGNER", "DESIGNER_PICKER", "DESIGNER_JUDGE"):
        model = ModelConfig.from_env(config, role)
        assert (model.provider, model.model, model.api_key, model.base_url) == (
            "gemini", "gemini-3.5-flash", "test-secret", None)
    assert env == before
    assert env_file.read_text() == "CATALOG_SITE=polyhaven\n"
    assert list(tmp_path.iterdir()) == [env_file]
    assert "test-secret" not in str(capsys.readouterr())


@scenario("Local startup stops when the secret cannot be accessed")
def test_failed_access_never_starts_a_server(monkeypatch, capsys):
    from room_designer import local

    monkeypatch.setattr(local, "setup", lambda: None)
    monkeypatch.setattr(local, "read_secret", Mock(side_effect=RuntimeError("Inicia sesión con Google")))
    server = Mock()
    monkeypatch.setattr(local.uvicorn, "run", server)
    with pytest.raises(SystemExit, match="Inicia sesión con Google"):
        local.main()
    server.assert_not_called()
    assert not capsys.readouterr().out


def fake_access(monkeypatch, payload=None, error=None):
    from room_designer.adapters import secret_manager as adapter

    response = Mock()
    response.raise_for_status.side_effect = error
    response.json.return_value = payload or {"payload": {"data": base64.b64encode(b"test-secret").decode()}}
    session = Mock()
    session.get.return_value = response
    context = Mock()
    context.__enter__ = Mock(return_value=session)
    context.__exit__ = Mock(return_value=False)
    credentials = object()
    auth = Mock(return_value=(credentials, "dev"))
    factory = Mock(return_value=context)
    monkeypatch.setattr(adapter.google.auth, "default", auth)
    monkeypatch.setattr(adapter, "AuthorizedSession", factory)
    return adapter, session, auth, factory, credentials


def test_secret_access_uses_adc_and_the_pinned_version(monkeypatch):
    adapter, session, auth, factory, credentials = fake_access(monkeypatch)
    assert adapter.read_secret(RESOURCE) == "test-secret"
    auth.assert_called_once_with(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    factory.assert_called_once_with(credentials)
    session.get.assert_called_once_with(f"https://secretmanager.googleapis.com/v1/{RESOURCE}:access", timeout=15)


@pytest.mark.parametrize("resource", ["https://example.invalid/secret", "projects/p/secrets/x/versions/../1", ""])
def test_invalid_secret_names_never_make_a_request(monkeypatch, resource):
    adapter, session, auth, _, _ = fake_access(monkeypatch)
    with pytest.raises(ValueError, match="versión"):
        adapter.read_secret(resource)
    auth.assert_not_called()
    session.get.assert_not_called()


def test_missing_adc_has_login_instructions_without_private_error(monkeypatch):
    adapter, _, auth, _, _ = fake_access(monkeypatch)
    auth.side_effect = DefaultCredentialsError("private-auth-detail")
    with pytest.raises(RuntimeError) as error:
        adapter.read_secret(RESOURCE)
    assert "gcloud auth application-default login" in str(error.value)
    assert "private-auth-detail" not in str(error.value)
    assert error.value.__suppress_context__


def test_permission_error_does_not_reveal_remote_response(monkeypatch):
    adapter, _, _, _, _ = fake_access(monkeypatch, error=HTTPError("test-secret remote-body"))
    with pytest.raises(RuntimeError) as error:
        adapter.read_secret(RESOURCE)
    assert "Secret Manager" in str(error.value)
    assert "test-secret" not in str(error.value)
    assert error.value.__suppress_context__


@pytest.mark.parametrize("payload", [{"payload": {"data": ""}}, {"payload": {"data": "!!!"}}, {"error": "test-secret"}])
def test_malformed_secret_stops_without_printing_payload(monkeypatch, payload):
    adapter, _, _, _, _ = fake_access(monkeypatch, payload=payload)
    with pytest.raises(RuntimeError, match="Secret Manager") as error:
        adapter.read_secret(RESOURCE)
    assert "test-secret" not in str(error.value)


def test_local_launcher_uses_loopback_and_preserves_process_environment(monkeypatch):
    import os

    from room_designer import local

    monkeypatch.setattr(local, "setup", lambda: None)
    monkeypatch.setenv("DESIGNER_PORT", "8791")
    monkeypatch.setenv("GOOGLE_API_KEY", "old-key")
    monkeypatch.setattr(local, "read_secret", lambda resource: "test-secret")
    app = object()
    build = Mock(return_value=app)
    run = Mock()
    monkeypatch.setattr(local, "designer_app", build)
    monkeypatch.setattr(local.uvicorn, "run", run)
    local.main()
    assert build.call_args.args[0]["GOOGLE_API_KEY"] == "test-secret"
    assert os.environ["GOOGLE_API_KEY"] == "old-key"
    assert run.call_args.args == (app,)
    assert run.call_args.kwargs["host"] == "127.0.0.1"
    assert run.call_args.kwargs["port"] == 8791


def test_local_command_is_available_from_npm():
    root = Path(__file__).resolve().parents[2]
    scripts = json.loads((root / "package.json").read_text())["scripts"]
    assert scripts["designer:local"] == ".venv/bin/python -m room_designer.local"
