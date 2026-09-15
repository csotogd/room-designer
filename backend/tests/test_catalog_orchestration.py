"""Contrato del DAG sin instalar Airflow en el entorno del dominio."""

import json
import os
import runpy
import shlex
import subprocess
import sys
from datetime import timedelta
from pathlib import Path
from types import ModuleType, SimpleNamespace

import httpx
import pytest
import yaml
from conftest import scenario
from room_designer.pipeline import cli
from room_designer.pipeline.catalog import AssetStore
from room_designer.pipeline.cli import publish

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def dag_loader(monkeypatch):
    tasks = {}
    configuration = {}

    class Dag:
        def __init__(self, **kwargs):
            configuration.update(kwargs)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class Task:
        def __init__(self, task_id, **kwargs):
            self.task_id, self.options = task_id, kwargs
            self.upstream = set()
            tasks[task_id] = self

        def __rshift__(self, other):
            other.upstream.add(self.task_id)
            return other

    for name, exports in {
        "airflow": {"DAG": Dag},
        "airflow.sdk": {"DAG": Dag},
        "airflow.operators.bash": {"BashOperator": Task},
        "airflow.providers.standard.operators.bash": {"BashOperator": Task},
    }.items():
        module = ModuleType(name)
        module.__dict__.update(exports)
        monkeypatch.setitem(sys.modules, name, module)
    def load(sites="sklum,polyhaven", active="sklum"):
        tasks.clear()
        configuration.clear()
        monkeypatch.setenv("CATALOG_SITES", sites)
        monkeypatch.setenv("CATALOG_SITE", active)
        runpy.run_path(str(ROOT / "platform/airflow/runtime/catalog_refresh_dag.py"))
        return SimpleNamespace(tasks=tasks, configuration=configuration)
    return load


@pytest.fixture
def catalog_dag(dag_loader):
    return dag_loader()


@scenario("Publication waits for judging and synchronization waits for every catalog")
def test_refresh_dependencies(catalog_dag):
    tasks = catalog_dag.tasks
    assert tasks["publish_catalog_sklum"].upstream == {"judge_sklum"}
    assert tasks["judge_sklum"].upstream == {"generate_sklum"}
    assert tasks["generate_sklum"].upstream == {"ingest_sklum"}
    assert tasks["publish_catalog_polyhaven"].upstream == {"ingest_polyhaven"}
    assert tasks["sync_embeddings"].upstream == {"publish_catalog_sklum", "publish_catalog_polyhaven"}
    assert tasks["verify_consistency"].upstream == {"sync_embeddings"}
    assert tasks["eval_search_quality"].upstream == {"verify_consistency"}


@scenario("Refreshes are bounded and inactive until explicitly enabled")
def test_refresh_operational_limits(catalog_dag):
    config = catalog_dag.configuration
    assert config["is_paused_upon_creation"] is True
    assert config["catchup"] is False
    assert config["max_active_runs"] == 1
    assert config["max_active_tasks"] == 1
    assert config["dagrun_timeout"] <= timedelta(hours=12)
    assert config["default_args"]["retries"] == 2
    for name, task in catalog_dag.tasks.items():
        if name.startswith("ingest_"):
            assert "--limit 20" in task.options["bash_command"]
        if name.startswith("generate_"):
            assert "--count 5" in task.options["bash_command"]


@scenario("Orchestrated publication leaves synchronization to its own task")
async def test_publish_without_implicit_sync(tmp_path):
    store = AssetStore(tmp_path / "data")
    store.save_products("sklum", [{
        "id": "chair", "site": "sklum", "name": "Silla", "sourceUrl": "https://example.test/chair",
        "imagePath": "sklum/images/chair.png", "widthCm": 40, "heightCm": 80,
    }])

    def unexpected_request(request):
        raise AssertionError("La publicación no debe sincronizar la búsqueda")

    async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected_request)) as client:
        await publish(SimpleNamespace(site="sklum", no_sync=True),
                      {"CATALOG_PUBLIC_DIR": str(tmp_path / "public")}, client, store)
    assert (tmp_path / "public/catalog/index.json").is_file()


def test_cli_accepts_separate_publication(monkeypatch):
    received = []

    async def run(args, env):
        received.append(args.no_sync)
        return 0

    monkeypatch.setattr(cli, "run", run)
    monkeypatch.setattr(sys, "argv", ["catalog", "link", "--no-sync"])
    with pytest.raises(SystemExit) as result:
        cli.main()
    assert result.value.code == 0
    assert received == [True]


