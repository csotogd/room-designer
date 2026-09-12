"""One Python CLI for all catalog jobs; no Node subprocesses."""

import argparse
import asyncio
import json
import logging
import os
import shutil
import sys
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv

from room_designer.adapters.storage import write_json
from room_designer.config import ModelConfig
from room_designer.pipeline.catalog import (
    SITES,
    AssetStore,
    carry_over,
    image_extension,
    search_products,
    to_entry,
)
from room_designer.pipeline.generation import (
    ModelJudge,
    TrellisGenerator,
    TripoGenerator,
    download,
    packshot_score,
)
from room_designer.pipeline.geometry import furniture_dimensions, parse_glb, scene_size
from room_designer.pipeline.sources import CatalogSources
from room_designer.search.embeddings import create_embedder
from room_designer.search.index import SearchIndex

log = logging.getLogger(__name__)


async def ingest(args, env, client, store):
    sources = CatalogSources(client)
    previous = {p["id"]: p for p in store.read_products(args.site)}
    products = await sources.scrape(
        args.site, args.limit if args.limit is not None else (20 if args.site == "sklum" else sys.maxsize)
    )
    errors = 0
    merged = dict(previous)
    for product in products:
        try:
            photo = await download(client, product["imageUrl"])
            product["imagePath"] = store.save(
                args.site, "images", product["id"], photo, image_extension(product["imageUrl"])
            )
            best_data, best_url = photo, product["imageUrl"]
            if args.site == "sklum":
                best_score = packshot_score(photo)
                for url in product.get("galleryUrls", []):
                    try:
                        candidate = await download(client, url)
                        score = packshot_score(candidate)
                        if score > best_score:
                            best_data, best_url, best_score = candidate, url, score
                    except Exception as error:
                        log.warning("Packshot no disponible: %s", error)
            product["generationImagePath"] = store.save(
                args.site, "gen-images", product["id"], best_data, image_extension(best_url)
            )
            product["generationImageUrl"] = best_url
            carry_over(previous.get(product["id"]), product)
            source = product.get("modelSource")
            if source and not product.get("modelPath"):
                try:
                    if source["kind"] == "glb":
                        url = source["url"]
                        if args.site == "sketchfab":
                            token = env.get("SKETCHFAB_API_TOKEN")
                            if not token:
                                log.warning("%s: modelo pendiente de SKETCHFAB_API_TOKEN", product["id"])
                                merged[product["id"]] = product
                                store.save_products(args.site, list(merged.values()))
                                continue
                            response = await sources.json(url, {"Authorization": "Token " + token})
                            url = response.get("glb", {}).get("url")
                            if not url:
                                raise ValueError("Sketchfab no devolvió URL de GLB")
                        data = await download(client, url)
                        geometry = parse_glb(data)
                        dims = furniture_dimensions(scene_size(geometry))
                        if dims:
                            for key, value in dims.items():
                                product.setdefault(key, value)
                        product["modelPath"] = store.save(args.site, "models", product["id"], data, "glb")
                    else:
                        entry_path = None
                        for relative, url in source["files"].items():
                            path = store.save_part(
                                args.site, product["id"], relative, await download(client, url)
                            )
                            if relative == source["entry"]:
                                entry_path = path
                        if not entry_path:
                            raise ValueError("glTF sin fichero de entrada")
                        product["modelPath"] = entry_path
                    product["quality"] = {"status": "approved", "judge": "native-" + args.site}
                except Exception as error:
                    errors += 1
                    log.warning("Modelo %s pendiente: %s", product["id"], error)
            merged[product["id"]] = product
            store.save_products(args.site, list(merged.values()))
        except Exception as error:
            errors += 1
            log.warning("Producto %s pendiente: %s", product["id"], error)
    print(json.dumps({"scraped": len(products), "total": len(merged), "errors": errors}))
    return int(errors > 0)


async def sync_entries(entries, env, client, verify=False):
    url = env.get("SEARCH_URL", "http://localhost:8787").rstrip("/")
    if verify:
        health = await client.get(url + "/healthz")
        health.raise_for_status()
        if health.json()["products"] != len({e["id"] for e in entries}):
            raise ValueError("Catálogo e índice no coinciden")
        print(json.dumps({"verified": True, "products": health.json()["products"]}))
        return
    headers = {"X-Request-Id": "catalog-" + uuid4().hex}
    if env.get("SEARCH_SYNC_TOKEN"):
        headers["Authorization"] = "Bearer " + env["SEARCH_SYNC_TOKEN"]
    response = await client.post(
        url + "/sync",
        json={"products": search_products(entries, env.get("CATALOG_PUBLIC_BASE_URL"))},
        headers=headers,
        timeout=120,
    )
    response.raise_for_status()
    report = response.json()
    print(json.dumps(report))


