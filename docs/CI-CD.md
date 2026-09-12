# Entrega por ramas con Google Cloud Build

`PR → CI → merge en dev/stage/prod → Cloud Build del proyecto → pruebas del contenedor → digest → OpenTofu → smoke cloud`

## Estado real

Los tres proyectos GCP, las ramas y los GitHub Environments ya existen. Las
ramas exigen PR, conversaciones resueltas y **Puerta de calidad**, incluso a
administradores. Cada Environment solo acepta su rama homónima. No se exige un
segundo revisor al trabajar una sola persona. `main` no despliega; sus reglas
anteriores no se han modificado.

**La automatización aún no está activada en GCP.** Falta publicar esta revisión,
aplicar el bootstrap, registrar WIF y completar la primera entrega real. Las
pruebas simuladas y locales no equivalen a una verificación en Google Cloud.

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
no garantiza un techo. El límite automático de Cloud Run sigue solo en dev:
antes de activar los demás entornos hay que revisar su cobertura sin multiplicar
los 100 EUR. Ese límite no detiene Cloud Build, Storage, Pub/Sub, Firestore ni
proveedores externos de IA.

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

El catálogo cloud sigue necesitando `serve-generator`, adaptadores de GCS,
Firestore y Pub/Sub, idempotencia, IAM de DLQ/push y versiones reales de secretos.
`enable_catalog_runtime=false` está bloqueado por validación: no se crean todavía
el generador HTTP, el job ni los cron de pago. Su imagen se prueba como CLI,
no como servicio cloud. Tampoco se despliegan aquí los backends de búsqueda e IA.
La orquestación Airflow se prepara en paralelo (RD-008); esta entrega no la activa
ni añade un segundo disparador del catálogo.

La primera entrega habilita **editor estático y recursos base**, no un catálogo/IA
terminado. RD-005 y RD-006 siguen en progreso hasta su activación y validación real.

Referencias: [configuración de Cloud Build](https://docs.cloud.google.com/build/docs/build-config-file-schema),
[cuentas de servicio propias](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts),
[WIF para pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines),
[presupuestos y alertas](https://docs.cloud.google.com/billing/docs/how-to/budgets).