def test_tasks_share_durable_paths_and_explicit_active_site(catalog_dag):
    for task in catalog_dag.tasks.values():
        words = shlex.split(task.options["bash_command"])
        assert words[0] == "/opt/catalog/bin/catalog"
        assert task.options["cwd"] == "/opt/designer"
        assert "--site" in words
        if words[1] in {"ingest", "generate", "judge", "link"}:
            assert words[words.index("--out") + 1] == "/var/lib/catalog/data"
        if words[1] == "link":
            assert "--no-sync" in words


@scenario("Airflow services preserve state and expose only a loopback panel")
def test_service_isolation_and_persistence():
    stack = yaml.safe_load((ROOT / "platform/airflow/runtime/compose.yaml").read_text())
    services = stack["services"]
    assert services["api"]["ports"] == ["127.0.0.1:8080:8080"]
    assert "ports" not in services["postgres"]
    assert "ports" not in services["search"]
    assert "${STATE_DIR:?}/postgres:/var/lib/postgresql/data" in services["postgres"]["volumes"]
    for name in ["api", "scheduler", "dag-processor", "postgres", "search"]:
        assert services[name]["restart"] == "unless-stopped"
        assert services[name]["healthcheck"]["test"]
        assert services[name]["logging"]["options"]["max-size"] == "10m"
        assert services[name]["logging"]["options"]["max-file"] == "3"
    assert "${STATE_DIR:?}/catalog:/var/lib/catalog" in services["scheduler"]["volumes"]
    assert services["scheduler"]["environment"]["AIRFLOW__CORE__EXECUTOR"] == "LocalExecutor"
    assert services["scheduler"]["environment"]["AIRFLOW__CORE__LOAD_EXAMPLES"] == "false"


def test_panel_can_open_its_auth_file_without_writing_other_secrets():
    services = yaml.safe_load((ROOT / "platform/airflow/runtime/compose.yaml").read_text())["services"]
    assert "${STATE_DIR:?}/secrets/users.json:/var/lib/airflow/users.json" in services["api"]["volumes"]
    assert "${STATE_DIR:?}/secrets:/run/catalog-secrets:ro" in services["api"]["volumes"]


def test_runtime_keeps_catalog_dependencies_outside_airflow():
    dockerfile = (ROOT / "platform/airflow/runtime/Dockerfile").read_text()
    assert "apache/airflow:3.3.1-python3.12@sha256:" in dockerfile
    assert "python -m venv /opt/catalog" in dockerfile
    assert "/opt/catalog/bin/pip install" in dockerfile
    assert "USER airflow" in dockerfile


@scenario("Reinitializing Airflow preserves its credentials and stored catalogs")
def test_state_preparation_is_idempotent(tmp_path):
    prepare = runpy.run_path(str(ROOT / "platform/airflow/runtime/prepare_state.py"))["prepare"]
    prepare(tmp_path)
    secret_dir = tmp_path / "secrets"
    secrets = {p.name: p.read_bytes() for p in secret_dir.iterdir()}
    product = tmp_path / "catalog/data/existing.json"
    product.write_text("contenido conservado")
    prepare(tmp_path)
    assert secrets == {p.name: p.read_bytes() for p in secret_dir.iterdir()}
    assert product.read_text() == "contenido conservado"
    assert all(p.stat().st_mode & 0o007 == 0 for p in secret_dir.iterdir())


def test_prepared_database_uses_the_generated_postgres_password(tmp_path):
    import json
    from urllib.parse import urlparse

    prepare = runpy.run_path(str(ROOT / "platform/airflow/runtime/prepare_state.py"))["prepare"]
    prepare(tmp_path)
    secrets = tmp_path / "secrets"
    assert urlparse((secrets / "database_uri").read_text()).password == (secrets / "postgres").read_text()
    assert len(json.loads((secrets / "users.json").read_text())["operator"]) >= 32


@scenario("The Airflow host is isolated and its durable disk survives replacement")
def test_host_security_and_recovery_contract():
    resources = json.loads((ROOT / "platform/airflow/infra/main.tf.json").read_text())["resource"]
    firewall = resources["google_compute_firewall"]["iap"]
    assert firewall["source_ranges"] == ["35.235.240.0/20"]
    assert firewall["allow"] == [{"protocol": "tcp", "ports": ["22"]}]
    assert firewall["target_service_accounts"] == ["${google_service_account.airflow.email}"]
    vm = resources["google_compute_instance"]["airflow"]
    assert vm["metadata"]["enable-oslogin"] == "TRUE"
    assert vm["shielded_instance_config"]["enable_secure_boot"] is True
    assert vm["machine_type"] == "e2-standard-2"
    disk = resources["google_compute_disk"]["state"]
    assert disk["lifecycle"]["prevent_destroy"] is True
    assert vm["attached_disk"][0]["source"] == "${google_compute_disk.state.id}"
    snapshot = resources["google_compute_resource_policy"]["backup"]["snapshot_schedule_policy"]
    assert snapshot["schedule"]["daily_schedule"]["days_in_cycle"] == 1
    assert snapshot["retention_policy"]["max_retention_days"] == 7
    assert "roles/editor" not in json.dumps(resources)


