"""Prueba del motor real sin red: fallo aguas arriba y posterior ejecución recuperada."""

import json
import os
import runpy
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from airflow.utils import db


def main():
    with tempfile.TemporaryDirectory(prefix="catalog-smoke-") as temporary:
        root = Path(temporary)
        executable = root / "catalog-fake"
        executable.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ["CATALOG_SMOKE_STATE"])
args = sys.argv[1:]
command, site = args[0], args[args.index("--site") + 1]
if os.environ.get("CATALOG_SMOKE_FAIL") == "yes" and command == "ingest" and site == "sklum":
    raise SystemExit(42)
with (root / "calls.jsonl").open("a") as output:
    output.write(json.dumps([command, site, "--verify" in args]) + "\\n")
''')
        executable.chmod(0o755)
        os.environ.update(CATALOG_CLI=str(executable), CATALOG_SITES="sklum,polyhaven",
                          CATALOG_SITE="sklum", CATALOG_SMOKE_STATE=temporary)
        db.initdb()
        dag = runpy.run_path(str(Path(__file__).with_name("catalog_refresh_dag.py")))["dag"]
        # Los tiempos de reintento reales se verifican en unit; el smoke no espera 10 minutos.
        for task in dag.tasks:
            task.retries = 0
            task.retry_delay = timedelta(seconds=0)
        os.environ["CATALOG_SMOKE_FAIL"] = "yes"
        failed = dag.test(logical_date=datetime(2026, 1, 2, tzinfo=timezone.utc))
        assert str(failed.state) == "failed", failed.state
        calls = [json.loads(line)[0] for line in (root / "calls.jsonl").read_text().splitlines()]
        assert "sync" not in calls and "eval" not in calls, calls
        os.environ["CATALOG_SMOKE_FAIL"] = "no"
        (root / "calls.jsonl").write_text("")
        recovered = dag.test(logical_date=datetime(2026, 1, 3, tzinfo=timezone.utc))
        assert str(recovered.state) == "success", recovered.state
        calls = [json.loads(line) for line in (root / "calls.jsonl").read_text().splitlines()]
        first_sync = next(i for i, call in enumerate(calls) if call[0] == "sync")
        assert {call[1] for call in calls[:first_sync] if call[0] == "link"} == {"sklum", "polyhaven"}
        assert calls[-3:] == [["sync", "sklum", False], ["sync", "sklum", True], ["eval", "sklum", False]]
        print("DAG real verificado: bloqueo de dependencias y recuperación correctos")


if __name__ == "__main__":
    main()
