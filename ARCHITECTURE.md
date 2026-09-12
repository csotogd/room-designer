# Arquitectura actual

El editor del navegador usa TypeScript y Three.js. Los servicios de diseño,
búsqueda y catálogo usan Python 3.12+; Google ADK ejecuta los agentes y sus
herramientas. HTTP/JSON y WebSocket mantienen los contratos que ya consume
el editor. Los contratos `.proto` son una propuesta futura, no un servicio
implementado.

```text
Navegador: ui → app → core
                   │ HTTP / WebSocket
                   ▼
Python: transporte FastAPI → casos de uso → dominio
               │                 ▲
               └── composición ──┤
                     │           └── puertos (Protocol)
                     ├── ADK Runner + LlmAgent + function tools
                     ├── Gemini nativo / LiteLlm (OpenAI y Anthropic)
                     ├── búsqueda HTTP / embeddings / catálogo
                     └── persistencia de habitación y evidencia
```

## Límites del código

- `backend/room_designer/domain/room.py`: geometría, aperturas, reparación,
  acciones y log reproducible. No importa ADK, HTTP, persistencia ni SDKs.
- `application/ports.py`: contratos de repositorio, búsqueda, picker,
  juez, runtime y screenshots. `application/design.py`: tools tipadas y
  transacción de un turno, sin dependencias del framework.
- `adapters/adk_runtime.py`: factoría de modelos, instrucciones y Runner.
  `application/critique.py` calcula y recuerda evaluaciones;
  `application/workflow.py` coordina un ciclo cancelable por habitación.
  Cada captura consume un ticket de ciclo y revisión; el agente recibe la
  crítica y refina hasta la media objetivo, sin contador máximo de rondas.
  `adapters/vision.py`: selección multimodal y juez mediante ADK, validando
  sus resultados. `adapters/http.py`: exclusivamente contratos de transporte.
- `adapters/storage.py`: catálogo publicado, HTTP de búsqueda, room file
  atómico y evidencia local/GCS.
- `search/`: índice coseno vectorizado con NumPy, sincronización por hash,
  almacenamiento compatible JSON + float32, embeddings y evaluación.
- `pipeline/`: fuentes JSON-LD/Poly Haven/Sketchfab, assets, geometría GLB,
  packshots, generación Tripo/TRELLIS, juez ADK y publicación. Un CLI
  `catalog` sirve todos los trabajos; no invoca procesos Node.
- `bootstrap.py`: único punto de composición de servicios. Carga `.env`
  explícitamente y crea las dependencias al arrancar, no al importar.

Las reglas `domain`/`application` y `ui → app → core` se comprueban con tests.
El frontend conserva su dominio para edición interactiva, comandos y undo;
el servidor valida sus propias acciones sin depender del estado del renderer.

## Un turno de diseño

1. Se serializan los turnos que comparten el room file.
2. Se carga estado + conversación reciente y se crea una copia de trabajo.
3. Un `LlmAgent` de ADK recibe las tools `get_room`, `search_catalog`,
   `set_room`, `add_opening`, `clear_openings`, `place_furniture`,
   `replace_furniture`, `move_furniture`, `rotate_furniture`, `remove_furniture`.
4. Colocar/reemplazar busca top-20, llama al picker visual, exige que el
   producto elegido esté entre esos candidatos y usa sus medidas reales.
5. El dominio impide muebles fuera del plano, flotando, sobre el techo,
   solapados o bloqueando aperturas. Repara cerca de la posición solicitada
   o devuelve un rechazo. Un `move` no puede cambiar la rotación.
6. Cada cambio aceptado aparece como acción explícita y como entrada del
   log. Redimensionar genera también las recolocaciones o retiradas necesarias.
7. Si ADK o una dependencia falla, o vence el timeout, no se guarda el turno.
   Si finaliza, estado, log y las últimas veinte intervenciones se escriben
   juntos mediante temporal + fsync + replace. Después se responde y se
   propaga el estado a las otras conexiones.

