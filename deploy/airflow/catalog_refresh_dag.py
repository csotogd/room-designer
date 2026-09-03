"""
DAG de Airflow del refresco diario: catálogo + embeddings de búsqueda.

    ingest ─▶ generate ─▶ judge ─▶ publish_catalog ─▶ sync_embeddings ─▶ verify_consistency
                                                                              │
                                                          eval_search_quality ◀┘

La parte que interesa orquestar bien es la de la derecha:

  publish_catalog     escribe public/catalog/index.json — la fuente de verdad
                      de qué productos están "mantenidos" hoy.
  sync_embeddings     empuja la INSTANTÁNEA COMPLETA al servicio de búsqueda:
                      en una sola operación idempotente se crean los
                      embeddings de los productos nuevos, se re-embeben los
                      cambiados (hash de contenido) y se BORRAN los de
                      productos que ya no existen en el catálogo. No hay
                      pasos separados de alta/borrado que puedan divergir:
                      el estado destino es el catálogo entero.
  verify_consistency  puerta de reconciliación: catálogo ≡ índice (mismo nº
                      de productos). Si difieren, la tarea falla y Airflow
                      alerta — nunca deriva silenciosa.
  eval_search_quality evalúa Recall/MRR/NDCG contra el golden set tras cada
                      refresco; si la calidad cae bajo la puerta, falla.

Reintentos seguros en todas las tareas: los CLIs son idempotentes (re-ejecutar
un sync tras un fallo parcial converge al mismo estado). `max_active_runs=1`
evita dos refrescos solapados; el servicio además serializa syncs internos.

Entorno en los workers: SEARCH_URL, SEARCH_SYNC_TOKEN,
CATALOG_PUBLIC_BASE_URL (fotos para el embedder multimodal),
EMBEDDINGS_PROVIDER/JINA_API_KEY para la evaluación.
"""

from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.bash import BashOperator

REPO_DIR = "/opt/designer"  # checkout del repo en la imagen del worker

default_args = {
    "owner": "catalog",
    "retries": 2,
    "retry_delay": timedelta(minutes=10),
}

with DAG(
    dag_id="catalog_refresh",
    description="Scrape diario, generación 3D, publicación y embeddings de búsqueda",
    schedule="0 4 * * *",  # cada día a las 04:00
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=default_args,
    tags=["catalog", "search"],
) as dag:
    ingest = BashOperator(
        task_id="ingest",
        bash_command=f"cd {REPO_DIR} && npm run pipeline:ingest -- --site sklum",
    )

    generate = BashOperator(
        task_id="generate",
        bash_command=f"cd {REPO_DIR} && npm run pipeline:generate -- --site sklum",
        execution_timeout=timedelta(hours=4),
    )

    judge = BashOperator(
        task_id="judge",
        bash_command=f"cd {REPO_DIR} && npm run pipeline:judge -- --site sklum",
    )

    publish_catalog = BashOperator(
        task_id="publish_catalog",
        bash_command=f"cd {REPO_DIR} && npm run pipeline:link -- --site sklum",
    )

    sync_embeddings = BashOperator(
        task_id="sync_embeddings",
        bash_command=f"cd {REPO_DIR} && npm run search:sync",
        retries=3,  # es la tarea más barata de reintentar y la más importante
        retry_delay=timedelta(minutes=5),
    )

    verify_consistency = BashOperator(
        task_id="verify_consistency",
        bash_command=f"cd {REPO_DIR} && npm run search:sync -- --verify",
    )

    eval_search_quality = BashOperator(
        task_id="eval_search_quality",
        bash_command=f"cd {REPO_DIR} && npm run search:eval",
    )

    ingest >> generate >> judge >> publish_catalog >> sync_embeddings >> verify_consistency
    verify_consistency >> eval_search_quality
