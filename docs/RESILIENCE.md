# Resiliencia operativa

El backend aplica cuatro garantías complementarias. Ninguna sustituye a las
otras: un retry seguro necesita idempotencia; una copia solo sirve si se puede
restaurar; y un límite por proceso no es un perímetro distribuido.

## Idempotencia

Las ediciones manuales y los turnos de chat conservan los últimos 100 recibos
en el estado reproducible de la habitación. Repetir el mismo `requestId` con
el mismo contenido devuelve el resultado persistido sin volver a aplicar la
operación; reutilizarlo con contenido diferente se rechaza. El catálogo y el
índice ya proyectan por ID y hash, por lo que una sincronización sin cambios no
vuelve a generar embeddings.

Los mensajes de captura del juez se consumen una vez por ciclo y revisión. Los
proveedores de generación 3D no se reintentan en `POST` sin una clave de
idempotencia del proveedor: repetir una creación de pago ante un corte de red
sería peor que devolver un error recuperable.

## Retries

Las operaciones remotas de lectura y las escrituras con nombre determinista
usan hasta tres intentos con backoff exponencial acotado. Solo se reintentan
timeouts, errores de red/protocolo y HTTP 408, 425, 429 o 5xx. Los 4xx de
validación/autorización se devuelven inmediatamente.

Las capturas usan el mismo nombre por `requestId`, así que reintentar su subida
no crea artefactos duplicados. El sondeo de Tripo se reintenta; la creación de
tareas no, hasta que el proveedor ofrezca una clave de idempotencia.

## Backups y recuperación

`FileRoomRepository` conserva tres generaciones junto al archivo principal:
`room.json.bak`, `room.json.bak.1` y `room.json.bak.2`. La restauración usa un
reemplazo atómico. Los snapshots del buscador rotan su metadato antes de
publicar uno nuevo y, si el índice actual no se puede leer, arrancan desde la
última copia válida.

Estas copias protegen contra una escritura local interrumpida y requieren que
`DESIGNER_ROOM_FILE` y `SEARCH_DATA_DIR` estén en un volumen persistente. No
son recuperación ante pérdida completa de la máquina. El nodo Airflow ya
mantiene copia lógica verificada en GCS y snapshots de disco; los assets GCS
del catálogo tienen versionado activado.

## Rate limiting

`RATE_LIMIT_PER_MINUTE` (120 por defecto) limita por IP y por instancia tanto
las peticiones HTTP como los mensajes WebSocket. Al superar el presupuesto se
recibe HTTP 429 o un evento WebSocket con `retryAfterSeconds`; HTTP expone
además `Retry-After` al navegador. Los endpoints `/healthz` y `/metrics` no se
limitan para no ocultar un incidente.

El límite en memoria evita que una instancia se agote, pero no suma tráfico
entre réplicas. Antes de escalar el backend a varias instancias hay que añadir
un límite distribuido en el perímetro gestionado (por ejemplo Cloud Armor o
API Gateway) o un contador centralizado. No debe afirmarse que el límite local
es una defensa global.

## Configuración

```dotenv
RATE_LIMIT_PER_MINUTE=120
DESIGNER_BACKUP_COUNT=3
SEARCH_SNAPSHOT_BACKUP_COUNT=3
```
