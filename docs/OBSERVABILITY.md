# Observabilidad

El backend emite una línea JSON por operación HTTP y por mensaje WebSocket.
Todos los servicios arrancados desde `room_designer.bootstrap` y el CLI de
catálogo comparten el mismo formato.

## Correlación

- `requestId` identifica la petición o mensaje concreto. Se acepta
  `X-Request-Id`; si falta o no es seguro, se genera un UUID.
- `traceId` agrupa las operaciones relacionadas. Se extrae del identificador
  de traza de `traceparent` cuando es válido, o de `X-Trace-Id`; si falta, se
  genera un UUID.
- Las respuestas HTTP devuelven `X-Request-Id` y `X-Trace-Id`. El middleware
  CORS también los expone al navegador.
- Los mensajes WebSocket mantienen el `traceId` de la conexión y el
  `requestId` del mensaje en los eventos de finalización y error.

## Eventos

Los campos comunes son `timestamp`, `level`, `logger`, `message`, `requestId` y
`traceId`. Las operaciones HTTP añaden `event`, `route`, `status` y
`durationMs`; los mensajes WebSocket añaden `event`, `operation`, `status` y
`durationMs`.

Los eventos principales son `http.request.completed`,
`http.request.failed`, `websocket.connected`, `websocket.message.completed` y
`websocket.message.failed`. No se registran cuerpos, prompts, imágenes,
tokens ni credenciales.

Para cambiar el nivel se usa `LOG_LEVEL` (`INFO` por defecto). El formato está
pensado para que un agregador pueda filtrar por `traceId` sin depender del
texto humano del mensaje.
