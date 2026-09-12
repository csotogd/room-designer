"""Prepara estado persistente sin rotar secretos ni borrar datos existentes."""

import base64
import json
import os
import secrets
import sys
from pathlib import Path


def prepare(root):
    root = Path(root)
    for relative in ["secrets", "catalog/data", "catalog/public", "catalog/search", "logs", "backups"]:
        path = root / relative
        path.mkdir(parents=True, exist_ok=True, mode=0o770)
        path.chmod(0o770)
        if os.geteuid() == 0:
            os.chown(path, 50000, 0)
            if relative.startswith("catalog/"):
                os.chown(root / "catalog", 50000, 0)
    directory = root / "secrets"

    def keep_or_create(name, value):
        path = directory / name
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
        except FileExistsError:
            return path.read_text()
        with os.fdopen(descriptor, "w") as output:
            output.write(value)
        return value

    password = keep_or_create("postgres", secrets.token_urlsafe(32))
    keep_or_create("database_uri", f"postgresql+psycopg2://airflow:{password}@postgres/airflow")
    keep_or_create("fernet", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())
    keep_or_create("jwt", secrets.token_urlsafe(48))
    keep_or_create("search_token", secrets.token_urlsafe(32))
    keep_or_create("users.json", json.dumps({"operator": secrets.token_urlsafe(32)}))
    if os.geteuid() == 0:
        os.chown(directory / "users.json", 50000, 0)


if __name__ == "__main__":
    prepare(sys.argv[1])
