# Airflow para el catálogo

## Estado y alcance

Implementación preparada y probada localmente. **No está desplegada en GCP**:
el usuario ya autorizó el acceso de Cloud Shell y la puesta en marcha de dev.
RD-008 permanece en progreso hasta comprobar el despliegue real. La continuación
usa exclusivamente el código del repositorio y CI/CD; no requiere subir archivos
manualmente a Cloud Shell. El repositorio ya es privado y conserva PR obligatorio
y la puerta de calidad en dev. El acceso de lectura a GCP está verificado.
El destinatario de avisos se configura mediante `AIRFLOW_ALERT_EMAIL`; no concede
permisos de administración ni se utiliza para autenticar el panel.

Airflow ejecuta el CLI existente sobre almacenamiento persistente compartido:

```text
sklum:     ingest → generate → judge → publish ─┐
polyhaven: ingest ──────────────────→ publish ─┼→ sync → verify → eval
sketchfab: ingest ──────────────────→ publish ─┘
```

Se incluyen solo los catálogos configurados. La sincronización actualiza el
índice del catálogo activo. `publish --no-sync` evita sincronizaciones ocultas;
`sync --verify` consulta sin escribir y compara el número de productos únicos.
Esa comprobación no demuestra igualdad de contenido o embeddings. La evaluación
mantiene el umbral de calidad existente; una evaluación mala hace fallar el DAG.

Este nodo no implementa los adaptadores pendientes de GCS, Firestore o Pub/Sub,
ni publica automáticamente su catálogo en el editor estático de Cloud Run.
`enable_catalog_runtime=false` continúa bloqueando el otro planificador cloud.
Conectar la salida del catálogo con la aplicación desplegada sigue pendiente.

## Arquitectura y coste

Una VM `rd-dev-airflow`, `e2-standard-2` (2 vCPU, 8 GiB), en `europe-west1-b`:

- Airflow 3.3.1, LocalExecutor, API, scheduler y procesador de DAGs separados.
- PostgreSQL 16 y búsqueda privados en la misma red de Docker.
- Disco de arranque de 20 GB y disco persistente de datos de 50 GB, `pd-balanced`.
- Disco de datos protegido contra borrado; snapshots diarios con retención de 7 días.
- Bucket privado de copias lógicas con política de borrado a los 14 días.
- VM con OS Login, Shielded VM y cuenta de servicio propia. SSH solo desde IAP.
- IP externa para tráfico saliente; sin reglas que publiquen HTTP ni PostgreSQL.
  El panel escucha exclusivamente en `127.0.0.1:8080`.
- Cuenta de runtime con escritura de métricas/logs, lectura de imágenes y creación/
  lectura de objetos en su bucket de copias. No tiene Owner ni Editor.

El servicio está diseñado para un operador de confianza que accede por IAP/SSH.
El SimpleAuth de Airflow no sustituye el control de acceso externo. Antes de
exponerlo a varios usuarios o a Internet se debe integrar un gestor de identidad
apropiado. Hay interrupción durante una actualización y no hay alta disponibilidad.

**Activar inicialmente solo dev.** El presupuesto existente de 100 EUR/mes es
conjunto para todos los proyectos y servicios. Esta configuración no impone un
límite automático de gasto a Compute Engine. Antes del primer `apply`, verificar
la estimación regional: 730 horas de VM e IP, 70 GB de discos, snapshots, copias,
Artifact Registry, Cloud Build, logs y tráfico, sumados al consumo restante.
Tarifas consultadas el 12 de septiembre de 2026 mediante Cloud Billing Catalog
API, región `europe-west1`, moneda EUR: VM 46,18 EUR/mes a 730 horas y discos
6,01 EUR/mes. IPv4 supone aproximadamente 3,13 EUR/mes al tipo de conversión
devuelto por la API (0,8582 EUR/USD). La base es **55,32 EUR/mes**, antes de copias,
construcciones, imágenes, logs, tráfico e impuestos aplicables.

Los snapshots cuestan 0,04291 EUR/GiB-mes: almacenar 50 GiB supone 2,15 EUR;
350 GiB supone 15,02 EUR. Es una sensibilidad al volumen almacenado, no una
promesa del volumen que generará la retención. Reservar 25 EUR/mes adicionales
para copias y consumo variable deja una previsión de unos 80,32 EUR/mes; ese
importe es una asignación de presupuesto, no una tarifa fija ni un límite técnico.
La consola mostraba 0 EUR de consumo conjunto, sin créditos usados, sobre
100 EUR; puede haber retraso de contabilización. No multiplicar la VM por tres
entornos ni dar por garantizado el presupuesto. Los límites de Cloud Run
(20/20/60 EUR) no limitan esta VM. Los proveedores de IA se facturan aparte.

