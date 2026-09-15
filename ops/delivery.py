"""Guardas de entrega compartidas por CI y las comprobaciones locales."""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ENVIRONMENTS = ("dev", "stage", "prod")


def resolve_target(event, ref, config):
    if event != "push" or ref not in {f"refs/heads/{env}" for env in ENVIRONMENTS}:
        raise ValueError("Solo un push a dev, stage o prod puede desplegar")
    ids = [config[env]["project_id"] for env in ENVIRONMENTS]
    if len(set(ids)) != len(ENVIRONMENTS):
        raise ValueError("Cada entorno necesita proyectos distintos")
    if not all(re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project) for project in ids):
        raise ValueError("ID de proyecto inválido")
    environment = ref.removeprefix("refs/heads/")
    settings = config[environment]
    project = settings["project_id"]
    return {
        "environment": environment,
        "project_id": project,
        "state_bucket": f"{project}-tfstate",
        "state_prefix": f"environments/{environment}",
        "airflow_enabled": "true" if settings.get("airflow_enabled") is True else "false",
    }


def check_plan(plan):
    for resource in plan.get("resource_changes", []):
        if "delete" in resource["change"]["actions"]:
            raise ValueError(f"Borrado o reemplazo requiere revisión manual: {resource['address']}")


def check_release(service):
    if service.get("terminalCondition", {}).get("state") != "CONDITION_SUCCEEDED":
        raise ValueError("El servicio no está saludable")
    ready = service.get("latestReadyRevision")
    if not ready or ready != service.get("latestCreatedRevision"):
        raise ValueError("La revisión creada todavía no está lista")


def check_frontend(fetch, commit):
    html = fetch("/").decode()
    scripts = re.findall(r'<script\b[^>]*\bsrc="(/assets/[^"<>]+\.js)"', html)
    if not scripts:
        raise ValueError("La página no contiene el JavaScript del editor")
    if json.loads(fetch("/release.json"))["commit"] != commit:
        raise ValueError("El commit servido no coincide con el probado")
    for path in scripts:
        if not fetch(path):
            raise ValueError(f"El asset está vacío: {path}")


def build_image(build, commit, expected_name):
    if build.get("status") != "SUCCESS":
        raise ValueError("Cloud Build no ha terminado con SUCCESS")
    if build.get("substitutions", {}).get("_COMMIT_SHA") != commit:
        raise ValueError("Cloud Build corresponde a otro commit")
    for image in build.get("results", {}).get("images", []):
        if image["name"] == expected_name and re.fullmatch(r"sha256:[a-f0-9]{64}", image.get("digest", "")):
            return expected_name.rsplit(":", 1)[0] + "@" + image["digest"]
    raise ValueError("Cloud Build no devolvió el digest de la imagen esperada")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["target", "plan", "release", "smoke", "build"])
    parser.add_argument("target")
    parser.add_argument("--commit")
    args = parser.parse_args()
    if args.command == "smoke":
        def fetch(path):
            headers = {}
            if token := os.environ.get("SMOKE_ID_TOKEN"):
                headers["Authorization"] = f"Bearer {token}"
            with urlopen(Request(args.target.rstrip("/") + path, headers=headers), timeout=20) as response:
                return response.read()
        check_frontend(fetch, args.commit)
        return
    data = json.loads(Path(args.target).read_text())
    if args.command == "target":
        target = resolve_target(os.environ["GITHUB_EVENT_NAME"], os.environ["GITHUB_REF"], data)
        for key, value in target.items():
            print(f"{key}={value}")
    elif args.command == "plan":
        check_plan(data)
    elif args.command == "build":
        project, environment = os.environ["PROJECT_ID"], os.environ["ENVIRONMENT"]
        expected = (f"europe-west1-docker.pkg.dev/{project}/room-designer-{environment}-pipeline/"
                    f"frontend:{args.commit}-{data['id']}")
        print("frontend=" + build_image(data, args.commit, expected))
    else:
        check_release(data)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError) as error:
        print(f"Entrega bloqueada: {error}", file=sys.stderr)
        sys.exit(1)
