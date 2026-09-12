"""Refresco acotado; los CLIs comparten un disco persistente en el ejecutor local."""

import json
import logging
import os
import shlex
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from airflow.providers.standard.operators.bash import BashOperator
from airflow.sdk import DAG

ACTIVE_SITE = os.getenv("CATALOG_SITE", "sklum")
SITES = os.getenv("CATALOG_SITES", ACTIVE_SITE).split(",")
if (set(SITES) - {"sklum", "polyhaven", "sketchfab"}
        or len(SITES) != len(set(SITES)) or ACTIVE_SITE not in SITES):
    raise ValueError("Selección de catálogos inválida: incluir el activo y evitar duplicados o desconocidos")
CLI = os.getenv("CATALOG_CLI", "/opt/catalog/bin/catalog")
DATA_DIR = os.getenv("CATALOG_DATA_DIR", "/var/lib/catalog/data")


def report_failure(context):
    task = context["task_instance"]
    event = {"severity": "ERROR", "component": "catalog-airflow", "dag_id": task.dag_id,
             "task_id": task.task_id, "run_id": task.run_id}
    line = json.dumps(event)
    logging.getLogger(__name__).error(line)
    if path := os.getenv("CATALOG_ALERT_FILE"):
        with Path(path).open("a") as output:
            output.write(line + "\n")


def catalog_task(task_id, command, site=ACTIVE_SITE, *options):
    args = [CLI, command, "--site", site, *options]
    if command in {"ingest", "generate", "judge", "link"}:
        args.extend(["--out", DATA_DIR])
    return BashOperator(
        task_id=task_id,
        bash_command=shlex.join(args),
        cwd="/opt/designer",
        do_xcom_push=False,
    )


with DAG(
    dag_id="catalog_refresh",
    description="Catálogo, publicación y reconciliación de búsqueda",
    schedule=os.getenv("CATALOG_REFRESH_SCHEDULE", "0 4 * * *"),
    start_date=datetime(2026, 1, 1, tzinfo=ZoneInfo("Europe/Madrid")),
    catchup=False,
    is_paused_upon_creation=True,
    max_active_runs=1,
    max_active_tasks=1,
    dagrun_timeout=timedelta(hours=12),
    default_args={
        "owner": "catalog",
        "retries": 2,
        "retry_delay": timedelta(minutes=10),
        "execution_timeout": timedelta(hours=2),
        "on_failure_callback": report_failure,
    },
    tags=["catalog", "search"],
) as dag:
    sync = catalog_task("sync_embeddings", "sync")
    verify = catalog_task("verify_consistency", "sync", ACTIVE_SITE, "--verify")
    evaluate = catalog_task("eval_search_quality", "eval")

    for site in SITES:
        ingest = catalog_task("ingest_" + site, "ingest", site, "--limit", "20")
        publish = catalog_task("publish_catalog_" + site, "link", site, "--no-sync")
        if site == "sklum":
            generate = catalog_task("generate_" + site, "generate", site, "--count", "5")
            judge = catalog_task("judge_" + site, "judge", site)
            ingest >> generate >> judge >> publish
        else:
            ingest >> publish
        publish >> sync
    sync >> verify >> evaluate
