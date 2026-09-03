# Infraestructura GCP — pipeline de catálogo

Vía cloud del pipeline (la vía local sigue siendo `npm run pipeline:*` con
`data/catalog/`). Misma lógica, mismos puertos; cambian los adaptadores:

| Puerto | Local (demo) | Cloud (GCP) |
|---|---|---|
| Disparo | CLI manual | **Cloud Scheduler** (cron por sitio × país) |
| AssetStore | carpeta `data/catalog` | **GCS** (`<site>-<country>/...`, mismas claves) |
| Selección de imagen | heurística de packshot | **VLM juez** (flag `vlm_image_selection_enabled`) con fallback heurístico |
| "Decode" de imagen sin packshot | — | flag `vlm_image_decode_enabled` = **false** (apagado por decisión de producto) |
| MeshGenerator | Tripo / Space TRELLIS | Tripo API (secreto en Secret Manager) o TRELLIS.2 self-host |
| QualityJudge | Noop / manual | **VLM** (Anthropic / OpenAI-compatible / Vertex) |
| Catálogo | `products.json` + `pipeline:link` | **Firestore**: colección `catalog_{site}_{country}` |

Cada documento del catálogo: precio, descripción extensa, medidas 3D (cm),
enlace público al GLB en GCS, veredicto del juez y trazabilidad (URL origen,
foto usada, timestamps).

## Flujo

```
Cloud Scheduler (cron por sitio×país)
  └─▶ Cloud Run Job "ingest"  ── scrapea + elige packshot (VLM/heurística)
        ├─ assets → GCS
        └─ producto pendiente → Pub/Sub ─▶ Cloud Run "generator" (push, ×8)
                                             ├─ API 3D (Tripo) → GLB+preview → GCS
                                             ├─ juez VLM → approved/rejected
                                             └─ documento → Firestore catalog_{site}_{country}
```

## Despliegue

```bash
cd infra/gcp
terraform init
terraform apply -var project_id=<tu-proyecto>

# claves de las APIs externas (una vez):
echo -n "tsk_..." | gcloud secrets versions add room-designer-dev-tripo-api-key --data-file=-
echo -n "sk-..."  | gcloud secrets versions add room-designer-dev-judge-api-key --data-file=-

# imagen del pipeline:
docker build -f pipeline/Dockerfile -t <artifact_repo>/pipeline:latest .
docker push <artifact_repo>/pipeline:latest
```

Añadir un catálogo nuevo = añadir una entrada a `catalog_sources` en un
`terraform.tfvars` (sitio, país, cron, límite) + su `SiteConfig` en
`pipeline/adapters/sites.ts`.

## Pendiente de implementación en el contenedor

Los entrypoints cloud del contenedor (`ingest` con `--country`, publicación
en Pub/Sub, `serve-generator` HTTP, adaptadores GcsAssetStore y
FirestoreCatalog, y el selector de imagen por VLM) están definidos por esta
infra y por los puertos existentes del pipeline; se implementan en el
siguiente ciclo. El flag de VLM-decode nace apagado.
