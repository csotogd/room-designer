# Arquitectura y camino a producción

> **Regla de doble vía (desde 2026-09-03):** toda capability del pipeline se
> desarrolla en dos rutas a la vez — la **demo local** (CLIs + carpeta
> `data/catalog`) y la **solución cloud escalable en GCP** (Terraform en
> [`infra/gcp`](infra/gcp), ver su README). Misma lógica y mismos puertos;
> cambian los adaptadores: Scheduler→ingesta, GCS como AssetStore, VLM juez
> de imagen y de calidad, Firestore como catálogo por proveedor/país. El
> "decode" de imagen por VLM existe como flag y nace apagado.

## Estado actual (todo en el navegador)

```
ui  ──▶  app  ──▶  core          (regla de dependencias verificada por test)
│         │
│         ├─ FurnitureCatalog (puerto)  ◀── DefaultCatalog (datos en memoria)
│         ├─ ProjectRepository (puerto) ◀── LocalStorageProjectRepository
│         └─ FloorPlanImporter (puerto) ◀── (futuro: foto → plano)
```

El dominio (`core`) es TypeScript puro y **no sabe** dónde viven los datos.
Todo lo que en producción pasa a ser remoto ya está detrás de un puerto:
catálogo, persistencia e importación. El documento serializado
(`ProjectDoc`, JSON versionado) es el contrato de datos.

## Producción: front + back con gRPC

```
┌────────────── navegador ──────────────┐        ┌──────────── backend ───────────┐
│ ui (Three.js, paneles)                │        │                                │
│ app ── GrpcCatalog ──────────┐        │ gRPC-  │  CatalogService (Go/Node)      │
│     ── GrpcProjectRepository ┼─ connect-web ──▶│  ProjectService + Postgres     │
│ core (dominio: sin cambios)  │        │  (HTTP)│  AssetService / CDN (GLB)      │
└──────────────────────────────┴────────┘        └────────────────────────────────┘
```

Los contratos están en [`proto/roomdesigner/v1/roomdesigner.proto`](proto/roomdesigner/v1/roomdesigner.proto):

- **CatalogService.ListItems** — artículos con medidas, precio y `asset_url`
  (modelo GLB en CDN). El front sustituye `DefaultCatalog` por `GrpcCatalog`
  (misma interfaz `FurnitureCatalog`); el renderer, al ver `asset_url`, carga
  el GLB con `GLTFLoader` en lugar del modelo procedural — los procedurales
  quedan como *fallback* y placeholder de carga.
- **ProjectService.Save/Get/List** — persiste el `ProjectDoc` con revisión
  para concurrencia optimista. `GrpcProjectRepository` implementa el puerto
  `ProjectRepository` (los métodos ya son `async` por esto).

### Sobre gRPC en navegador

gRPC "puro" no funciona desde un navegador (HTTP/2 frames). Dos opciones:

1. **Connect-ES / gRPC-Web (recomendada)**: `buf` genera clientes TypeScript
   desde el `.proto`; el backend expone Connect (compatible gRPC y JSON) sin
   proxy. Stack sugerido: `buf` + `@connectrpc/connect-web` en el front, y
   `connect-go` o `@connectrpc/connect-node` en el back.
2. Envoy como proxy gRPC-Web delante de servicios gRPC clásicos, si el
   backend ya existe en ese formato.

### Qué NO cambia al migrar

- `core/` entero (geometría, plano, muebles, luces, sol, eventos).
- Los comandos y el undo (operan sobre el dominio en memoria).
- Las vistas 2D/3D y la lógica de edición (`app/editor`).
- La serialización: el proto `ProjectDoc` es un espejo 1:1 del JSON actual.

### Pasos de la migración

1. `buf generate` sobre `proto/` → clientes TS + stubs del servidor.
2. Backend mínimo: `ProjectService` sobre Postgres (tabla `projects`:
   id, owner, doc JSONB, revision) y `CatalogService` sobre una tabla o YAML.
3. `GrpcProjectRepository` y `GrpcCatalog` en `src/app/` (≈50 líneas cada uno)
   e inyección por configuración (local vs producción).