Se fijan las imágenes base por digest. El CLI y sus dependencias viven en
`/opt/catalog`, separados del entorno Python de Airflow.

## Primera entrega

Requiere completar la entrega base descrita en `../../docs/CI-CD.md`: revisión
publicada, ramas protegidas, bootstrap, WIF y GitHub Environment. No se debe
subir el árbol local con cambios ajenos sin preparar la revisión correspondiente.

1. Autorizar el acceso a GCP para configurar el proyecto dev
   `room-designer-508414`. Revisar el presupuesto regional antes de aprovisionar.
2. Aplicar el bootstrap de dev con `-var=enable_airflow=true`, conservando su
   fichero de estado existente. Esto añade Compute, IAP y Monitoring y sus
   permisos de despliegue; no activarlo en stage/prod por defecto.
3. Configurar las variables del GitHub Environment `dev`:
   `AIRFLOW_ENABLED=true`, `AIRFLOW_ALERT_EMAIL` con el destinatario acordado y el
   `GCP_WIF_PROVIDER` generado por el bootstrap.
4. Integrar la revisión mediante PR en `dev`. Tras la puerta de calidad y la
   entrega base, `ops/airflow_delivery.py` ejecuta Cloud Build, prueba el DAG sin
   red y el CLI, obtiene el digest y aplica el plan guardado de OpenTofu.
   Se rechaza un plan que borre o reemplace recursos.
5. La entrega comprueba servicios saludables, imagen ejecutada y copia inicial.
   Verificar en GCP una alerta controlada y su recepción antes de darla por activa.

El estado de infraestructura de Airflow se guarda en
`gs://room-designer-508414-tfstate/environments/dev/airflow`, separado de la app.
El despliegue cloud completo, los permisos efectivos de runtime, la instalación
del Ops Agent y la recepción del correo aún necesitan su primera prueba real.

## Acceso y operación

El operador necesita permisos de IAP y OS Login adecuados; usar el correo de
alertas no los concede. Desde un equipo con gcloud autorizado:

```bash
gcloud compute ssh rd-dev-airflow --project=room-designer-508414 \
  --zone=europe-west1-b --tunnel-through-iap -- -N -L 8080:127.0.0.1:8080
```

Abrir `http://localhost:8080`. El usuario es `operator`. Su contraseña aleatoria
reside en `/srv/airflow/state/secrets/users.json`; consultarla únicamente en una
sesión SSH autorizada con `sudo`. No copiarla a Git, al chat ni a logs de CI.
No hace falta una cuenta externa de Apache Airflow.

En el host, los comandos administrativos se ejecutan en un shell root:

```bash
sudo -i
set -a
source /opt/airflow-host/runtime.env
set +a
compose() { docker compose -p catalog-airflow -f /opt/airflow-host/compose.yaml "$@"; }
compose ps
python3 /opt/airflow-host/host.py health
python3 /opt/airflow-host/host.py release
python3 /opt/airflow-host/host.py backup
```

El DAG nace pausado, sin catchup. Configuración inicial: `CATALOG_SITE=polyhaven`,
`CATALOG_SITES=polyhaven`, embeddings `hashing`, horario 04:00 Europe/Madrid.
Límites: una ejecución y una tarea simultáneas, 20 productos por ingesta,
5 generaciones por catálogo generado, 2 reintentos separados 10 minutos,
2 horas por tarea y 12 horas por ejecución. Los límites por ejecución no son
un presupuesto mensual ni garantizan idempotencia de los proveedores de pago.

Para el primer ensayo real, dejar la planificación pausada y lanzar una ejecución
manual desde el panel; comprobar catálogo, calidad y alertas antes de activarla.
El pequeño catálogo y los embeddings iniciales pueden no superar la evaluación:
se debe corregir el proveedor o el conjunto de datos, sin rebajar el umbral.

Las claves `postgres`, `database_uri`, `fernet`, `jwt`, `search_token` y
`users.json` se generan una vez en `state/secrets` con permisos restringidos.
Los contenedores leen secretos mediante ficheros; el panel solo necesita escritura
en su fichero de usuarios. La clave opcional `tripo` permite al wrapper llamar
al generador; `jina` permite los embeddings de ese proveedor. No se han copiado
claves personales ni activado esos proveedores. Sklum requiere revisar generación
y un juez configurado: no se debe tratar un juez vacío como validación visual.

Cambiar la selección y proveedor en `/opt/airflow-host/runtime.env`; la entrega
conserva esos valores y el estado anterior de pausa. Una actualización pausa el
DAG, rechaza ejecuciones queued/running y toma una copia antes de detenerlo.
El fichero `release-pause.json` conserva la pausa original si se interrumpe.
Una entrega fallida necesita diagnóstico y reejecución; no revierte migraciones
ni datos automáticamente. Evitar ejecutar el script de arranque manualmente
mientras hay una entrega en marcha.

