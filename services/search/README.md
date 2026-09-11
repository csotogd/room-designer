# Búsqueda semántica del catálogo

Microservicio HTTP que indexa **un embedding por producto** (foto +
descripción + precio) y responde búsquedas por relevancia en milisegundos,
también con 100k productos (fuerza bruta vectorizada sobre `Float32Array`
contigua: sin base de datos vectorial que operar hasta que el catálogo crezca
otro orden de magnitud).

## Arranque local

```bash
npm run search:serve            # escucha en :8787, índice en data/search-index
npm run pipeline:link           # publica el catálogo y dispara el sync de embeddings
npm run search:sync -- --verify # sync explícito + puerta de consistencia catálogo ≡ índice
```

La app (Vite) usa `VITE_SEARCH_URL` (por defecto `http://localhost:8787`).
Si el servicio no está levantado, la barra de búsqueda degrada a un ranking
léxico local: nunca se queda muerta.

## API

| Ruta | Descripción |
|---|---|
| `GET /healthz` | estado, nº de productos, proveedor de embeddings |
| `GET /metrics` | contadores/latencias por ruta y último sync (JSON) |
| `GET /search?q=...&limit=20` | `{ results: [{ id, score }], tookMs }` |
| `POST /sync` | `{ products: [...] }` instantánea completa del catálogo |

HTTP/JSON y no gRPC a propósito: el consumidor es el navegador (gRPC-web
necesitaría proxy Envoy) y los payloads son pequeños; con esto la API es
depurable con `curl` y compatible con cualquier health-checker.

## Sincronización (refresco diario)

`pipeline:link` publica el catálogo y hace `POST /sync` con la instantánea
completa; `npm run search:sync` es el mismo sync como paso orquestable
independiente (tarea propia en el DAG de Airflow, con sus reintentos), y con
`--verify` actúa de puerta de reconciliación: falla si el nº de productos del
catálogo y del índice difieren. **La foto del embedding es el packshot**
(producto solo sobre fondo neutro, `assets.packshotUrl`), nunca la foto
lifestyle: el fondo contaminaría el vector. Patrones aplicados:

- **Idempotencia por hash de contenido** — sha256 de (versión del embedder,
  id, nombre, descripción, precio, foto). Repetir el sync no re-embebe nada;
  solo lo que cambió pasa por el embedder.
- **Instantánea completa, no deltas** — lo que no viene en la lista se borra
  del índice: catálogo y base de vectores siempre sincronizados.
- **Syncs serializados** — una cola interna evita carreras entre refrescos.
- **Persistencia atómica** — metadatos JSON + vectores binarios se escriben
  con tmp + rename; un proceso caído a medias nunca corrompe el índice, y al
  reiniciar el servicio se restaura sin re-embeber.
- **Cambio de embedder = re-embebido total** — la versión del proveedor entra
  en el hash: cambiar de modelo invalida el índice de forma automática.

## Calidad del buscador (no solo latencia)

- **Evaluación offline**: `npm run search:eval` indexa el catálogo publicado
  y mide **Recall@5, MRR y NDCG@5** contra el golden set
  (`services/search/eval/golden.json`, consulta → ids relevantes). Sale con
  código 1 si el MRR medio baja de `SEARCH_EVAL_MIN_MRR` (0.6): puerta de
  calidad en CI y comparador objetivo entre proveedores de embeddings antes
  de cambiarlos en producción. Amplía el golden set con cada categoría nueva.
- **Señales online** (`GET /metrics → searchQuality`): media del score del
  mejor resultado, tasa de búsquedas vacías y tasa de baja confianza
  (top score < 0.25). Si suben, la gente pide cosas que el catálogo o el
  modelo no cubren — sin necesidad de etiquetas.
- **Materia prima para mejorar**: con `LOG_LEVEL=debug` cada búsqueda queda
  logueada con su mejor resultado y score; cruzado con clics del front da un
  dataset de relevancia real (siguiente paso natural: endpoint de feedback).

## Observabilidad

- **Logs estructurados**: una línea JSON por evento (`LOG_LEVEL=debug|info|...`),
  compatibles con Cloud Run / CloudWatch / Datadog.
- **Trazabilidad**: cada petición lleva `x-request-id` (se acepta el entrante
  o se genera y se devuelve). El `pipeline:link` genera un `runId` y lo
  propaga: una ejecución del refresco se sigue de punta a punta con un filtro.
- **Métricas**: `GET /metrics` (peticiones, errores, latencias media/máxima
  por ruta, último sync y su informe). Punto único a tocar si algún día se
  quiere formato Prometheus.

## Configuración

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `8787` | puerto de escucha |
| `SEARCH_DATA_DIR` | `data/search-index` | carpeta persistente del índice |
| `EMBEDDINGS_PROVIDER` | `hybrid` | `hybrid` (multimodal LOCAL por defecto: bloque léxico + bloque CLIP ViT-B/32 sobre ONNX concatenados con pesos — sin clave, ~90 MB de modelo cacheado tras la 1ª vez; medido en el golden set: iguala al léxico en MRR y lo supera en NDCG, con la foto en el vector), `clip` (solo CLIP, experimentos), `jina` (multimodal cloud) o `hashing` (léxico determinista: tests/CI). `SEARCH_HYBRID_LEX_WEIGHT` (0.6) ajusta la mezcla. |
| `JINA_API_KEY` | — | obligatoria con `EMBEDDINGS_PROVIDER=jina` |
| `SEARCH_SYNC_TOKEN` | — | si se define, `POST /sync` exige `Authorization: Bearer` |
| `LOG_LEVEL` | `info` | nivel de logs |

Y en el lado del pipeline: `SEARCH_URL`, `SEARCH_SYNC_TOKEN`,
`CATALOG_PUBLIC_BASE_URL` (base pública de las fotos para el embedder
multimodal). En el front: `VITE_SEARCH_URL`.

## Nube

```bash
docker build -f services/search/Dockerfile -t catalog-search .
docker run -p 8787:8787 -v search-data:/data catalog-search
```

- **Cloud Run / Fly / K8s**: contenedor único con volumen (o disco) para
  `SEARCH_DATA_DIR`; `/healthz` como probe; SIGTERM hace apagado limpio. El
  índice es **derivado**: si se pierde el volumen, el siguiente refresco lo
  reconstruye entero (no necesita backup).
- **Producción**: `EMBEDDINGS_PROVIDER=jina` + `JINA_API_KEY` (jina-clip-v2
  embebe foto y texto en el mismo espacio; el vector del producto es la media
  de ambos) y `SEARCH_SYNC_TOKEN` para proteger `/sync`.
- **Orquestación diaria**: DAG de Airflow en
  `deploy/airflow/catalog_refresh_dag.py` (ingest → generate → judge → link,
  con reintentos seguros porque todos los pasos son idempotentes). Sin
  Airflow, un cron/Cloud Scheduler con los mismos comandos vale igual.

## Deuda consciente / siguientes pasos

- Rate limiting y TLS se delegan al gateway/ingress de la plataforma.
- Si el catálogo supera ~1M productos: cuantización int8 o HNSW detrás del
  mismo puerto `VectorIndex` (la API no cambia).
- OpenTelemetry (trazas distribuidas) si aparecen más servicios; hoy el
  `x-request-id` cubre la correlación pipeline ↔ servicio.
