# Arquitectura y camino a producción

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
4. Assets: subir GLBs al CDN, rellenar `asset_url`; añadir `GltfModelCache`
   en `ui/view3d` con carga perezosa + placeholder procedural.
5. Autenticación (token en interceptor de Connect) y `ListProjects` para el
   "mis diseños" del usuario.
