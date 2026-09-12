# Diseñador Python + Google ADK

Código: [`backend/room_designer`](../../backend/room_designer).
Arquitectura y límites: [ARCHITECTURE.md](../../ARCHITECTURE.md).

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -c requirements.lock -e '.[dev,clip,mesh]'
npm run search:serve
npm run designer:serve
npm run dev
```

Ejecuta los tres últimos comandos en terminales distintas. Alternativamente,
activa `.venv` y usa `search-serve` / `designer-serve` sin npm.

## Conexiones

| Proveedor | Configuración | Conector ADK |
|---|---|---|
| Gemini | `DESIGNER_PROVIDER=gemini`, `GOOGLE_API_KEY` o `GEMINI_API_KEY` | Gemini nativo, AI Studio |
| GPT | `DESIGNER_PROVIDER=openai`, `OPENAI_API_KEY` | LiteLlm |
| Claude | `DESIGNER_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` | LiteLlm, API directa |
| Prueba offline | `DESIGNER_PROVIDER=fake` | Runner ADK con modelo determinista |

`DESIGNER_MODEL` cambia el modelo. Valores por defecto: `gemini-2.5-flash`,
`gpt-4.1`, `claude-sonnet-4-6`. `auto` elige Gemini → Anthropic → OpenAI por
clave disponible y fake si no hay ninguna. Un proveedor explícito sin clave
produce error de configuración. `OPENAI_BASE_URL` admite endpoints
compatibles. Las claves permanecen en el servidor.

Para mezclar modelos: `DESIGNER_PICKER_PROVIDER`, `DESIGNER_PICKER_MODEL`,
`DESIGNER_JUDGE_PROVIDER`, `DESIGNER_JUDGE_MODEL`; cada rol acepta además
`*_API_KEY` y `*_BASE_URL`. Un cambio de proveedor no modifica las tools.

## Tools y persistencia

Las diez tools son `get_room`, `search_catalog`, `set_room`, `add_opening`,
`clear_openings`, `place_furniture`, `replace_furniture`, `move_furniture`,
`rotate_furniture`, `remove_furniture`. Colocar/reemplazar incluye búsqueda,
selección visual y guardrails. Los cambios se preparan en una copia; sólo se
persisten cuando ADK termina el turno. Los rechazos geométricos son explícitos.

El estado permanece en `data/designer/room-<site>.json`: versión 1, habitación,
aperturas, items, log y conversación reciente opcional. Los ficheros previos
son compatibles. Un worker por fichero; no ejecutar varias réplicas sobre
el mismo JSON. Los screenshots del juez se guardan antes de enviar al modelo.

## Protocolo

| Mensaje `/ws` | Respuesta |
|---|---|
| al conectar | `{type:'state', state}` |
| `{type:'chat', requestId, text}` | `{type:'reply', requestId, reply, actions, state, rejected}` |
| `{type:'judge', requestId, brief, image}` | `{type:'judge.result', requestId, verdict, mean, target, judgeText, refining, round, stopReason, evidence}` |
| error | `{type:'error', requestId, error}` |

HTTP: `GET /healthz`, `GET /metrics`, `GET /state`. Otros clientes reciben
un mensaje `state` tras los cambios. `image` debe ser PNG base64 o data URL.

**Bucle juez→agente:** cada veredicto se registra en el estado (nota actual
de la habitación, historial y conversación en lenguaje natural, visible para
el agente en turnos posteriores). Si la nota media —media de cohesión,
colores, estilo y adherencia— queda bajo `DESIGNER_JUDGE_TARGET` (7 por
defecto), el servidor relanza al agente con las notas del juez como encargo
(`{type:'reply', refinement: true, round}` en el mismo socket) y el cliente
repite aplicar→capturar→juzgar. El paro primario es alcanzar el objetivo;
el freno de seguridad es el estancamiento (`DESIGNER_JUDGE_PATIENCE` rondas
seguidas sin mejorar la media). El estado incluye `verdict` (nota actual).

| Variable | Valor por defecto |
|---|---|
| `DESIGNER_PORT` | 8790 (`PORT` tiene precedencia en contenedores) |
| `DESIGNER_TURN_TIMEOUT` | 180 segundos |
| `DESIGNER_ROOM_FILE` | `data/designer/room-<site>.json` |
| `DESIGNER_SCREENSHOT_DIR` | `data/designer/screenshots` |
| `SCREENSHOT_BUCKET` | sin definir: evidencia local |
| `SEARCH_URL` | `http://localhost:8787` |
| `DESIGNER_TOKEN` | opcional, protege WS y `/state` |
| `DESIGNER_ALLOWED_ORIGINS` | lista separada por comas; sin token se admiten también orígenes locales |
| `CATALOG_INDEX` | `public/catalog/index-<site>.json` |

Los tests ejecutan las tools reales de ADK sin llamadas facturables. La
integración de los tres proveedores se verifica con respuestas remotas
simuladas. Para activar una conexión real configura la clave correspondiente
en `.env` y reinicia el servicio.
