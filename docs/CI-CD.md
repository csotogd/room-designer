# Entrega por ramas con Google Cloud Build

`PR → CI → merge en dev/stage/prod → Cloud Build del proyecto → pruebas del contenedor → digest → OpenTofu → smoke cloud`

## Estado real

Los tres proyectos GCP, las ramas y los GitHub Environments ya existen. Las
ramas exigen PR, conversaciones resueltas y **Puerta de calidad**, incluso a
administradores. Cada Environment solo acepta su rama homónima. No se exige un
segundo revisor al trabajar una sola persona. `main` no despliega; sus reglas
anteriores no se han modificado. El repositorio de GitHub es privado.

**Activo y validado en dev, stage y prod para el editor y la base cloud.**
Las tres últimas entregas han terminado en `SUCCESS`, incluidos los smoke tests
reales. Se ha promovido el mismo árbol de código entre las tres ramas:
`31c62fde2d8a06f99f801164b32e23f914afb75b`.

El [PR #2](https://github.com/csotogd/room-designer/pull/2)
está integrado en dev tras superar todas las puertas, incluida mutación. Con
autorización explícita de sus permisos privilegiados, se ha aplicado el bootstrap
en los tres proyectos: 37 altas por entorno y ningún borrado. Los tres Environments
ya tienen su proveedor WIF registrado. La autenticación de GitHub, Cloud Build y
el apply de dev han funcionado: build `147d8973-f6d8-4ae7-90b6-8225f475e270`
en `SUCCESS`. La comprobación final falló al solicitar un ID token mediante
impersonación del CLI. El [PR #4](https://github.com/csotogd/room-designer/pull/4)
corrige ese paso mediante IAM Credentials y el permiso OIDC ya concedido, sin
ampliar IAM ni abrir el editor al público. Sus tests de aceptación y unitarios se
observaron en rojo antes del cambio y ahora pasan. Se integró con todas las puertas
verdes a las 17:11 UTC del 12 de septiembre. La [entrega corregida de dev](https://github.com/csotogd/room-designer/actions/runs/34707488572)
terminó completamente en `SUCCESS` a las 17:33 UTC, incluidos el editor privado
y los round-trips de Storage, Firestore y Pub/Sub. Cloud Build:
`33554906-ba56-47d2-9b8e-4f594c667833`; digest desplegado:
`sha256:fb60a2fcaa44c912896284026d0ab8d6a77adf9b4e3b882b7bbaa8bec7677b34`.

El 13 de septiembre se integró el [PR #3 hacia stage](https://github.com/csotogd/room-designer/pull/3)
con CI y dev en verde. Su [primera entrega](https://github.com/csotogd/room-designer/actions/runs/34748958885)
ha terminado completamente en `SUCCESS`, incluido el smoke cloud. Cloud Build:
`7ef7dd35-92d6-47dd-b656-b5ab7625506b`; digest desplegado:
`sha256:ce249d76dc6b706623ce211b266f881943f30aa8c43635d3f15357872a5f1350`.
El apply creó 20 recursos, sin cambios ni borrados. El [PR #6 hacia prod](https://github.com/csotogd/room-designer/pull/6)
tiene todas sus puertas verdes y quedó integrado a las 09:34 UTC del 13 de
septiembre, tras confirmar en Chrome la fusión afectada por un 502 de la API.
Commit: `30b020950e02812f68c07d69e910b8510ac0a4e6`. La [entrega de producción](https://github.com/csotogd/room-designer/actions/runs/34749760116)
terminó completamente en `SUCCESS` el 13 de septiembre, incluidos el editor
privado y los round-trips de los servicios de datos. Cloud Build:
`2805a4f5-202f-4f8c-8086-ba9a57444eb2`; digest desplegado:
`sha256:a5323b2936049e03bfc2f7aa3111e2d98575466a72471cb91442ff80c5d9a7c8`.
El apply creó 20 recursos, sin cambios ni borrados.

URLs privadas verificadas (requieren autenticación, no basta abrirlas sin token):

- Dev: `https://room-designer-dev-frontend-cfcrxopemq-ew.a.run.app`.
- Stage: `https://room-designer-stage-frontend-5duyqaaioa-ew.a.run.app`.
- Prod: `https://room-designer-prod-frontend-4vn2x5jgtq-ew.a.run.app`.

| Entorno | Proyecto GCP | Estado remoto de la aplicación |
|---|---|---|
| `dev` | `room-designer-508414` | `gs://room-designer-508414-tfstate/environments/dev` |
| `stage` | `room-designer-stage` | `gs://room-designer-stage-tfstate/environments/stage` |
| `prod` | `room-designer-prod` | `gs://room-designer-prod-tfstate/environments/prod` |

El mapa está en `infra/environments.json`; los parámetros, en
`infra/gcp/environments/`. No se copian datos, credenciales ni estado entre entornos.

## Puertas de entrega

GitHub ejecuta ruff, pytest, typecheck, Vitest con cobertura, integración TS/Python
con proveedores fake, cobertura Gherkin, build web, Stryker, actionlint y
`tofu fmt/validate/test`. Una comprobación fallida, cancelada u omitida bloquea
la entrega. Se conservan los umbrales anteriores.

Después del merge, GitHub invoca **`gcloud builds submit` en el proyecto del
entorno**, con `cloudbuild.yaml`. No se añade otro trigger conectado a GitHub:
duplicaría las ejecuciones. Cloud Build construye el editor para Linux AMD64,
lo arranca y comprueba HTML, JavaScript y SHA servido. También construye y prueba
el CLI existente del catálogo, sin red. Solo después publica la imagen web.

La CI espera la finalización. `ops/delivery.py` exige `SUCCESS`, el commit,
nombre de imagen y digest SHA256 esperados. Cloud Run recibe **esa misma imagen**,
sin reconstruir ni usar `latest`. Un plan con borrado o reemplazo se bloquea para
revisión manual. Se aplica el plan guardado, con bloqueo de estado. Los despliegues
del mismo entorno no se cancelan entre sí. GitHub puede sustituir ejecuciones
pendientes por otras nuevas: no garantiza desplegar todos los commits intermedios.

## Identidades

`infra/bootstrap` prepara APIs, Artifact Registry, bucket privado de fuentes,
estado versionado y dos identidades en cada proyecto:

- `rd-<env>-build`: lee fuentes, publica imágenes en su repositorio y escribe logs.
  No administra Cloud Run, IAM ni los datos de la aplicación.
- `rd-<env>-deploy`: lanza Cloud Build y administra la infraestructura del proyecto.
  Es una identidad privilegiada: incluye administración de IAM y de recursos,
  aunque no los roles básicos Owner/Editor. Nunca se entrega a PR.

WIF/OIDC restringe por IDs numéricos del repositorio y propietario, evento `push`,
rama, Environment y workflow. No se crean claves JSON. El runtime tiene sus
propias cuentas separadas de build y despliegue.

## Activación inicial

La alerta global ya está guardada para los tres proyectos y todos los servicios,
incluido Cloud Build: **100 EUR mensuales conjuntos** y 20 avisos del 5 al 100 %.
El supuesto máximo anterior de 17 umbrales era incorrecto. El presupuesto alerta,
no garantiza un techo. Con aprobación explícita se han guardado y verificado
los límites automáticos de Cloud Run: **20 EUR dev, 20 EUR stage y 60 EUR prod**.
Google restringe cada límite a un solo proyecto y servicio. Estos límites no
detienen Cloud Build, Storage, Pub/Sub, Firestore ni proveedores externos de IA;
su aplicación tampoco es instantánea y pueden existir excedentes facturables.

Desde un checkout limpio con OpenTofu y credenciales personales autorizadas
(ADC o Cloud Shell), empezar por `dev`:

```bash
mkdir -p .bootstrap-state
tofu -chdir=infra/bootstrap init -reconfigure \
  -backend-config=path=../../.bootstrap-state/dev.tfstate
tofu -chdir=infra/bootstrap plan \
  -var=environment=dev -var=project_id=room-designer-508414 -out=bootstrap.tfplan
# Revisar el plan antes de aplicarlo.
tofu -chdir=infra/bootstrap apply bootstrap.tfplan
tofu -chdir=infra/bootstrap output -raw workload_identity_provider
```

Guardar el último valor como variable `GCP_WIF_PROVIDER` del Environment `dev`
en GitHub. No es una clave secreta. Repetir para `stage` y `prod` con sus proyectos
y ficheros de estado distintos. Conservar una copia privada del bootstrap; nunca
versionarlo ni reutilizarlo entre entornos. El estado de aplicación reside en GCS.
La activación conserva copias privadas del bootstrap bajo
`gs://<project_id>-tfstate/bootstrap/<environment>.tfstate`. Recuperar el estado
correspondiente antes de volver a aplicar; no iniciar un bootstrap vacío sobre
recursos existentes.

Publicar esta configuración mediante PR. La primera integración en `dev` crea
el editor y la base cloud. Promover por PR de `dev` a `stage` y de `stage` a `prod`;
cada merge repite CI y Cloud Build en el proyecto correspondiente. No activar WIF
sin verificar antes las protecciones de ramas.

El editor permanece privado, con mínimo cero y máximo una instancia. Para verlo
con una sesión autorizada, usar `gcloud run services proxy` sobre el servicio
`room-designer-dev-frontend`, proyecto `room-designer-508414`, región `europe-west1`.
Habilitar acceso anónimo queda fuera de esta configuración.

## Validación real y limitaciones

`ops/cloud_smoke.py` verifica revisión lista, digest, SHA, HTML/JS, recursos e
identidades, y round-trips de GCS, Firestore y Pub/Sub. Usa objetos, documentos y
colas efímeras con limpieza incluso al fallar. Nunca publica en la cola del
generador 3D. GCS puede conservar versiones bajo sus políticas de retención.

Estos probes usan la identidad de entrega: **no prueban los permisos efectivos
de cada runtime**. Secret Manager se comprueba solo a nivel de definición, sin
leer claves ni inventar versiones vacías. Un fallo marca la entrega en rojo; no
revierte automáticamente datos o IAM. Para revertir código, crear un PR de
reversión y pasar otra vez todas las puertas.

Prueba manual en Chrome del 12 de septiembre, 17:18 UTC: el editor de dev carga
mediante `gcloud run services proxy` y la vista previa autenticada de Cloud Shell.
Responden el cambio 3D/plano 2D y la apertura/cierre del formulario de nueva
habitación. Se dejó la vista inicial restaurada, sin guardar datos ni invocar IA.
La política IAM del servicio no contiene acceso anónimo. Esta prueba complementa,
pero no sustituye, la comprobación automática de la entrega corregida.

El catálogo cloud sigue necesitando `serve-generator`, adaptadores de GCS,
Firestore y Pub/Sub, idempotencia, IAM de DLQ/push y versiones reales de secretos.
`enable_catalog_runtime` se mantiene en `false` y la validación rechaza `true`:
no se crean todavía
el generador HTTP, el job ni los cron de pago. Su imagen se prueba como CLI,
no como servicio cloud. Tampoco se despliegan aquí los backends de búsqueda e IA.
La orquestación se sigue en RD-008, pendiente de decidir entre Airflow permanente
y una alternativa por ejecución; esta entrega no la activa ni añade un segundo
disparador del catálogo.

La primera entrega habilita **editor estático y recursos base**, no un catálogo/IA
terminado. RD-005 y RD-006 cierran el alcance de configuración GCP y entrega de
esa base, validado en los tres entornos. Los runtimes del catálogo/IA, sus secretos,
permisos efectivos y orquestación continúan pendientes y no se dan por probados.
La guía y el tablero locales conservan la evidencia posterior a los merges.

Referencias: [configuración de Cloud Build](https://docs.cloud.google.com/build/docs/build-config-file-schema),
[cuentas de servicio propias](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts),
[WIF para pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines),
[presupuestos y alertas](https://docs.cloud.google.com/billing/docs/how-to/budgets).