async def publish(args, env, client, store):
    public = Path(env.get("CATALOG_PUBLIC_DIR", "public")) / "catalog"
    for sub in ("images", "gen-images", "models"):
        source = store.absolute(f"{args.site}/{sub}")
        if source.exists():
            shutil.copytree(source, public / args.site / sub, dirs_exist_ok=True)
    entries = [entry for p in store.read_products(args.site) if (entry := to_entry(p)) is not None]
    write_json(public / f"index-{args.site}.json", entries)
    if args.site == env.get("CATALOG_SITE", "sklum"):
        write_json(public / "index.json", entries)
        if not getattr(args, "no_sync", False):
            try:
                await sync_entries(entries, env, client)
            except httpx.HTTPError:
                log.warning("Catálogo publicado; búsqueda pendiente de sincronizar con catalog sync")
    print(f"{len(entries)} productos publicados")
    return 0


async def generate_or_judge(args, env, client, store):
    products = store.read_products(args.site)
    if args.set:
        identifier, separator, status = args.set.rpartition("=")
        if not separator or status not in ("approved", "rejected"):
            raise ValueError("Usa --set <id>=approved|rejected")
        matches = [p for p in products if p["id"] == identifier] or [
            p for p in products if p["id"].startswith(identifier)
        ]
        if len(matches) != 1:
            raise ValueError("Producto no encontrado o prefijo ambiguo")
        matches[0]["quality"] = {
            "status": status,
            "reason": args.reason or "veredicto manual",
            "judge": "manual",
        }
        store.save_products(args.site, products)
        return 0
    config = ModelConfig.from_env(env, "JUDGE") if env.get("JUDGE_PROVIDER") else None
    judge = ModelJudge(config)
    generator = None
    if args.command == "generate":
        provider = env.get("GENERATOR", "trellis")
        if provider not in ("tripo", "trellis", "trellis1"):
            raise ValueError("GENERADOR desconocido")
        generator = (
            TripoGenerator(client, env.get("TRIPO_API_KEY"))
            if provider == "tripo"
            else TrellisGenerator(env.get("HF_TOKEN"), 1 if provider == "trellis1" else 2)
        )
    targets = (
        [p for p in products if not p.get("modelPath") and p.get("imagePath")]
        if generator
        else [p for p in products if p.get("modelPath") and (args.all or not p.get("quality"))]
    )[: args.count]
    failures = 0
    for p in targets:
        try:
            if generator:
                model, preview = await generator.generate(
                    store.absolute(p.get("generationImagePath") or p["imagePath"])
                )
                parse_glb(model)
                p["modelPath"] = store.save(args.site, "models", p["id"], model, "glb")
                if preview:
                    p["previewPath"] = store.save(args.site, "previews", p["id"], preview, "png")
                # Save mesh before judging so a judge failure never pays for a second generation.
                store.save_products(args.site, products)
            p["quality"] = await judge.judge(p, store)
            store.save_products(args.site, products)
        except Exception as error:
            failures += 1
            log.warning("%s: %s", p["id"], error)
    print(json.dumps({"processed": len(targets), "failures": failures}))
    return int(failures > 0)


async def evaluate(args, env, client):
    from room_designer.bootstrap import catalog_path
    from room_designer.search.evaluation import evaluate_search

    entries = json.loads(Path(args.catalog or catalog_path(env)).read_text())
    golden = Path(args.golden or f"services/search/eval/golden-{args.site}.json")
    if not golden.exists():
        golden = Path("services/search/eval/golden.json")
    service = SearchIndex(create_embedder(env, client))
    await service.sync(search_products(entries, env.get("CATALOG_PUBLIC_BASE_URL")))
    report = await evaluate_search(
        service.search, json.loads(golden.read_text())["cases"], int(env.get("SEARCH_EVAL_K", 5))
    )
    print(json.dumps(report, indent=2))
    return int(report["meanReciprocalRank"] < float(env.get("SEARCH_EVAL_MIN_MRR", 0.6)))


async def run(args, env):
    if args.limit is not None and args.limit <= 0 or args.count <= 0:
        raise ValueError("limit/count deben ser positivos")
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "RoomDesigner/2.0"}) as client:
        store = AssetStore(Path(args.out))
        if args.command == "ingest":
            return await ingest(args, env, client, store)
        if args.command == "link":
            return await publish(args, env, client, store)
        if args.command in ("generate", "judge"):
            return await generate_or_judge(args, env, client, store)
        if args.command == "eval":
            return await evaluate(args, env, client)
        if args.command == "sync":
            if args.site != env.get("CATALOG_SITE", "sklum"):
                raise ValueError("No se puede sincronizar otro sitio sobre el índice activo")
            from room_designer.bootstrap import catalog_path

            entries = json.loads(catalog_path(env).read_text())
            await sync_entries(entries, env, client, args.verify)
            return 0
    raise ValueError("Comando desconocido")


def main():
    load_dotenv(override=False)
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["ingest", "generate", "judge", "link", "sync", "eval"])
    parser.add_argument("--site", choices=list(SITES), default=os.getenv("CATALOG_SITE", "sklum"))
    parser.add_argument("--country")
    parser.add_argument("--out", default="data/catalog")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--count", type=int, default=sys.maxsize)
    parser.add_argument("--set")
    parser.add_argument("--reason")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--no-sync", action="store_true")
    parser.add_argument("--catalog")
    parser.add_argument("--golden")
    args = parser.parse_args()
    try:
        code = asyncio.run(run(args, dict(os.environ)))
    except Exception as error:
        log.error("%s", error)
        code = 1
    raise SystemExit(code)


if __name__ == "__main__":
    main()
