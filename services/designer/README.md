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

El chat acepta texto libre en `chat.text`: saludos, dudas, objetivos vagos e
instrucciones precisas. Python interpreta el mensaje junto con el estado y el
historial. El agente puede usar `respond_conversationally` para responder o pedir
aclaraciones: ese turno conserva la escena y devuelve `evaluation: null`.
La interfaz muestra la respuesta y espera al usuario. Solo captura una imagen
cuando el servicio devuelve un ticket `evaluation`. El modo conversacional
bloquea cambios de escena dentro del mismo turno; tampoco puede seleccionarse
después de haber ejecutado modificaciones.

Este contrato funciona en el servicio WebSocket Python existente. No implica
un despliegue nuevo en Cloud Run ni la activación de credenciales de Gemini.

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
| `{type:'chat', requestId, text, revision?}` | `{type:'reply', requestId, runId, evaluation, reply, actions, state, rejected, round, refinement}` |
| `{type:'edit', requestId, baseRevision, base, desired}` | `{type:'edit.result', requestId, state, changed, rebased}` o `{type:'edit.conflict', requestId, state, conflicts}` |
| `{type:'judge', requestId, runId, revision, image}` | `{type:'judge.result', requestId, runId, revision, verdict, mean, target, judgeText, feedback, refining, round, stopReason, evidence, state}` |
| `{type:'stop', requestId, runId?}` | `{type:'loop.stopped', runId, reason}` |
| Captura de otra revisión/ciclo, duplicada o sin turno pendiente | `{type:'judge.ignored', requestId, reason}` |
| error | `{type:'error', requestId, error}` |

HTTP: `GET /healthz`, `GET /metrics`, `GET /state`. Otros clientes reciben
un mensaje `state` tras los cambios. `image` debe ser PNG base64 o data URL.

**Edición manual compartida:** el editor envía la escena al terminar el arrastre;
agrupa otras ediciones durante 250 ms. `base` es la escena de partida y `desired`
la edición local: plano, aperturas, muebles con UID/posición 3D/giro/apoyos,
luces, hora y acabados. El servidor valida y combina cada lote con el estado
actual bajo el mismo bloqueo que usan las tools. Dos muebles distintos pueden
cambiar simultáneamente; modificar el mismo mueble o cambiar el plano durante
otra edición produce un conflicto. El chat ofrece «Conservar mis cambios» y
«Usar versión compartida» antes de volver a guardar.

El borrador y la petición pendiente permanecen en `sessionStorage` de esa
pestaña durante recargas y desconexiones. Al reconectar se reenvía el mismo
`requestId`: los últimos 100 recibos persistidos evitan duplicar la edición
si se perdió la confirmación. La cola admite una petición en vuelo y conserva
las ediciones posteriores. Cerrar la pestaña elimina esta recuperación local.

Antes de iniciar al agente, el chat espera todas las confirmaciones y envía
la revisión guardada. Si otra edición cambia esa revisión antes del turno,
el servidor devuelve el estado nuevo y pide reenviar el encargo. Una edición
manual detiene el ciclo activo e invalida la nota actual, conservando su
historial. Cada turno ADK carga la escena persistida, incluido el ambiente.

El contrato de agentes admite actualmente **planos rectangulares**. Un plano
manual en L o libre se conserva en el editor y bloquea el guardado compartido
y el turno del agente con un aviso; no se convierte a un rectángulo.

**Bucle juez→agente:** cada veredicto se registra en el estado (nota actual,
historial y conversación en lenguaje natural). El agente lee esa conversación
en sus turnos posteriores. `application/workflow.py` coordina el ciclo;
el WebSocket se limita a recibir comandos y entregar eventos.

La media aritmética de cohesión, colores, estilo, adecuación al encargo,
rotación correcta y completitud debe alcanzar
`DESIGNER_JUDGE_TARGET` (7 por defecto, entre 1 y 10). `overall` es informativo
y no decide el paro. No se redondea antes de comparar. No hay límite de
rondas ni paro por estancamiento: incluso una ronda sin acciones vuelve a
capturarse y evaluarse. `DESIGNER_JUDGE_PATIENCE` se ha retirado.

Cada respuesta entrega `evaluation: {runId, revision}`. El cliente espera
la carga de los modelos 3D, captura el PNG y devuelve **ese mismo ticket**.
El servidor lo consume una sola vez y conserva el encargo original, aunque
el cliente envíe otro `brief`. Tras una nota baja, entrega el veredicto y
lanza automáticamente un turno con las observaciones del juez.

