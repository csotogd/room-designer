"""Contratos de entrega: eventos reales, fallos y aislamiento, sin red."""

import importlib.util
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from conftest import scenario

ROOT = Path(__file__).resolve().parents[2]


def load_ops_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "ops" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def delivery():
    return load_ops_module("delivery")


def projects():
    return {env: {"project_id": f"designer-{env}-123"} for env in ("dev", "stage", "prod")}


@scenario("Merges deploy only to their matching environment")
def test_environment_routing(delivery):
    targets = [delivery.resolve_target("push", f"refs/heads/{env}", projects()) for env in projects()]
    assert {t["project_id"] for t in targets} == {"designer-dev-123", "designer-stage-123", "designer-prod-123"}
    assert len({t["state_bucket"] for t in targets}) == 3
    for event, ref in [("pull_request", "refs/heads/prod"), ("push", "refs/heads/main"),
                       ("push", "refs/tags/prod"), ("workflow_dispatch", "refs/heads/dev")]:
        with pytest.raises(ValueError):
            delivery.resolve_target(event, ref, projects())


def test_shared_project_is_rejected(delivery):
    config = projects()
    config["prod"] = config["dev"]
    with pytest.raises(ValueError, match="proyectos distintos"):
        delivery.resolve_target("push", "refs/heads/dev", config)


@scenario("Failed quality gates prevent deployment")
def test_delivery_depends_on_every_quality_gate():
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    jobs = workflow["jobs"]
    deploy = jobs["deploy"]
    assert deploy["needs"] == "quality-gate"
    gate = jobs["quality-gate"]
    assert set(gate["needs"]) == {"backend", "calidad", "build", "mutacion", "infra"}
    assert gate["if"] == "${{ always() }}"
    assert "success" in str(gate["steps"])
    assert "github.event_name == 'push'" in deploy["if"]
    assert deploy["environment"]["name"] == "${{ github.ref_name }}"
    assert deploy["concurrency"]["cancel-in-progress"] is False
    assert workflow["permissions"] == {"contents": "read"}
    assert deploy["permissions"]["id-token"] == "write"
    assert not any(j.get("permissions", {}).get("id-token") == "write"
                   for name, j in jobs.items() if name != "deploy")


@scenario("Destructive infrastructure changes require manual review")
@pytest.mark.parametrize("actions", [["delete"], ["create", "delete"], ["delete", "create"]])
def test_destructive_plan_is_rejected(delivery, actions):
    plan = {"resource_changes": [{"address": "google_storage_bucket.assets", "change": {"actions": actions}}]}
    with pytest.raises(ValueError, match="google_storage_bucket.assets"):
        delivery.check_plan(plan)


def test_additive_plan_is_allowed(delivery):
    delivery.check_plan({"resource_changes": [
        {"address": "service", "change": {"actions": ["update"]}},
        {"address": "bucket", "change": {"actions": ["create"]}},
    ]})


@scenario("An unverified release cannot be reported as healthy")
def test_release_verification(delivery):
    with pytest.raises(ValueError, match="revisión"):
        delivery.check_release({"terminalCondition": {"state": "CONDITION_SUCCEEDED"},
                                "latestReadyRevision": "old", "latestCreatedRevision": "new"})
    with pytest.raises(ValueError, match="saludable"):
        delivery.check_release({"terminalCondition": {"state": "CONDITION_FAILED"},
                                "latestReadyRevision": "new", "latestCreatedRevision": "new"})


def test_ready_revision_is_allowed(delivery):
    delivery.check_release({"terminalCondition": {"state": "CONDITION_SUCCEEDED"},
                            "latestReadyRevision": "new", "latestCreatedRevision": "new"})


@scenario("The deployed editor serves the tested commit")
def test_frontend_smoke_checks_release_and_assets(delivery):
    pages = {"/": b'<html><script type="module" src="/assets/app.js"></script></html>',
             "/release.json": json.dumps({"commit": "a" * 40}).encode(),
             "/assets/app.js": b"export const application = true"}
    visited = []

    def fetch(path):
        visited.append(path)
        return pages[path]

    delivery.check_frontend(fetch, "a" * 40)
    assert set(visited) == set(pages)
    with pytest.raises(ValueError, match="commit"):
        delivery.check_frontend(fetch, "b" * 40)
    pages["/assets/app.js"] = b""
    with pytest.raises(ValueError, match="asset"):
        delivery.check_frontend(fetch, "a" * 40)


