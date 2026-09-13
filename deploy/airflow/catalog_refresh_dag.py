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
    # Un sub-pipeline por catálogo. Las tiendas scrapeadas (jsonld) pasan por
    # generación 3D + juez; las bibliotecas 3D (polyhaven, sketchfab) traen el
    # modelo hecho y van directas de ingesta a publicación. El índice de
    # embeddings solo se sincroniza para el catálogo ACTIVO (CATALOG_SITE en
    # el entorno de los workers): link/searchSync ya lo respetan por sí solos.
    SITES = {
        "sklum": {"generated_3d": True},
        "polyhaven": {"generated_3d": False},
        "sketchfab": {"generated_3d": False},  # GLB requiere SKETCHFAB_API_TOKEN
    }

    sync_embeddings = BashOperator(
        task_id="sync_embeddings",
        bash_command=f"cd {REPO_DIR} && catalog sync",
        retries=3,  # es la tarea más barata de reintentar y la más importante
        retry_delay=timedelta(minutes=5),
    )

    verify_consistency = BashOperator(
        task_id="verify_consistency",
        bash_command=f"cd {REPO_DIR} && catalog sync --verify",
    )

    eval_search_quality = BashOperator(
        task_id="eval_search_quality",
        bash_command=f"cd {REPO_DIR} && catalog eval",
    )

    for site, options in SITES.items():
        ingest = BashOperator(
            task_id=f"ingest_{site}",
            bash_command=f"cd {REPO_DIR} && catalog ingest --site {site}",
            execution_timeout=timedelta(hours=4),  # bibliotecas 3D: descarga completa
        )

        publish_catalog = BashOperator(
            task_id=f"publish_catalog_{site}",
            bash_command=f"cd {REPO_DIR} && catalog link --site {site}",
        )

        if options["generated_3d"]:
            generate = BashOperator(
                task_id=f"generate_{site}",
                bash_command=f"cd {REPO_DIR} && catalog generate --site {site}",
                execution_timeout=timedelta(hours=4),
            )
            judge = BashOperator(
                task_id=f"judge_{site}",
                bash_command=f"cd {REPO_DIR} && catalog judge --site {site}",
            )
            ingest >> generate >> judge >> publish_catalog
        else:
            ingest >> publish_catalog

        publish_catalog >> sync_embeddings

    sync_embeddings >> verify_consistency >> eval_search_quality
