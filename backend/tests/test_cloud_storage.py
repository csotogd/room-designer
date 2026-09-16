import asyncio
import json
from copy import deepcopy

import httpx
import pytest
from conftest import scenario
from room_designer.adapters.cloud_storage import CloudRoomRepository
from room_designer.domain.room import empty_state


class CloudStorageFake:
    def __init__(self):
        self.document = None
        self.objects = {}
        self.writes = []

    def __call__(self, request):
        if request.url.host == "metadata.google.internal":
            return httpx.Response(200, json={"access_token": "test-token"})
        assert request.headers["Authorization"] == "Bearer test-token"
        if request.url.host == "firestore.googleapis.com":
            if request.method == "GET":
                return httpx.Response(200, json=self.document) if self.document else httpx.Response(404)
            assert request.method == "PATCH"
            expected = request.url.params.get("currentDocument.updateTime")
            if self.document:
                if expected != self.document["updateTime"]:
                    return httpx.Response(412)
            else:
                assert request.url.params["currentDocument.exists"] == "false"
            self.document = json.loads(request.content)
            self.document["updateTime"] = str(len(self.writes) + 1)
            self.writes.append(deepcopy(self.document))
            return httpx.Response(200, json=self.document)
        assert request.url.host == "storage.googleapis.com"
        if request.method == "POST":
            name = request.url.params["name"]
            assert request.url.params["ifGenerationMatch"] == "0"
            assert name not in self.objects
            self.objects[name] = request.content
            return httpx.Response(200, json={})
        name = request.url.path.split("/o/", 1)[1]
        assert request.url.params["alt"] == "media"
        return httpx.Response(200, content=self.objects[name])


@pytest.fixture
async def cloud_storage():
    remote = CloudStorageFake()
    async with httpx.AsyncClient(transport=httpx.MockTransport(remote)) as client:
        yield remote, lambda: CloudRoomRepository(client, "test-project", "test-bucket", "room")


@scenario("A new designer instance resumes the saved conversation")
async def test_new_instance_resumes_conversation(cloud_storage):
    remote, repository = cloud_storage
    first = repository()
    state = await first.load()
    state["conversation"] = [{"role": "user", "text": "Prefiero madera"}]
    state["revision"] = "first"
    await first.save(state)
    assert await repository().load() == state
    assert len(remote.objects) == 1


@scenario("Concurrent designer instances cannot overwrite each other")
async def test_cloud_conflict_preserves_winner(cloud_storage):
    _, repository = cloud_storage
    first, second = repository(), repository()
    await first.load()
    await second.load()
    await first.save(empty_state() | {"revision": "winner"})
    with pytest.raises(ValueError, match="otra instancia"):
        await second.save(empty_state() | {"revision": "loser"})
    assert (await repository().load())["revision"] == "winner"


async def test_empty_cloud_room(cloud_storage):
    _, repository = cloud_storage
    assert await repository().load() == empty_state()


async def test_socket_reads_do_not_replace_active_turn_precondition(cloud_storage):
    _, repository = cloud_storage
    active, other = repository(), repository()
    await active.load()
    await other.load()
    await other.save(empty_state() | {"revision": "new"})
    assert (await asyncio.create_task(active.load()))["revision"] == "new"
    with pytest.raises(ValueError, match="otra instancia"):
        await active.save(empty_state() | {"revision": "old"})


async def test_previous_snapshots_are_kept_for_recovery(cloud_storage):
    remote, repository = cloud_storage
    room = repository()
    await room.load()
    await room.save(empty_state() | {"revision": "one"})
    await room.load()
    await room.save(empty_state() | {"revision": "two"})
    assert {json.loads(data)["revision"] for data in remote.objects.values()} == {"one", "two"}


def test_cloud_repository_selected_explicitly():
    from room_designer.bootstrap import room_repository

    client = object()
    repository = room_repository({
        "DESIGNER_STATE_PROJECT": "test-project", "DESIGNER_STATE_BUCKET": "test-bucket",
        "DESIGNER_ROOM_ID": "shared",
    }, client)
    assert isinstance(repository, CloudRoomRepository)
    assert repository.client is client
    assert repository.document_url.endswith("/designer_rooms/shared")


@pytest.mark.parametrize("env", [
    {"DESIGNER_STATE_PROJECT": "test-project"},
    {"DESIGNER_STATE_BUCKET": "test-bucket"},
])
def test_partial_cloud_settings_never_fall_back_to_local_storage(env):
    from room_designer.bootstrap import room_repository

    with pytest.raises(ValueError, match="juntos"):
        room_repository(env, object())


async def test_lost_publication_response_is_not_reported_as_a_conflict():
    remote = CloudStorageFake()
    lost = False

    def transport(request):
        nonlocal lost
        response = remote(request)
        if request.method == "PATCH" and not lost:
            lost = True
            raise httpx.ReadError("Respuesta perdida", request=request)
        return response

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        room = CloudRoomRepository(client, "test-project", "test-bucket", "room")
        await room.load()
        await room.save(empty_state() | {"revision": "one"})
        assert (await room.load())["revision"] == "one"
        assert len(remote.writes) == 1


async def test_failed_snapshot_upload_never_publishes_a_pointer():
    remote = CloudStorageFake()

    def transport(request):
        if request.method == "POST":
            return httpx.Response(403)
        return remote(request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        room = CloudRoomRepository(client, "test-project", "test-bucket", "room")
        await room.load()
        with pytest.raises(httpx.HTTPStatusError):
            await room.save(empty_state())
        assert remote.writes == []
