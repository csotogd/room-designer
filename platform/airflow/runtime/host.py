"""Comprobaciones de operación del nodo de Airflow."""

import argparse
import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

SECRET_NAMES = {"postgres", "database_uri", "fernet", "jwt", "search_token", "users.json", "tripo", "jina"}


def require_release(services, image):
    healthy = {service["Service"] for service in services
               if service.get("Image") == image and service.get("State") == "running"
               and service.get("Health") == "healthy"}
    if {"api", "scheduler", "dag-processor", "search"} - healthy:
        raise ValueError("Los servicios no ejecutan la imagen comprobada")


def remember_pause(root, current):
    path = root / "release-pause.json"
    try:
        with path.open("x") as output:
            json.dump(current, output)
    except FileExistsError:
        pass
    return json.loads(path.read_text())


def finish_release(root):
    (root / "release-pause.json").unlink(missing_ok=True)


def pause_state(root, fetch):
    password = json.loads((root / "secrets/users.json").read_text())["operator"]
    token = fetch("http://127.0.0.1:8080/auth/token",
                  json.dumps({"username": "operator", "password": password}).encode(),
                  {"Content-Type": "application/json"})["access_token"]
    return fetch("http://127.0.0.1:8080/api/v2/dags/catalog_refresh",
                 headers={"Authorization": "Bearer " + token})["is_paused"]


def make_backup(dump, directory):
    if not dump.startswith(b"PGDMP"):
        raise ValueError("El volcado PostgreSQL no es válido")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("metadata.dump", dump)
        for path in directory.iterdir():
            if path.is_symlink():
                raise ValueError("No se puede copiar un enlace de secretos")
            if path.name in SECRET_NAMES:
                archive.writestr("secrets/" + path.name, path.read_bytes())
    return output.getvalue()


def read_backup(data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            allowed = {"metadata.dump"} | {"secrets/" + name for name in SECRET_NAMES}
            if set(archive.namelist()) - allowed or "metadata.dump" not in archive.namelist():
                raise ValueError("Contenido inesperado en la copia")
            return {name: archive.read(name) for name in archive.namelist()}
    except (zipfile.BadZipFile, EOFError) as error:
        raise ValueError("La copia está corrupta") from error


def perform_backup(root, command, upload):
    dump = command(["exec", "-T", "postgres", "pg_dump", "-U", "airflow", "-Fc", "airflow"])
    command(["exec", "-T", "postgres", "pg_restore", "--list"], dump)
    data = make_backup(dump, root / "secrets")
    read_backup(data)
    result = upload(data)
    checksum = base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode()
    if result.get("md5Hash") != checksum:
        raise ValueError("No coincide el checksum de la copia remota")
    receipt = {"object": result["name"], "at": datetime.now(timezone.utc).isoformat(), "md5": checksum}
    (root / "backups/latest-success.json").write_text(json.dumps(receipt))


def require_idle(runs):
    if any(run.get("state") not in {"success", "failed"} for run in runs):
        raise ValueError("Hay ejecuciones pendientes; no se puede interrumpir el catálogo")


def health_errors(health, disk_fraction):
    errors = [f"Sin latido saludable: {component}"
              for component in ["metadatabase", "scheduler", "dag_processor"]
              if health.get(component, {}).get("status") != "healthy"]
    if disk_fraction > 0.85:
        errors.append("Disco de datos por encima del 85 %")
    return errors


def request_json(url, data=None, headers=None):
    with urlopen(Request(url, data=data, headers=headers or {}), timeout=120) as response:
        return json.load(response)


def upload_backup(data):
    token = request_json(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )["access_token"]
    name = "metadata/" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex + ".zip"
    query = urlencode({"uploadType": "media", "name": name, "ifGenerationMatch": "0"})
    return request_json(
        f"https://storage.googleapis.com/upload/storage/v1/b/{os.environ['BACKUP_BUCKET']}/o?{query}",
        data, {"Authorization": "Bearer " + token, "Content-Type": "application/zip"},
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["health", "idle", "backup", "remember-pause", "finish-release", "release"])
    parser.add_argument("--state", type=Path, default=Path("/srv/airflow/state"))
    parser.add_argument("--compose", default="/opt/airflow-host/compose.yaml")
    args = parser.parse_args()
    if args.action == "remember-pause":
        checkpoint = args.state / "release-pause.json"
        paused = json.loads(checkpoint.read_text()) if checkpoint.exists() else pause_state(args.state, request_json)
        print("true" if remember_pause(args.state, paused) else "false")
        return 0
    if args.action == "finish-release":
        finish_release(args.state)
        return 0

    def command(words, data=None):
        return subprocess.run(["docker", "compose", "-p", "catalog-airflow", "-f", args.compose, *words],
                              input=data, stdout=subprocess.PIPE, check=True, timeout=300).stdout

    event = {"component": "catalog-airflow", "severity": "INFO", "event": args.action}
    try:
        if args.action == "backup":
            perform_backup(args.state, command, upload_backup)
        elif args.action == "release":
            services = [json.loads(line) for line in command(["ps", "--all", "--format", "json"]).splitlines()]
            require_release(services, os.environ["AIRFLOW_IMAGE"])
        elif args.action == "idle":
            for state in ["queued", "running"]:
                runs = command(["exec", "-T", "scheduler", "airflow", "dags", "list-runs",
                                "catalog_refresh", "--state", state, "--output", "json"])
                require_idle(json.loads(runs))
        else:
            health = request_json("http://127.0.0.1:8080/api/v2/monitor/health")
            disk = shutil.disk_usage(args.state)
            if errors := health_errors(health, disk.used / disk.total):
                raise ValueError("; ".join(errors))
            event["event"] = "heartbeat"
    except Exception as error:
        # No registrar salidas de comandos ni respuestas que pudieran contener credenciales.
        event.update(severity="ERROR", error_type=type(error).__name__)
    print(json.dumps(event))
    with (args.state / "logs/host.jsonl").open("a") as output:
        output.write(json.dumps(event) + "\n")
    return int(event["severity"] == "ERROR")


if __name__ == "__main__":
    sys.exit(main())