La conversación se almacena en el campo opcional `conversation`; `version:1`,
las acciones y las coordenadas existentes siguen siendo compatibles. Cada
Runner tiene una sesión efímera aislada; el estado durable lo aporta el
repositorio. Así no existe otra copia de la habitación en una sesión ADK
que pueda divergir al reconectar o cambiar de proveedor.

El renderer proporciona el screenshot al endpoint `judge`; el servicio
valida PNG, guarda la evidencia y ejecuta el agente visual. No se puntúa una
imagen que no haya quedado guardada.

## Proveedores

`ModelConfig` valida proveedor, modelo y credenciales al arrancar. Gemini
usa `Gemini` con cliente de Google AI Studio explícito. OpenAI y Anthropic
con API key directa usan `LiteLlm`; no requieren credenciales GCP. No hay
lógica de proveedor en las tools. Brain, picker y juez pueden configurarse
por separado. Un proveedor explícito sin clave falla; no cae silenciosamente
a fake.

El modo `fake` sustituye el modelo por `OfflineModel`, que produce llamadas
reales a las mismas tools de ADK. Es una plantilla de desarrollo, no un LLM.
Picker y juez deterministas indican su naturaleza en sus resultados.

Referencias de la integración: [modelos ADK](https://adk.dev/agents/models/),
[Claude en Python](https://adk.dev/agents/models/anthropic/),
[LiteLLM](https://adk.dev/agents/models/litellm/).

## Búsqueda y catálogo

Cada catálogo mantiene sus assets, `index-<site>.json` y snapshot de búsqueda.
El sync recibe el catálogo completo, deduplica IDs, embebe sólo los productos
cuyo hash cambió y elimina retirados. Valida todos los vectores y persiste
el nuevo snapshot antes de sustituir el índice en memoria. Un fallo de
embeddings o disco conserva la instantánea anterior. Las consultas pueden
seguir leyendo el índice previo durante el sync.

El formato binario existente se conserva. `hashing-v3` conserva su algoritmo;
CLIP Python usa PyTorch y una versión de embedding distinta a ONNX: la
primera puesta en marcha reconstruye el índice a partir del catálogo
publicado. No se mezclan vectores de distintos modelos.

El pipeline guarda checkpoints tras cada producto/modelo/veredicto; conserva
el modelo de una ingesta previa sólo si no cambió su entrada. Licencias y
autores se propagan hasta el catálogo del navegador. `catalog link` sólo
sincroniza la búsqueda si el sitio publicado es el activo. `catalog sync
--verify` comprueba el número de IDs únicos; la evaluación mide Recall@k,
MRR y NDCG con los golden sets existentes.

## Operación y pruebas

- `uv.lock` resuelve todas las plataformas/extras. `requirements.lock` es
  su exportación con versiones exactas para pip y Docker.
- `npm run test:backend`: escenarios de negocio, límites geométricos,
  atomicidad, concurrencia, HTTP/WS, proveedores y pipeline.
- `npm test -- --run`: tests del editor y clientes TypeScript contra dos
  servidores Python reales y el Runner ADK offline.
- `npm run test:all`: ambas suites. El gate Gherkin incluye los tests Python.
- `npm run build` y `npm run lint:backend`: tipos, bundle y lint.

Las respuestas remotas de proveedores se simulan en los tests; éstos prueban
la conversión de herramientas, respuestas e imágenes sin depender de cuotas
ni claves. No certifican acceso real a una cuenta externa.

El repositorio de habitación y el índice de fichero requieren **un proceso
por fichero / un worker por servicio**. Son apropiados para la instalación
local actual. Para varias réplicas se debe implementar el puerto de repositorio
con transacciones compartidas (por ejemplo Postgres) y coordinar el índice.
El backend conserva el modelo actual de una habitación compartida, no añade
cuentas ni aislamiento multiusuario.

Los Dockerfiles arrancan Python. Airflow usa los CLIs Python. Terraform en
`infra/gcp` sigue siendo el plan de infraestructura: el worker Pub/Sub
`serve-generator`, AssetStore GCS y catálogo Firestore estaban pendientes y
siguen pendientes; no se despliega esa ruta como si estuviera implementada.
La evidencia de screenshots sí dispone de adaptador GCS operativo.
