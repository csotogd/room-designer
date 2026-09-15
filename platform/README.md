# Plataforma

Este directorio agrupa cada capacidad operativa completa sin mezclarla con el
dominio ni con la interfaz del editor.

## Airflow

`airflow/` contiene todo lo específico de la orquestación del catálogo:

- `runtime/`: imagen, DAG, composición local, arranque y documentación
  operativa.
- `infra/`: recursos de OpenTofu y sus pruebas.
- `delivery.py`: entrega de la imagen probada y aplicación segura del plan.

La infraestructura base de la aplicación continúa en `infra/gcp` y las
identidades compartidas en `infra/bootstrap`. La automatización de entrega
genérica sigue en `ops/`; no depende de Airflow.
