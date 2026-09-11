# Diseñador conversacional

Microservicio de chat que convierte un brief («créame una oficina para 4,
moderna») en **acciones sobre la habitación**: `setRoom`, `placeNew`,
`replace`, `move`, `rotate`, `remove`. El estado vive en **un fichero** con
los muebles, sus coordenadas 3D y el log completo de cambios; el front (panel
de chat a la derecha) aplica las acciones a través del dominio — un turno de
chat = una entrada de undo.

## Cómo funciona un `placeNew`

```
brief ─▶ LLM (brain) ─▶ intención con searchQuery
             │
             ▼
   microservicio de búsqueda (top-20 del catálogo real)
             │  foto + precio + descripción + medidas
             ▼
   VLM picker: elige el candidato que mejor encaja (no siempre el 1º)
             │
             ▼
   posición propuesta ─▶ GUARDRAILS ─▶ acción aplicada al fichero
```

**Guardrails duros** (el LLM propone, la geometría dispone): nada fuera de la
habitación, nada volando (y=0), nada tapando una ventana (salvo muebles bajo
el alféizar) ni bloqueando el barrido de una puerta, y sin colisiones. Si una
posición no vale, se busca el hueco válido más cercano (anillos de 25 cm,
rotación ±90°); si no hay hueco, la intención se **rechaza con motivo** —
nunca se aplica en silencio.

**VLM judge**: el front captura un screenshot de la escena tras aplicar las
acciones y lo manda al juez, que puntúa 1–10 un rubric de **cohesión,
colores, estilo y adherencia al brief**. La evidencia se persiste antes de
juzgar: **en local, fichero** (`data/designer/screenshots/`); **en cloud,
bucket GCS** (`SCREENSHOT_BUCKET`, subida por API JSON con el token del
metadata server — sin SDK).

## Arranque local

```bash
npm run search:serve     # el buscador (8787) es dependencia
npm run designer:serve   # WebSocket + HTTP en 8790
npm run dev              # la app: el panel «Diseñador» a la derecha
```

Sin `ANTHROPIC_API_KEY`, el servicio usa **proveedores fake deterministas**
(plantillas de oficina/dormitorio, picker léxico, juez constante): todo el
flujo funciona offline y es lo que usan los tests. Con la key en `.env`, los
tres papeles pasan a Claude (`claude-opus-5` por defecto).

## Protocolo WebSocket (`/ws`)

| Mensaje | Respuesta |
|---|---|
| `{type:'chat', requestId, text}` | `{type:'reply', requestId, reply, actions[], state, rejected[]}` |
| `{type:'judge', requestId, brief, image}` | `{type:'judge.result', requestId, verdict, evidence}` |
| (al conectar) | `{type:'state', state}` — el front restaura la sala guardada |

HTTP: `GET /healthz` · `GET /metrics` · `GET /state`. `DESIGNER_TOKEN`
protege el WS (`?token=`).

## El fichero de la habitación

`data/designer/room-<site>.json` (escritura atómica tmp+rename):

```jsonc
{
  "version": 1,
  "room": { "shape": "rect", "w": 5, "d": 4, "h": 2.6 },
  "openings": [{ "wall": "N", "kind": "window", "offset": 1.5, "width": 1.4 }],
  "items": [{ "uid": "it-…", "productId": "polyhaven-WoodenTable_01", "x": 1, "y": 0, "z": 1.3, "rotDeg": 0 }],
  "log": [{ "at": "…", "source": "assistant", "requestId": "…", "action": { … } }]
}
```

Reproducir el log desde cero reconstruye el estado. Es la fase "fichero +
websocket" del plan; la migración (Firestore/Postgres + Connect) cambia el
adaptador de persistencia, no el dominio.

## Configuración

| Variable | Default | Uso |
|---|---|---|
| `DESIGNER_PORT` | `8790` | puerto |
| `DESIGNER_PROVIDER` | `auto` | `anthropic` \| `fake` \| `auto` (anthropic si hay key) |
| `ANTHROPIC_API_KEY` | — | proveedor anthropic |
| `DESIGNER_MODEL` | `claude-opus-5` | modelo de brain/picker/judge |
| `DESIGNER_TOKEN` | — | token del WS |
| `DESIGNER_ROOM_FILE` | `data/designer/room-<site>.json` | fichero de estado |
| `DESIGNER_SCREENSHOT_DIR` | `data/designer/screenshots` | evidencia local del juez |
| `SCREENSHOT_BUCKET` | — | bucket GCS para la evidencia (vía cloud) |
| `SEARCH_URL` | `http://localhost:8787` | microservicio de búsqueda |
| `CATALOG_SITE`, `LOG_LEVEL` | | como el resto del repo |

En el front: `VITE_DESIGNER_URL` (`ws://localhost:8790/ws`).

## Observabilidad

Logs JSON con `requestId` por turno (plan del cerebro, producto elegido con
nº de candidatos, veredictos con su evidencia, rechazos con motivo),
`/metrics` con latencias por operación. Cada screenshot juzgado queda
guardado junto a su `requestId`: veredicto reproducible y auditable.

## Nube

```bash
docker build -f services/designer/Dockerfile -t catalog-designer .
docker run -p 8790:8790 -v designer-data:/data \
  -e DESIGNER_ROOM_FILE=/data/room.json -e ANTHROPIC_API_KEY=... catalog-designer
```

Cloud Run con disco/volumen para el room file (o migrar persistencia a
Firestore), `SCREENSHOT_BUCKET` para la evidencia del juez, `SEARCH_URL`
apuntando al servicio de búsqueda interno y las keys en Secret Manager.