def test_host_release_requires_an_immutable_image():
    variables = json.loads((ROOT / "platform/airflow/infra/main.tf.json").read_text())["variable"]
    assert "@sha256:" in variables["airflow_image"]["validation"]["condition"]


def test_monitoring_detects_a_host_that_stops_sending_heartbeats():
    resources = json.loads((ROOT / "platform/airflow/infra/main.tf.json").read_text())["resource"]
    alert = resources["google_monitoring_alert_policy"]["missing_heartbeat"]
    assert alert["conditions"][0]["condition_absent"]["duration"] == "600s"
    assert "heartbeat" in resources["google_logging_metric"]["heartbeat"]["filter"]


def test_docker_waits_for_the_persistent_disk_on_reboot():
    startup = (ROOT / "platform/airflow/runtime/startup.sh").read_text()
    assert "RequiresMountsFor=/srv/airflow" in startup
    assert "/etc/systemd/system/docker.service.d" in startup
    assert "/etc/fstab" in startup


@scenario("Failed catalog tasks produce an operational alert without secrets")
def test_failed_task_emits_only_operational_identifiers(catalog_dag, monkeypatch, tmp_path):
    event_file = tmp_path / "alerts.jsonl"
    monkeypatch.setenv("CATALOG_ALERT_FILE", str(event_file))
    callback = catalog_dag.configuration["default_args"]["on_failure_callback"]
    callback({"task_instance": SimpleNamespace(dag_id="catalog_refresh", task_id="ingest_sklum",
                                               run_id="manual__test"), "password": "secret-value"})
    event = json.loads(event_file.read_text())
    assert event == {"severity": "ERROR", "component": "catalog-airflow", "dag_id": "catalog_refresh",
                     "task_id": "ingest_sklum", "run_id": "manual__test"}


@pytest.fixture
def host_tools():
    return runpy.run_path(str(ROOT / "platform/airflow/runtime/host.py"))


@scenario("Airflow upgrades wait until catalog runs have finished")
def test_releases_do_not_interrupt_runs(host_tools):
    for state in ["queued", "running"]:
        with pytest.raises(ValueError, match="ejecuciones"):
            host_tools["require_idle"]([{"state": state}])


def test_releases_allow_only_terminal_runs(host_tools):
    host_tools["require_idle"]([{"state": "success"}, {"state": "failed"}])
    with pytest.raises(ValueError):
        host_tools["require_idle"]([{}])


@scenario("An unhealthy scheduler or a full data disk raises an operational error")
def test_health_reports_component_and_capacity_failures(host_tools):
    healthy = {key: {"status": "healthy"} for key in ["metadatabase", "scheduler", "dag_processor"]}
    assert host_tools["health_errors"](healthy, 0.5) == []
    assert host_tools["health_errors"](healthy, 0.9) == ["Disco de datos por encima del 85 %"]
    healthy["scheduler"]["status"] = "unhealthy"
    assert "scheduler" in " ".join(host_tools["health_errors"](healthy, 0.5))


def test_missing_health_components_are_not_healthy(host_tools):
    assert len(host_tools["health_errors"]({}, 0)) == 3


@scenario("Airflow backups preserve metadata and encryption keys and reject corruption")
def test_backup_roundtrip_and_corruption(host_tools, tmp_path):
    secret_dir = tmp_path / "secrets"
    secret_dir.mkdir()
    (secret_dir / "fernet").write_bytes(b"saved-encryption-key")
    dump = b"PGDMP-metadata"
    backup = host_tools["make_backup"](dump, secret_dir)
    restored = host_tools["read_backup"](backup)
    assert restored["metadata.dump"] == dump
    assert restored["secrets/fernet"] == b"saved-encryption-key"
    with pytest.raises(ValueError, match="copia"):
        host_tools["read_backup"](backup[:32])


def test_invalid_database_dump_is_not_backed_up(host_tools, tmp_path):
    with pytest.raises(ValueError, match="PostgreSQL"):
        host_tools["make_backup"](b"database error", tmp_path)


