# Chat privado en GCP

## Estado de la activación (16 de septiembre de 2026)

La integración está preparada en el repositorio, **no desplegada ni verificada
de extremo a extremo en Cloud Run**. `chat_enabled` sigue siendo `false` por
defecto en todos los entornos; Airflow continúa desactivado.

En `room-designer-508414` (dev) existe el secreto
`room-designer-dev-gemini-api-key`, versión `1`, habilitada. Su clave está
restringida a `generativelanguage.googleapis.com`. La API permite listar
modelos, incluido `gemini-3.5-flash`, pero generar una respuesta devuelve
`429 RESOURCE_EXHAUSTED`: **saldo de prepago agotado**. No es un fallo de
autenticación ni se soluciona con retries. No se ha recargado saldo.

La primera clave creada se revocó al comprobar que la herramienta de Google
había impreso su valor en la salida de creación. La sustituta se transfirió
directamente de Google a Secret Manager sin imprimirla. Nunca se guardan
valores de claves en Git ni en el estado de Terraform.

Stage y prod no tienen claves Gemini provisionadas por este cambio. Cada
entorno debe disponer de su propia clave y de su propio secreto; no copiar
la clave de dev a los demás proyectos.

El bucket de assets de dev estaba vacío. La transferencia del catálogo local
completo de Poly Haven no progresó y se canceló; **el catálogo no está cargado**.

## Diseño y límites explícitos

- El chat y la búsqueda son procesos Python separados, con el editor como
  cliente de `/ws` y `/search`, sin secretos en JavaScript.
- Este primer despliegue usa **tres contenedores en el Cloud Run privado
  existente**, no tres servicios Cloud Run con escalado independiente. Nginx
  comunica con Python por localhost y evita pasar credenciales IAM al navegador.
  Los tres contenedores comparten la identidad de la revisión. Si se requiere
  aislamiento de identidades o escalado independiente, hará falta un gateway
  autenticado entre servicios.
- Se conserva una habitación compartida por entorno: no hay aislamiento
  multiusuario. No conceder acceso anónimo al servicio.
- Firestore conserva el puntero al snapshot vigente y su precondición de
  actualización. GCS guarda snapshots inmutables bajo `designer/rooms/`.
  Un conflicto entre instancias se rechaza; nunca se reintenta una escritura
  sobre una versión diferente. Una respuesta perdida tras publicar se reconoce
  por el identificador del snapshot, sin duplicar la publicación.
- Los snapshots previos quedan disponibles para recuperación. No hay borrado
  automático de historial; revisar crecimiento y definir retención antes de un
  uso prolongado. Para recuperar, inspeccionar un snapshot anterior y cambiar
  el puntero con la precondición del `updateTime` actual, con el chat detenido.
- Las capturas van a GCS. El catálogo se monta en solo lectura y Nginx expone
  únicamente su prefijo `catalog/`, nunca los snapshots.
- La búsqueda cloud inicial es léxica (`hashing`), no CLIP. La selección visual
  y la conversación usan Gemini. Esto mantiene el arranque ligero; no cambia
  el proveedor de búsqueda configurado para el desarrollo local.
- Escala de 0 a 1 instancia, timeout WebSocket de 3600 segundos y límite local
  de 30 mensajes/minuto. Un socket abierto mantiene la instancia activa.
  El límite no es una cuota de gasto global ni sustituye las cuotas de Gemini.

## Activación pendiente

1. Habilitar saldo para Gemini en AI Studio con autorización del propietario.
   Comprobar una generación real, no solo el listado de modelos.
2. Publicar el catálogo completo, con modelos y texturas, en
   `gs://PROJECT-room-designer-ENV-assets/catalog/`. No subir código ni secretos
   por este canal. Los contenedores se construyen exclusivamente desde CI.
3. Fijar en el entorno `chat_enabled = true`, `gemini_secret_version = "1"`
   y `designer_allowed_origins` con las direcciones HTTPS exactas del editor.
4. Integrar por PR en `dev`. CI prueba, construye frontend/backend, obtiene
   ambos digests y aplica el plan sin borrados. No saltarse las protecciones.
5. Verificar por acceso IAM autorizado: HTML/JS, catálogo, búsqueda, WebSocket,
   conversación real, colocación de un mueble, captura y reanudación del estado.
   El smoke automático comprueba configuración y servicios sin consumir IA;
   no demuestra por sí solo que exista saldo para Gemini.
6. Promover a stage/prod solo después de su configuración y validación propia.

## Rotación

Crear otra clave restringida en el proyecto del entorno, añadirla como nueva
versión del mismo secreto y cambiar `gemini_secret_version` en una revisión
probada. Comprobar una respuesta y retirar después la clave y la versión
anteriores. Añadir una versión a Secret Manager **no actualiza** la clave en
las instancias ya iniciadas: el despliegue fija una versión numérica.

## Desarrollo local y contenedores

Sin `DESIGNER_STATE_PROJECT`/`DESIGNER_STATE_BUCKET`, el backend conserva el
repositorio local con backups. Con uno solo de esos valores el arranque falla:
no se permite caer silenciosamente a almacenamiento efímero.

Las imágenes Python ya no incluyen `public/catalog`, que está excluido de Git.
Al ejecutarlas localmente hay que montar el catálogo en `/app/public/catalog`.
La imagen del diseñador también contiene el ejecutable `search-serve` que CI
utiliza para el contenedor de búsqueda léxica.