El chat muestra las intervenciones de ambos, las seis notas, la media y
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
| `DESIGNER_JUDGE_TARGET` | 7 (media de las seis métricas) |
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

## Pensamiento y actividad en la conversación

Cada turno del diseñador y del juez muestra «Pensando…» y un desplegable
«Ver pensamiento». El contenido identifica siempre al agente: diseñador,
juez, selector de muebles o agente de la zona correspondiente. Los resúmenes
públicos de razonamiento se muestran íntegros; las acciones tienen nombres
legibles y sus argumentos/resultados completos están en «Ver detalles de la
acción». Cada actualización aparece cuando el proveedor la entrega a ADK;
no se inventa actividad mientras se espera al modelo.

Para Gemini se solicita `include_thoughts`. La API entrega resúmenes públicos,
no el razonamiento interno completo; las firmas opacas del proveedor nunca se
incluyen en el chat. Los otros proveedores muestran el contenido público que
expongan. La falta de resumen no impide ver las herramientas utilizadas.
Referencia: https://ai.google.dev/gemini-api/docs/thinking

El cliente pide `activity: true` al iniciar el chat. El servicio envía eventos
`agent.progress` con ciclo, petición, ronda, fase y agente; la respuesta final
incluye `activity`, que también se guarda en la conversación. Una cancelación,
un nuevo encargo o un cambio de fase impiden aplicar eventos antiguos. La
suscripción de actividad es independiente del progreso de la escena y los
clientes anteriores siguen recibiendo sus respuestas habituales.

La rúbrica incluye cohesión, colores, estilo, adecuación al encargo, rotación
correcta y completitud, todas sobre 10 y con el mismo peso en la media.
Rotación correcta valora la orientación funcional y el acceso a los muebles.
Completitud valora que estén los muebles necesarios para el uso solicitado,
sin carencias ni saturación y respetando el minimalismo funcional. El juez
explica los problemas en sus notas y el diseñador recibe las dimensiones
que quedan por debajo del objetivo para corregirlas. Las notas históricas
que no incluyan los nuevos criterios muestran «Sin evaluar».

## Prueba local con Secret Manager

La clave de Gemini se obtiene al arrancar desde el secreto de **dev**, versión
`1`, en `room-designer-508414`. No se copia a `.env`, no se imprime y no se
incluye en el frontend. Las credenciales de sesión de Google (ADC) sí se guardan
en la configuración de usuario que gestiona Google Cloud CLI.

Con Google Cloud CLI instalada, inicia sesión una vez:

```bash
gcloud auth application-default login --disable-quota-project --scopes=https://www.googleapis.com/auth/cloud-platform
gcloud auth application-default set-quota-project room-designer-508414
```

Este flujo estándar solicita el ámbito OAuth de Google Cloud; las operaciones
permitidas dependen del IAM de la cuenta autenticada. Se necesita permiso de
lectura de la versión del secreto. No se cambian permisos IAM al arrancar.

Desde la raíz del repositorio, en terminales distintas:

```bash
npm run search:serve
npm run designer:local
npm run dev
```

Si el buscador ya está funcionando en `8787`, reutilízalo. Abre la dirección
que muestra Vite (normalmente `http://localhost:5173`). El backend local escucha
en `127.0.0.1:8790`; `/healthz` debe indicar `gemini/gemini-3.5-flash` y un
catálogo no vacío. El proveedor del diseñador, selector de muebles y juez es
Gemini real. La ausencia de autenticación o de acceso al secreto detiene el
arranque: nunca se sustituye por agentes simulados.

El comando usa `gemini-3.5-flash`, ya validado en dev. Se puede cambiar con
`DESIGNER_MODEL` o los modelos por rol. `DESIGNER_GEMINI_SECRET` admite otra
referencia completa a una versión (`projects/.../secrets/.../versions/...`).
El arranque local ignora las URL de API alternativas y las claves por rol:
todos reciben la clave recuperada y usan la API oficial de Gemini.
No se necesita acceder al valor de la clave manualmente.

Prueba una petición con varios cambios y despliega «Pensando…». Tras la
captura aparecen las seis notas del juez. **Detener** interrumpe las rondas de
mejora. Las llamadas reales utilizan el saldo de Gemini del proyecto.

Referencias: [autenticación de Secret Manager](https://docs.cloud.google.com/secret-manager/docs/authentication)
y [acceso a versiones](https://docs.cloud.google.com/secret-manager/docs/access-secret-version).