def test_backup_does_not_follow_secret_symlinks(host_tools, tmp_path):
    (tmp_path / "fernet").symlink_to(ROOT / "README.md")
    with pytest.raises(ValueError, match="enlace"):
        host_tools["make_backup"](b"PGDMP-valid", tmp_path)


def test_backup_is_recorded_only_after_remote_checksum_verification(host_tools, tmp_path):
    import base64
    import hashlib

    (tmp_path / "secrets").mkdir()
    (tmp_path / "backups").mkdir()
    uploaded = []

    def upload(data):
        uploaded.append(data)
        return {"name": "backup.zip", "md5Hash": base64.b64encode(hashlib.md5(data).digest()).decode()}

    def command(args, data=None):
        return b"PGDMP-data" if "pg_dump" in args else b"validated"

    host_tools["perform_backup"](tmp_path, command, upload)
    assert (tmp_path / "backups/latest-success.json").exists()
    assert host_tools["read_backup"](uploaded[0])["metadata.dump"] == b"PGDMP-data"


def test_failed_remote_backup_does_not_claim_success(host_tools, tmp_path):
    (tmp_path / "secrets").mkdir()
    (tmp_path / "backups").mkdir()
    with pytest.raises(ValueError, match="checksum"):
        host_tools["perform_backup"](tmp_path, lambda *args: b"PGDMP-data",
                                     lambda data: {"name": "backup.zip", "md5Hash": "wrong"})
    assert not (tmp_path / "backups/latest-success.json").exists()


def simulate_mount(tmp_path, filesystem):
    commands = tmp_path / "commands"
    commands.mkdir(exist_ok=True)
    log = tmp_path / "calls"
    log.write_text("")
    for name, script in {
        "blkid": 'printf "%s" "$TEST_FILESYSTEM"',
        "mountpoint": "exit 1",
        "lsblk": "echo disk",
        "mkfs.ext4": 'echo format >> "$TEST_CALLS"',
        "mount": 'echo mount >> "$TEST_CALLS"',
    }.items():
        executable = commands / name
        executable.write_text("#!/bin/sh\n" + script + "\n")
        executable.chmod(0o755)
    env = dict(os.environ, PATH=str(commands) + ":" + os.environ["PATH"],
               TEST_FILESYSTEM=filesystem, TEST_CALLS=str(log))
    result = subprocess.run(["bash", "-c", 'source "$1"; mount_data /dev/example "$2"', "test",
                             str(ROOT / "platform/airflow/runtime/startup.sh"), str(tmp_path / "mount")],
                            env=env, capture_output=True)
    return result.returncode, log.read_text().splitlines()


@scenario("Startup never reformats an existing data filesystem")
def test_startup_preserves_existing_filesystems(tmp_path):
    assert simulate_mount(tmp_path, "ext4") == (0, ["mount"])
    code, calls = simulate_mount(tmp_path, "xfs")
    assert code != 0 and calls == []


def test_startup_formats_only_an_empty_disk(tmp_path):
    assert simulate_mount(tmp_path, "") == (0, ["format", "mount"])


@scenario("Airflow delivery requires quality gates and a tested image from its environment")
def test_delivery_follows_versioned_activation_and_quality_gates():
    jobs = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())["jobs"]
    assert jobs["deploy"]["needs"] == "quality-gate"
    step = next(step for step in jobs["deploy"]["steps"] if "platform/airflow/delivery.py" in step.get("run", ""))
    assert step["if"] == "steps.target.outputs.airflow_enabled == 'true'"
    cloudbuild = yaml.safe_load((ROOT / "platform/airflow/runtime/cloudbuild.yaml").read_text())
    assert {step["id"] for step in cloudbuild["steps"]} >= {"build-airflow", "test-dag", "test-catalog-cli"}
    assert len(cloudbuild["images"]) == 1
    assert "enable_catalog_runtime = false" in (ROOT / "infra/gcp/environments/dev.tfvars").read_text()


@pytest.fixture
def airflow_delivery(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "ops"))
    return runpy.run_path(str(ROOT / "platform/airflow/delivery.py"))