4. Assets: la entidad `Product` (core) ya lleva `assets.imageUrl` y
   `assets.modelUrl`. El renderer ya resuelve ambos con fallback local:
   `ui/view3d/models.ts` carga el GLB en diferido (caché + placeholder
   procedural mientras llega) y `ui/view3d/thumbnails.ts` usa la foto del
   bucket si existe o renderiza una miniatura del modelo. Migrar = subir
   GLBs y fotos a S3/CDN y rellenar las URLs en el catálogo del backend;
   el front no cambia.
5. Autenticación (token en interceptor de Connect) y `ListProjects` para el
   "mis diseños" del usuario.

## Catálogos múltiples (CATALOG_SITE)

El pipeline soporta fuentes de dos naturalezas bajo el mismo contrato
(`CatalogScraper` → `AssetStore` → publicación): tiendas scrapeadas cuyos
modelos se **generan** de una foto y pasan por el juez (`sklum`), y
bibliotecas 3D con licencia abierta cuyos modelos **nativos** se descargan
tal cual y entran pre-aprobados (`polyhaven` CC0, `sketchfab` CC0/CC-BY con
atribución `license`/`author`). Cada sitio materializa su bucket
(`data/catalog/<site>/`), su índice de app (`public/catalog/index-<site>.json`)
y su instantánea de embeddings (`data/search-index/<site>/`). `CATALOG_SITE`
selecciona el catálogo activo en pipeline, servicio de búsqueda y front a la
vez; el resto de catálogos queda construido y listo para conmutar sin
re-embeber. En cloud, el mismo interruptor es la variable de entorno de los
workers/Cloud Run (colecciones `catalog_{site}_{country}` ya previstas).

## Búsqueda semántica y orquestación del refresco

El buscador del catálogo es un microservicio propio
([`services/search`](services/search/README.md)): un embedding por producto
(packshot + descripción + precio), sync diario idempotente por hash de
contenido (altas, cambios y bajas en una sola instantánea) y evaluación de
calidad (Recall/MRR/NDCG contra golden set + señales online en `/metrics`).
Hoy habla HTTP/JSON; cuando el front migre a Connect, `SearchService.Search`
debe entrar en `proto/roomdesigner/v1` como un servicio más.

**Orquestación: una sola vía canónica.** El refresco diario
(ingesta → generación → juez → publicación → sync de embeddings → puerta de
consistencia → evaluación) se orquesta en GCP con Cloud Scheduler + Cloud Run
Jobs + Pub/Sub (Terraform en [`infra/gcp`](infra/gcp)); el sync y la
verificación son pasos CLI idempotentes (`npm run search:sync [-- --verify]`)
pensados para ser un job más de esa cadena. El DAG de Airflow en
[`deploy/airflow`](deploy/airflow/catalog_refresh_dag.py) expresa el mismo
grafo y sirve de referencia (o de implementación si algún día se opera
Composer), pero **no** es una segunda vía a mantener en paralelo.

## Diseñador conversacional

Tercer microservicio ([`services/designer`](services/designer/README.md)):
chat → acciones (`setRoom`/`placeNew`/`replace`/`move`/`rotate`/`remove`)
sobre **un fichero de estado** (muebles con coordenadas 3D + log de cambios,
escritura atómica). `placeNew` no inventa productos: el LLM elige una query,
el buscador devuelve top-20 del catálogo real y un **VLM picker** elige por
foto+precio+descripción; **guardrails geométricos** deterministas validan y
reparan cada posición (nada fuera, volando, tapando aperturas ni
colisionando). Un **VLM judge** puntúa screenshots con rubric (cohesión,
colores, estilo, adherencia); la evidencia se persiste en fichero local o en
GCS (`SCREENSHOT_BUCKET`) según la vía. El front habla WebSocket y aplica
las acciones vía CommandStack (un turno = un undo). Proveedores LLM/VLM por
puerto: Anthropic (`claude-opus-5`) o fakes deterministas para tests/demo.
La fase actual es "fichero + WS"; la migración cloud cambia persistencia
(Firestore) y transporte (Connect) sin tocar dominio ni guardrails.
