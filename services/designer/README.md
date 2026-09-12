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

`place_furniture(search_query, x, z, rotation=0, role="", y=0)` y
`move_furniture(uid, x, z, y=None)` permiten elegir la posición en 3D, en metros.
`y` mide la distancia del suelo a la base del mueble: `0` lo coloca en el suelo.
Omitir `y` al mover conserva la altura actual; reemplazar también la conserva.
Los productos mantienen sus dimensiones de catálogo. La reparación puede ajustar
la posición horizontal, pero conserva la altura elegida. Se rechazan alturas
negativas o que hagan sobresalir el mueble por el techo; las colisiones entre
muebles y con aperturas tienen en cuenta el solapamiento vertical.
La altura se guarda en el estado y el log, se restaura al recargar y se deshace
con el resto del turno. Las acciones antiguas sin `y` siguen siendo compatibles.

El estado permanece en `data/designer/room-<site>.json`: versión 1, habitación,
aperturas, items, log y conversación reciente opcional. Los ficheros previos
son compatibles. Un worker por fichero; no ejecutar varias réplicas sobre
el mismo JSON. Los screenshots del juez se guardan antes de enviar al modelo.

## Protocolo

| Mensaje `/ws` | Respuesta |
|---|---|
| al conectar | `{type:'state', state}` |
| `{type:'chat', requestId, text}` | `{type:'reply', requestId, runId, evaluation, reply, actions, state, rejected, round, refinement}` |
| `{type:'judge', requestId, runId, revision, image}` | `{type:'judge.result', requestId, runId, revision, verdict, mean, target, judgeText, feedback, refining, round, stopReason, evidence, state}` |
| `{type:'stop', requestId, runId?}` | `{type:'loop.stopped', runId, reason}` |
| Captura de otra revisión/ciclo, duplicada o sin turno pendiente | `{type:'judge.ignored', requestId, reason}` |
| error | `{type:'error', requestId, error}` |

HTTP: `GET /healthz`, `GET /metrics`, `GET /state`. Otros clientes reciben
un mensaje `state` tras los cambios. `image` debe ser PNG base64 o data URL.

**Bucle juez→agente:** cada veredicto se registra en el estado (nota actual,
historial y conversación en lenguaje natural). El agente lee esa conversación
en sus turnos posteriores. `application/workflow.py` coordina el ciclo;
el WebSocket se limita a recibir comandos y entregar eventos.

La media aritmética de cohesión, colores, estilo y adherencia debe alcanzar
`DESIGNER_JUDGE_TARGET` (7 por defecto, entre 1 y 10). `overall` es informativo
y no decide el paro. No se redondea antes de comparar. No hay límite de
rondas ni paro por estancamiento: incluso una ronda sin acciones vuelve a
capturarse y evaluarse. `DESIGNER_JUDGE_PATIENCE` se ha retirado.

Cada respuesta entrega `evaluation: {runId, revision}`. El cliente espera
la carga de los modelos 3D, captura el PNG y devuelve **ese mismo ticket**.
El servidor lo consume una sola vez y conserva el encargo original, aunque
el cliente envíe otro `brief`. Tras una nota baja, entrega el veredicto y
lanza automáticamente un turno con las observaciones del juez.

El chat muestra las intervenciones de ambos, las cuatro notas, la media y
un historial desplegable. Después de modificar la habitación, la nota
anterior queda en el historial y la actual aparece pendiente de evaluación.
La conversación y las últimas 20 evaluaciones sobreviven a una recarga;
la numeración del ciclo no depende del tamaño de ese historial.

**Detener** cancela también una llamada al agente/juez en curso. Un encargo
nuevo sustituye el ciclo anterior. Una desconexión, una edición manual o
un fallo de aplicación/carga/captura interrumpen el ciclo y lo indican en
el chat. Los cambios de un turno cancelado no se guardan. Al reconectar
se restaura el estado; no se reinician llamadas al modelo automáticamente.

Un ciclo pertenece a la pestaña que entrega sus capturas. Las demás reciben
estados con conversación y notas. Los clientes deben actualizarse juntos
con el servidor: las capturas sin `runId`/`revision` ya no se aceptan.

| Variable | Valor por defecto |
|---|---|
| `DESIGNER_PORT` | 8790 (`PORT` tiene precedencia en contenedores) |
| `DESIGNER_JUDGE_TARGET` | 7 (media de las cuatro métricas) |
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
