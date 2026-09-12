FROM apache/airflow:3.3.1-python3.12@sha256:b01a795dfbd113bbbfdf3ee169b8f27e9a0090ccef105f1a452b3594a11ed316
USER root
WORKDIR /opt/designer
COPY pyproject.toml requirements.lock ./
COPY backend/room_designer ./backend/room_designer
# ADK y el catálogo tienen su propio entorno para no alterar dependencias de Airflow.
RUN python -m venv /opt/catalog && /opt/catalog/bin/pip install --no-cache-dir -c requirements.lock .
COPY services/search/eval ./services/search/eval
COPY deploy/airflow ./deploy/airflow
COPY deploy/airflow/catalog_refresh_dag.py /opt/airflow/dags/catalog_refresh_dag.py
RUN chmod 755 /opt/designer/deploy/airflow/catalog-job.sh
ARG COMMIT_SHA=local
LABEL org.opencontainers.image.revision=$COMMIT_SHA
USER airflow