def test_smoke_cannot_succeed_without_an_editor_bundle(delivery):
    with pytest.raises(ValueError, match="JavaScript"):
        delivery.check_frontend(lambda _: b"<html>error page</html>", "a" * 40)


@pytest.fixture
def cloud_smoke(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "ops"))
    return load_ops_module("cloud_smoke")


class CloudFake:
    def __init__(self, fail_on=None):
        self.calls = []
        self.fail_on = fail_on
        self.data = {}

    def __call__(self, method, url, body=None, raw=False):
        self.calls.append((method, url))
        if self.fail_on and self.fail_on in url and method == "GET":
            raise RuntimeError("Permiso denegado")
        if "upload/storage" in url:
            return {}
        if method == "GET" and "alt=media" in url:
            return b"commit"
        if url.endswith(":pull"):
            return {"receivedMessages": [{"message": {"data": "Y29tbWl0"}}]}
        if method == "PATCH":
            self.data[url] = body
        return self.data.get(url, {})


@scenario("An unverified release cannot be reported as healthy")
def test_resource_failure_fails_smoke_and_cleans_test_data(cloud_smoke):
    api = CloudFake(fail_on="alt=media")
    with pytest.raises(RuntimeError, match="Permiso denegado"):
        cloud_smoke.verify_resources(api, "designer-dev-123", "dev", "commit", "probe")
    assert any(method == "DELETE" and "/o/smoke%2Fprobe" in url for method, url in api.calls)


def test_cloud_probes_use_disposable_data_not_the_generation_queue(cloud_smoke):
    api = CloudFake()
    cloud_smoke.verify_resources(api, "designer-dev-123", "dev", "commit", "probe")
    writes = [(method, url) for method, url in api.calls if method != "GET"]
    assert all("probe" in url for _, url in writes)
    assert any("firestore.googleapis.com" in url for _, url in writes)
    assert any(url.endswith(":publish") for _, url in writes)
    assert sum(method == "DELETE" for method, _ in writes) == 4


def test_bad_queue_round_trip_is_not_a_success(cloud_smoke):
    api = CloudFake()

    def altered_api(method, url, body=None, raw=False):
        if url.endswith(":pull"):
            return {"receivedMessages": [{"message": {"data": "d3Jvbmc="}}]}
        return api(method, url, body, raw)

    with pytest.raises(ValueError, match="Pub/Sub"):
        cloud_smoke.verify_resources(altered_api, "designer-dev-123", "dev", "commit", "probe")
    assert sum(method == "DELETE" for method, _ in api.calls) == 4


@scenario("Cloud Build in the target project must pass before deployment")
def test_cloud_build_is_the_container_quality_gate(delivery):
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    steps = workflow["jobs"]["deploy"]["steps"]
    build = next(i for i, step in enumerate(steps) if "gcloud builds submit" in step.get("run", ""))
    apply = next(i for i, step in enumerate(steps) if "tofu -chdir=infra/gcp apply" in step.get("run", ""))
    assert build < apply
    assert '--project="$PROJECT_ID"' in steps[build]["run"]
    config = yaml.safe_load((ROOT / "cloudbuild.yaml").read_text())
    assert {step["id"] for step in config["steps"]} >= {"build-frontend", "smoke-frontend", "build-pipeline", "smoke-pipeline"}
    assert not any(step.get("allowFailure") or step.get("allowExitCodes") for step in config["steps"])
    assert config["images"] == ["europe-west1-docker.pkg.dev/$PROJECT_ID/room-designer-${_ENVIRONMENT}-pipeline/frontend:${_COMMIT_SHA}-$BUILD_ID"]
    image = "example.com/frontend:commit"
    result = {"status": "SUCCESS", "substitutions": {"_COMMIT_SHA": "a" * 40},
              "results": {"images": [{"name": image, "digest": "sha256:" + "b" * 64}]}}
    assert delivery.build_image(result, "a" * 40, image) == "example.com/frontend@sha256:" + "b" * 64


