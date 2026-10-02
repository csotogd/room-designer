"""Composition root. Models, clients and persistence are created only at startup."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from dotenv import load_dotenv

from room_designer.adapters.adk_runtime import AdkRuntime, create_model
from room_designer.adapters.cloud_storage import CloudRoomRepository
from room_designer.adapters.http import MAX_WS_BYTES, create_designer_app, create_search_app
from room_designer.adapters.reliability import RateLimiter
from room_designer.adapters.storage import (
    FileRoomRepository,
    GcsScreenshots,
    HttpProductSearch,
    LocalScreenshots,
    read_catalog,
)
from room_designer.adapters.vision import AdkJudge, AdkPicker, ConstantJudge, DeterministicPicker, ImageLoader
from room_designer.application.design import DesignSession
from room_designer.application.observability import configure_logging
from room_designer.config import ModelConfig
from room_designer.search.embeddings import create_embedder
from room_designer.search.index import SearchIndex, SnapshotStore


def catalog_path(env):
    if env.get("CATALOG_INDEX"):
        return Path(env["CATALOG_INDEX"])
    site = env.get("CATALOG_SITE", "sklum")
    directory = Path(env.get("CATALOG_PUBLIC_DIR", "public")) / "catalog"
    selected = directory / f"index-{site}.json"
    return selected if selected.exists() else directory / "index.json"


def room_repository(env, client):
    project, bucket = env.get("DESIGNER_STATE_PROJECT"), env.get("DESIGNER_STATE_BUCKET")
    if project or bucket:
        if not project or not bucket:
            raise ValueError("DESIGNER_STATE_PROJECT y DESIGNER_STATE_BUCKET deben configurarse juntos")
        return CloudRoomRepository(client, project, bucket, env.get("DESIGNER_ROOM_ID", "shared"))
    site = env.get("CATALOG_SITE", "sklum")
    return FileRoomRepository(
        Path(env.get("DESIGNER_ROOM_FILE", f"data/designer/room-{site}.json")),
        int(env.get("DESIGNER_BACKUP_COUNT", "3")),
    )


def designer_app(env=None):
    env = dict(os.environ if env is None else env)
    config, picker_config, judge_config = [
        ModelConfig.from_env(env, role) for role in ("DESIGNER", "DESIGNER_PICKER", "DESIGNER_JUDGE")
    ]
    client = httpx.AsyncClient()
    catalog = read_catalog(catalog_path(env))
    picker = (
        DeterministicPicker()
        if picker_config.provider == "fake"
        else AdkPicker(
            create_model(picker_config), ImageLoader(client, Path(env.get("CATALOG_PUBLIC_DIR", "public")))
        )
    )
    judge = ConstantJudge() if judge_config.provider == "fake" else AdkJudge(create_model(judge_config))
    session = DesignSession(
        room_repository(env, client),
        catalog,
        HttpProductSearch(client, env.get("SEARCH_URL", "http://localhost:8787"), catalog),
        picker,
        AdkRuntime(create_model(config)),
        float(env.get("DESIGNER_TURN_TIMEOUT", 180)),
    )
    screenshots = (
        GcsScreenshots(client, env["SCREENSHOT_BUCKET"])
        if env.get("SCREENSHOT_BUCKET")
        else LocalScreenshots(Path(env.get("DESIGNER_SCREENSHOT_DIR", "data/designer/screenshots")))
    )

    @asynccontextmanager
    async def lifespan(app):
        yield
        await client.aclose()

    return create_designer_app(
        session,
        judge,
        screenshots,
        f"{config.provider}/{config.model}",
        env.get("DESIGNER_TOKEN", ""),
        tuple(filter(None, env.get("DESIGNER_ALLOWED_ORIGINS", "").split(","))),
        lifespan,
        judge_target=float(env.get("DESIGNER_JUDGE_TARGET", "7")),
        fresh_local_sessions=env.get("DESIGNER_LOCAL_FRESH_SESSIONS") == "1",
        rate_limit=RateLimiter(int(env.get("RATE_LIMIT_PER_MINUTE", "120"))),
    )


def search_app(env=None):
    env = dict(os.environ if env is None else env)
    client = httpx.AsyncClient()
    embedder = create_embedder(env, client)
    directory = Path(env.get("SEARCH_DATA_DIR", "data/search-index/" + env.get("CATALOG_SITE", "sklum")))
    service = SearchIndex(embedder, SnapshotStore(directory, int(env.get("SEARCH_SNAPSHOT_BACKUP_COUNT", "3"))))

    @asynccontextmanager
    async def lifespan(app):
        app.state.restored = await service.restore()
        if not app.state.restored and catalog_path(env).exists():
            import json

            from room_designer.pipeline.catalog import search_products

            await service.sync(
                search_products(json.loads(catalog_path(env).read_text()), env.get("CATALOG_PUBLIC_BASE_URL"))
            )
        yield
        await client.aclose()

    return create_search_app(
        service,
        env.get("SEARCH_SYNC_TOKEN", ""),
        lifespan,
        RateLimiter(int(env.get("RATE_LIMIT_PER_MINUTE", "120"))),
    )


def setup():
    load_dotenv(override=False)
    configure_logging(os.getenv("LOG_LEVEL", "INFO").upper())


def designer_main():
    setup()
    uvicorn.run(
        designer_app(),
        host="0.0.0.0",
        port=int(os.getenv("PORT", os.getenv("DESIGNER_PORT", "8790"))),
        ws_max_size=MAX_WS_BYTES,
        workers=1,
    )


def search_main():
    setup()
    uvicorn.run(search_app(), host="0.0.0.0", port=int(os.getenv("PORT", "8787")), workers=1)
