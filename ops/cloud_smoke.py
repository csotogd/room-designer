"""Comprobaciones reales de la base cloud con datos efímeros, sin llamar a APIs de IA."""

import base64
import json
import os
import subprocess
import time
import uuid
from contextlib import ExitStack
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

from delivery import check_frontend, check_release


def verify_resources(api, project, environment, commit, probe):
    prefix = f"room-designer-{environment}"
    bucket = f"{project}-{prefix}-assets"
    api("GET", f"https://storage.googleapis.com/storage/v1/b/{bucket}")
    database = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)"
    api("GET", database)
    pubsub = f"https://pubsub.googleapis.com/v1/projects/{project}"
    for topic in ("products-to-generate", "products-dlq"):
        api("GET", f"{pubsub}/topics/{prefix}-{topic}")
    for secret in ("tripo-api-key", "judge-api-key"):
        api("GET", f"https://secretmanager.googleapis.com/v1/projects/{project}/secrets/{prefix}-{secret}")
    for suffix in ("web", "ingest", "generator", "scheduler"):
        email = f"{prefix}-{suffix}@{project}.iam.gserviceaccount.com"
        api("GET", f"https://iam.googleapis.com/v1/projects/{project}/serviceAccounts/{email}")

    with ExitStack() as cleanup:
        key = quote(f"smoke/{probe}", safe="")
        obj = f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{key}"
        api("POST", f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={key}",
            commit.encode(), raw=True)
        cleanup.callback(api, "DELETE", obj)
        if api("GET", obj + "?alt=media", raw=True) != commit.encode():
            raise ValueError("GCS no devuelve el objeto escrito")

        document = f"{database}/documents/_deployment_smoke/{probe}"
        fields = {"commit": {"stringValue": commit}}
        api("PATCH", document, {"fields": fields})
        cleanup.callback(api, "DELETE", document)
        if api("GET", document).get("fields") != fields:
            raise ValueError("Firestore no devuelve el documento escrito")

        # No publicar pruebas en la cola que acabará llamando al proveedor 3D.
        topic = f"{pubsub}/topics/rd-smoke-{probe}"
        subscription = f"{pubsub}/subscriptions/rd-smoke-{probe}"
        api("PUT", topic, {})
        cleanup.callback(api, "DELETE", topic)
        api("PUT", subscription, {"topic": f"projects/{project}/topics/rd-smoke-{probe}",
                                  "ackDeadlineSeconds": 10, "expirationPolicy": {"ttl": "86400s"}})
        cleanup.callback(api, "DELETE", subscription)
        message = base64.b64encode(commit.encode()).decode()
        api("POST", topic + ":publish", {"messages": [{"data": message}]})
        messages = api("POST", subscription + ":pull", {"maxMessages": 1}).get("receivedMessages", [])
        if not messages or messages[0]["message"]["data"] != message:
            raise ValueError("Pub/Sub no devuelve el mensaje publicado")


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


class GoogleApi:
    def __init__(self, token):
        self.token = token

    def __call__(self, method, url, body=None, raw=False):
        headers = {"Authorization": f"Bearer {self.token}"}
        if body is not None:
            headers["Content-Type"] = "application/octet-stream" if raw else "application/json"
        data = body if raw else json.dumps(body).encode() if body is not None else None
        request = Request(url, data=data, headers=headers, method=method)
        # Las lecturas pull pueden devolver un lote vacío transitorio.
        for attempt in range(3):
            with urlopen(request, timeout=30) as response:
                result = response.read()
            value = result if raw else json.loads(result) if result else {}
            if not url.endswith(":pull") or value.get("receivedMessages") or attempt == 2:
                return value
            time.sleep(1)


def private_identity_token(api, service_account, audience):
    # El CLI de impersonación exige permisos de acceso adicionales; aquí basta OIDC.
    endpoint = f"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{service_account}:generateIdToken"
    return api("POST", endpoint, {"audience": audience, "includeEmail": True})["token"]


def main():
    project, environment, commit = (os.environ[key] for key in ("PROJECT_ID", "ENVIRONMENT", "COMMIT_SHA"))
    api = GoogleApi(command("gcloud", "auth", "print-access-token"))
    service = api("GET", f"https://run.googleapis.com/v2/projects/{project}/locations/europe-west1/"
                         f"services/room-designer-{environment}-frontend")
    check_release(service)
    if service["template"]["containers"][0]["image"] != os.environ["EXPECTED_WEB_IMAGE"]:
        raise ValueError("Cloud Run no utiliza el digest probado")
    url = service["uri"]
    token = private_identity_token(api, f"rd-{environment}-deploy@{project}.iam.gserviceaccount.com", url)

    def fetch(path):
        request = Request(url + path, headers={"Authorization": f"Bearer {token}"})
        with urlopen(request, timeout=20) as response:
            return response.read()

    check_frontend(fetch, commit)
    verify_resources(api, project, environment, commit, uuid.uuid4().hex)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"frontend_url={url}\n")
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
        summary.write(f"### {environment}: editor y base cloud comprobados\n\n"
                      f"Commit: `{commit}`. Editor privado: {url}\n\n"
                      "Verificados: revisión, digest, HTML/JS, GCS, Firestore, Pub/Sub e identidades. "
                      "Secret Manager: solo metadatos, sin versiones de claves. "
                      "El catálogo automático y los backends de IA todavía no están desplegados.\n")


if __name__ == "__main__":
    main()