@pytest.mark.parametrize("status", ["FAILURE", "CANCELLED", "TIMEOUT", "WORKING", "QUEUED", "INTERNAL_ERROR"])
def test_cloud_build_not_success_cannot_supply_an_image(delivery, status):
    with pytest.raises(ValueError, match="Cloud Build"):
        delivery.build_image({"status": status}, "a" * 40, "example.com/frontend:commit")


def test_cloud_build_from_another_commit_is_rejected(delivery):
    with pytest.raises(ValueError, match="commit"):
        delivery.build_image({"status": "SUCCESS", "substitutions": {"_COMMIT_SHA": "b" * 40}},
                             "a" * 40, "example.com/frontend:commit")


@pytest.mark.parametrize("status", ["failure", "cancelled", "skipped", "success"])
def test_quality_gate_executes_fail_closed(status):
    workflow = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
    gate = workflow["jobs"]["quality-gate"]
    results = {name: {"result": "success"} for name in gate["needs"]}
    results["backend"]["result"] = status
    # Ejecutar la guarda real del workflow, no una reimplementación del condicional.
    script = gate["steps"][0]["run"]
    result = subprocess.run(["bash", "-c", script], env={**os.environ, "RESULTS": json.dumps(results),
                            "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ["PATH"]},
                            capture_output=True)
    assert (result.returncode == 0) == (status == "success")


@pytest.fixture
def verify_private_editor(cloud_smoke, monkeypatch, tmp_path):
    url, commit, image = "https://editor.example", "a" * 40, "registry/editor@sha256:" + "b" * 64
    for key, value in {"PROJECT_ID": "designer-dev-123", "ENVIRONMENT": "dev", "COMMIT_SHA": commit,
                       "EXPECTED_WEB_IMAGE": image, "GITHUB_OUTPUT": str(tmp_path / "output"),
                       "GITHUB_STEP_SUMMARY": str(tmp_path / "summary")}.items():
        monkeypatch.setenv(key, value)
    calls, visited = [], []

    def api(method, endpoint, body=None):
        calls.append((method, endpoint, body))
        if endpoint.endswith(":generateIdToken"):
            return {"token": "short-lived-token"}
        return {"uri": url, "terminalCondition": {"state": "CONDITION_SUCCEEDED"},
                "latestReadyRevision": "ready", "latestCreatedRevision": "ready",
                "template": {"containers": [{"image": image}]}}

    def credentials(*args):
        assert args == ("gcloud", "auth", "print-access-token"), "No segunda impersonación de acceso"
        return "existing-access-token"

    pages = {"/": b'<script src="/assets/app.js"></script>',
             "/release.json": json.dumps({"commit": commit}).encode(), "/assets/app.js": b"editor()"}

    def fetch(request, timeout):
        assert request.get_header("Authorization") == "Bearer short-lived-token"
        assert request.full_url.startswith(url + "/")
        visited.append(request.full_url)
        return io.BytesIO(pages[request.full_url.removeprefix(url)])

    monkeypatch.setattr(cloud_smoke, "command", credentials)
    monkeypatch.setattr(cloud_smoke, "GoogleApi", lambda token: api)
    monkeypatch.setattr(cloud_smoke, "verify_resources", lambda *args: None)
    monkeypatch.setattr(cloud_smoke, "urlopen", fetch)

    def verify():
        cloud_smoke.main()
        assert calls[-1] == (
            "POST", "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/"
            "rd-dev-deploy@designer-dev-123.iam.gserviceaccount.com:generateIdToken",
            {"audience": url, "includeEmail": True},
        )
        assert visited == [url + path for path in pages]
        assert (tmp_path / "output").read_text() == f"frontend_url={url}\n"

    return verify


@scenario("The private editor is verified with an audience-bound identity token")
def test_private_editor_uses_only_its_existing_id_token_permission(verify_private_editor):
    verify_private_editor()


def test_identity_token_is_minted_directly_for_its_audience(cloud_smoke):
    calls = []

    def api(*args):
        calls.append(args)
        return {"token": "short-lived-token"}

    token = cloud_smoke.private_identity_token(api, "deploy@example.com", "https://editor.example")
    assert token == "short-lived-token"
    assert calls == [("POST", "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/"
                      "deploy@example.com:generateIdToken",
                      {"audience": "https://editor.example", "includeEmail": True})]