@scenario("Airflow activation follows versioned environment settings")
def test_environment_activation_is_versioned_and_disabled_delivery_is_inert(airflow_delivery, monkeypatch):
    config = json.loads((ROOT / "infra/environments.json").read_text())
    resolve = airflow_delivery["resolve_target"]
    assert {env: resolve("push", f"refs/heads/{env}", config)["airflow_enabled"]
            for env in config} == {"dev": "false", "stage": "false", "prod": "false"}
    config["dev"]["airflow_enabled"] = True
    assert resolve("push", "refs/heads/dev", config)["airflow_enabled"] == "true"
    calls = []
    monkeypatch.setitem(airflow_delivery["main"].__globals__, "run", lambda *args, **kwargs: calls.append(args))
    monkeypatch.chdir(ROOT)
    monkeypatch.setenv("GITHUB_EVENT_NAME", "push")
    monkeypatch.delenv("AIRFLOW_ALERT_EMAIL", raising=False)
    for env in ["dev", "stage", "prod"]:
        monkeypatch.setenv("GITHUB_REF", f"refs/heads/{env}")
        airflow_delivery["main"]()
    assert calls == []


def test_delivery_rejects_a_different_environment_image(airflow_delivery):
    build = {"id": "build1", "status": "SUCCESS", "substitutions": {"_COMMIT_SHA": "a" * 40},
             "results": {"images": [{"name": "europe-west1-docker.pkg.dev/project/room-designer-prod-pipeline/airflow:" + "a" * 40 + "-build1", "digest": "sha256:" + "b" * 64}]}}
    with pytest.raises(ValueError, match="digest"):
        airflow_delivery["release_image"](build, "project", "dev", "a" * 40)


def test_airflow_permissions_are_opt_in():
    bootstrap = (ROOT / "infra/bootstrap/main.tf").read_text()
    assert 'variable "enable_airflow"' in bootstrap
    assert '"compute.googleapis.com"' in bootstrap
    assert '"roles/compute.osAdminLogin"' in bootstrap


@scenario("Invalid catalog selection prevents scheduling")
@pytest.mark.parametrize("sites,active", [("unknown", "unknown"), ("sklum,sklum", "sklum"),
                                         ("polyhaven", "sklum"), ("", "sklum")])
def test_invalid_catalog_selection(dag_loader, sites, active):
    with pytest.raises(ValueError, match="catálogos"):
        dag_loader(sites, active)


@scenario("Consistency verification observes the search index without modifying it")
async def test_verification_does_not_repair_a_mismatch():
    visited = []

    def respond(request):
        visited.append(request.method)
        return httpx.Response(200, json={"products": 2})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(ValueError, match="no coinciden"):
            await cli.sync_entries([], {}, client, verify=True)
    assert visited == ["GET"]


async def test_verification_accepts_an_equal_count_without_writing():
    def respond(request):
        assert request.method == "GET"
        return httpx.Response(200, json={"products": 0})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        await cli.sync_entries([], {}, client, verify=True)


@scenario("Upgrades preserve the operator's pause setting across interrupted releases")
def test_pause_checkpoint_survives_an_interrupted_release(host_tools, tmp_path):
    assert host_tools["remember_pause"](tmp_path, False) is False
    assert host_tools["remember_pause"](tmp_path, True) is False
    host_tools["finish_release"](tmp_path)
    assert host_tools["remember_pause"](tmp_path, True) is True


def test_pause_state_uses_authenticated_api_without_exposing_credentials(host_tools, tmp_path):
    (tmp_path / "secrets").mkdir()
    (tmp_path / "secrets/users.json").write_text(json.dumps({"operator": "private"}))
    calls = []

    def fetch(url, data=None, headers=None):
        calls.append((url, data, headers))
        return {"access_token": "session"} if url.endswith("/auth/token") else {"is_paused": False}

    assert host_tools["pause_state"](tmp_path, fetch) is False
    assert calls[1][2] == {"Authorization": "Bearer session"}


@pytest.fixture
def healthy_application_services():
    return [{"Service": name, "Image": "tested@sha256:abc", "State": "running", "Health": "healthy"}
            for name in ["api", "scheduler", "dag-processor", "search"]]


@scenario("Deployment succeeds only when every application service runs the tested image")
@pytest.mark.parametrize("failure", ["absent", "outdated", "unhealthy", "stopped"])
def test_release_verification_rejects_incomplete_rollout(host_tools, healthy_application_services, failure):
    services = healthy_application_services
    if failure == "absent":
        services.pop()
    elif failure == "outdated":
        services[0]["Image"] = "previous@sha256:def"
    elif failure == "unhealthy":
        services[0]["Health"] = "unhealthy"
    else:
        services[0]["State"] = "exited"
    with pytest.raises(ValueError, match="servicios"):
        host_tools["require_release"](services, "tested@sha256:abc")


def test_release_verification_accepts_all_healthy_application_services(host_tools, healthy_application_services):
    services = healthy_application_services
    services.append({"Service": "postgres", "Image": "postgres@sha256:def", "State": "running"})
    host_tools["require_release"](services, "tested@sha256:abc")