## Alertas y mantenimiento

El callback de fallo de tarea escribe identificadores operativos, sin serializar
credenciales. Un timer comprueba cada minuto metastore, scheduler, procesador de
DAGs y ocupación del disco; más del 85 % produce ERROR. Cloud Monitoring observa
estos errores y la ausencia de latidos durante 10 minutos. Si el agente nunca
ha enviado un primer latido, no se debe asumir que la alerta de ausencia ya está
operativa: comprobarla en la puesta en marcha.

La copia lógica se ejecuta diariamente a las 01:00 UTC; el snapshot a las 02:00 UTC.
Los fallos de copia generan ERROR. Docker rota sus logs (3 × 10 MB por contenedor)
y logrotate conserva hasta 14 rotaciones de los eventos del host. Los logs de
tareas y catálogos necesitan mantenimiento según ocupación; no se borran activos
ni ejecuciones del usuario automáticamente. La alerta de capacidad no libera
espacio por sí sola. Revisar retención con el uso real del catálogo.

## Copias y restauración

`host.py backup` ejecuta `pg_dump -Fc`, verifica el volcado con `pg_restore --list`,
empaqueta metadatos y claves en un ZIP y exige que coincida el MD5 devuelto por
GCS antes de escribir `backups/latest-success.json`. El bucket usa cifrado de GCS
y acceso privado; el ZIP contiene secretos y no debe distribuirse. La política
lógica de 14 días convive con versionado/borrado recuperable de GCS, que pueden
prolongar el almacenamiento facturado. El snapshot conserva los ficheros del
catálogo y la búsqueda, pero no reemplaza el volcado coherente de PostgreSQL.

Restaurar primero en un destino aislado. No sobrescribir el estado vivo:

1. Recuperar el disco persistente o crear otro desde un snapshot. Mantener el
   original protegido. Montarlo y confirmar el sistema de ficheros antes de usarlo.
2. Descargar una copia desde el bucket a una carpeta privada. Usar
   `read_backup()` de `host.py` para validar entradas y CRC antes de escribir
   ficheros; extraer solo el diccionario devuelto, con permisos restrictivos.
3. Restaurar las claves, especialmente `fernet`, junto al dump. Sin la clave
   original no se podrán descifrar variables y conexiones de Airflow.
4. En un destino con **base de datos vacía**, arrancar solo PostgreSQL y ejecutar:

   ```bash
   compose up -d --wait postgres
   compose exec -T postgres pg_restore -U airflow --exit-on-error -d airflow < metadata.dump
   compose run --rm migrate
   compose up -d --wait --wait-timeout 240
   ```

5. Comprobar una variable cifrada, pausa, salud y consistencia del catálogo antes
   de reanudar. Comparar fechas de copia y snapshot: no constituyen una transacción
   conjunta. La recuperación exacta de una generación remota depende del proveedor.

La prueba local restaura un dump real en otra base vacía, descifra una variable
con la clave recuperada y recrea todos los contenedores conservando catálogo y
metadatos. No se ha ensayado todavía restaurar una VM desde snapshots de GCP ni
medido RTO/RPO en ese entorno.

## Validación reproducible

```bash
npm run test:all && npm run typecheck && npm run lint:backend
.venv/bin/ruff check deploy/airflow ops/airflow_delivery.py
tofu -chdir=infra/airflow init -backend=false
tofu -chdir=infra/airflow validate
tofu -chdir=infra/airflow test
docker build -t room-designer-airflow:local -f deploy/airflow/Dockerfile .
docker run --rm --network none -e AIRFLOW_HOME=/tmp/airflow \
  -e AIRFLOW__CORE__DAGS_FOLDER=/opt/airflow/dags --entrypoint python \
  room-designer-airflow:local /opt/designer/deploy/airflow/smoke_dag.py
```

Los escenarios están en `specs/features/catalog-orchestration.feature`; se
observaron fallos antes de implementar las reglas. El smoke usa Airflow real y
CLI fake sin red: verifica bloqueo por fallo y una segunda ejecución correcta.
Las pruebas del backend cubren el CLI aparte. Esto no acredita una ingesta real
ni llamadas pagadas a Tripo. La imagen local se ha probado en ARM64; Cloud Build
construye y prueba AMD64 antes de permitir su despliegue en la VM.

Referencias: [versiones soportadas de Airflow](https://airflow.apache.org/docs/apache-airflow/stable/installation/supported-versions.html),
[despliegue en producción](https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/production-deployment.html),
[SimpleAuth](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/auth-manager/simple/index.html),
[precios de Compute Engine](https://cloud.google.com/products/compute/pricing/general-purpose),
[Cloud Billing Catalog API](https://cloud.google.com/billing/docs/how-to/catalog-api),
[IPv4 y red](https://cloud.google.com/vpc/network-pricing).
