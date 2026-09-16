"""Snapshots inmutables en GCS con publicación condicional en Firestore."""

import json
from contextvars import ContextVar
from urllib.parse import quote
from uuid import uuid4

import httpx

from room_designer.adapters.reliability import retry_async
from room_designer.domain.room import Json, empty_state


class CloudRoomRepository:
    def __init__(self, client: httpx.AsyncClient, project: str, bucket: str, room_id: str):
        self.client, self.bucket = client, bucket
        self.prefix = f"designer/rooms/{quote(room_id, safe='')}/"
        self.document_url = (
            f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)"
            f"/documents/designer_rooms/{quote(room_id, safe='')}"
        )
        # Las lecturas de otros sockets no deben cambiar la precondición del turno activo.
        self.version: ContextVar[str | None] = ContextVar(f"room-{id(self)}")

    async def _request(self, method, url, **kwargs):
        async def send():
            response = await self.client.get(
                "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                headers={"Metadata-Flavor": "Google"}, timeout=3,
            )
            response.raise_for_status()
            response = await self.client.request(
                method, url, headers={"Authorization": f"Bearer {response.json()['access_token']}"},
                timeout=15, **kwargs,
            )
            if response.status_code not in {404, 409, 412}:
                response.raise_for_status()
            return response

        return await retry_async(send)

    async def load(self) -> Json:
        response = await self._request("GET", self.document_url)
        if response.status_code == 404:
            self.version.set(None)
            return empty_state()
        response.raise_for_status()
        document = response.json()
        self.version.set(document["updateTime"])
        name = document["fields"]["snapshot"]["stringValue"]
        if not name.startswith(self.prefix):
            raise ValueError("Snapshot fuera de la habitación")
        response = await self._request(
            "GET", f"https://storage.googleapis.com/storage/v1/b/{self.bucket}/o/{quote(name, safe='')}",
            params={"alt": "media"},
        )
        response.raise_for_status()
        return response.json()

    async def save(self, state: Json) -> None:
        expected = self.version.get()
        name = f"{self.prefix}{uuid4().hex}.json"
        payload = json.dumps(state, ensure_ascii=False, allow_nan=False).encode()
        response = await self._request(
            "POST", f"https://storage.googleapis.com/upload/storage/v1/b/{self.bucket}/o",
            params={"uploadType": "media", "name": name, "ifGenerationMatch": "0"}, content=payload,
        )
        # Un retry tras una respuesta perdida encuentra el objeto inmutable ya creado.
        if response.status_code != 412:
            response.raise_for_status()
        condition = {"currentDocument.updateTime": expected} if expected else {"currentDocument.exists": "false"}
        response = await self._request(
            "PATCH", self.document_url, params=condition,
            json={"fields": {"snapshot": {"stringValue": name}}},
        )
        if response.status_code in {409, 412}:
            response = await self._request("GET", self.document_url)
            response.raise_for_status()
            if response.json()["fields"]["snapshot"]["stringValue"] != name:
                raise ValueError("La habitación ha cambiado en otra instancia; vuelve a intentarlo")
        response.raise_for_status()
        self.version.set(response.json()["updateTime"])
