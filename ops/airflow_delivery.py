"""Entrega de Airflow tras las puertas comunes de CI; mismo digest probado y desplegado."""

import json
import os
import shlex
import subprocess
from pathlib import Path

from delivery import build_image, check_plan, resolve_target


def release_image(build, project, environment, commit):
    expected = (f"europe-west1-docker.pkg.dev/{project}/room-designer-{environment}-pipeline/"
                f"airflow:{commit}-{build['id']}")
    return build_image(build, commit, expected)


def run(args, env=None):
    return subprocess.run(args, env=env, check=True, stdout=subprocess.PIPE, text=True).stdout


def main():
    target = resolve_target(os.environ["GITHUB_EVENT_NAME"], os.environ["GITHUB_REF"],
                            json.loads(Path("infra/environments.json").read_text()))
    project, environment = target["project_id"], target["environment"]
    if target["airflow_enabled"] != "true":
        print(f"Airflow desactivado en {environment} por la configuración del repositorio.")
        return
    commit = os.environ["GITHUB_SHA"]
    email = os.environ["AIRFLOW_ALERT_EMAIL"]
    if not email:
        raise ValueError("Falta el destinatario de alertas de Airflow")
    build = json.loads(run([
        "gcloud", "builds", "submit", ".", f"--project={project}", "--region=europe-west1",
        "--config=deploy/airflow/cloudbuild.yaml", "--ignore-file=.gcloudignore",
        f"--service-account=projects/{project}/serviceAccounts/rd-{environment}-build@{project}.iam.gserviceaccount.com",
        f"--gcs-source-staging-dir=gs://{project}-build-source/source",
        f"--substitutions=_ENVIRONMENT={environment},_COMMIT_SHA={commit}",
        "--timeout=1800s", "--suppress-logs", "--format=json",
    ]))
    image = release_image(build, project, environment, commit)
    env = dict(os.environ, TF_IN_AUTOMATION="true", TF_VAR_project_id=project,
               TF_VAR_environment=environment, TF_VAR_airflow_image=image, TF_VAR_notification_email=email)
    tofu = ["tofu", "-chdir=infra/airflow"]
    run([*tofu, "init", "-input=false", f"--backend-config=bucket={target['state_bucket']}",
         f"--backend-config=prefix=environments/{environment}/airflow"], env)
    run([*tofu, "plan", "-input=false", "-lock-timeout=5m", "-out=release.tfplan"], env)
    check_plan(json.loads(run([*tofu, "show", "-json", "release.tfplan"], env)))
    run([*tofu, "apply", "-input=false", "-lock-timeout=5m", "release.tfplan"], env)
    ssh = ["gcloud", "compute", "ssh", f"rd-{environment}-airflow", f"--project={project}",
           "--zone=europe-west1-b", "--tunnel-through-iap", "--quiet"]
    run([*ssh, "--command=sudo google_metadata_script_runner startup"])
    verification = (
        "sudo bash -c " + shlex.quote(
            "set -e; set -a; source /opt/airflow-host/runtime.env; set +a; "
            f"test \"$AIRFLOW_IMAGE\" = {shlex.quote(image)}; "
            "python3 /opt/airflow-host/host.py release; "
            "python3 /opt/airflow-host/host.py health; "
            "test -s /srv/airflow/state/backups/latest-success.json"
        )
    )
    run([*ssh, "--command=" + verification])
    print(f"Airflow saludable en rd-{environment}-airflow; imagen {image}. Conserva el estado de pausa anterior.")


if __name__ == "__main__":
    main()
