# Búsqueda de catálogo en Python

Código: `backend/room_designer/search/`; transporte en `adapters/http.py`.
NumPy ejecuta búsqueda coseno vectorizada. Se mantiene la API del frontend.

```bash
npm run search:serve
npm run pipeline:link -- --site polyhaven
npm run search:sync -- --verify
npm run search:eval
```

Los scripts ejecutan Python. Instalación y arquitectura en el [README](../../README.md).

| Ruta | Resultado |
|---|---|
| `GET /healthz` | productos, versión del embedder, dimensiones, restauración |
| `GET /search?q=&limit=` | `{results: [{id,score}], tookMs}` |
| `POST /sync` | `{products:[...]}` → added, updated, removed, unchanged, total |
| `GET /metrics` | latencias, errores, último sync, calidad online |

`POST /sync` recibe la instantánea completa y retira los IDs ausentes. Se
valida la entrada antes de escribir; un fallo de proveedor o persistencia
conserva el índice anterior. Las peticiones propagan `X-Request-Id`.
`SEARCH_SYNC_TOKEN` exige `Authorization: Bearer <token>` para escribir.

| Variable | Default |
|---|---|
| `PORT` | 8787 |
| `CATALOG_SITE` | sklum |
| `SEARCH_DATA_DIR` | `data/search-index/<site>` |
| `EMBEDDINGS_PROVIDER` | hybrid |
| `SEARCH_CLIP_MODEL` | openai/clip-vit-base-patch32 |
| `SEARCH_CLIP_IMAGE_WEIGHT` | 0.25 |
| `SEARCH_HYBRID_LEX_WEIGHT` | 0.6 |
| `CATALOG_PUBLIC_DIR` | public |
| `SEARCH_EVAL_K` | 5 |
| `SEARCH_EVAL_MIN_MRR` | 0.6 |

`hashing` es léxico determinista sin red. `clip` usa CLIP local con PyTorch,
`hybrid` combina CLIP y hashing; ambos requieren el extra `[clip]` y descarga
de pesos inicial. `jina` usa jina-clip-v2 y requiere `JINA_API_KEY`.

JSON + float32 conserva el formato de persistencia previo. `hashing-v3`
conserva hashes y vectores compatibles. CLIP Python tiene una versión
propia: el índice ONNX anterior se reconstruye desde el catálogo publicado
la primera vez; no se mezclan vectores incompatibles. Si no hay catálogo
publicado, el servicio arranca vacío hasta recibir `/sync`.

Los golden sets permanecen en `services/search/eval/`. `catalog eval`
acepta `--catalog` y `--golden`, usa la misma foto de packshot que el sync y
falla si MRR queda bajo el umbral. Recall usa el total de relevantes, incluso
si hay más relevantes que posiciones en top-k.
