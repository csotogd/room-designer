#!/bin/bash
# El disco contiene el estado; la imagen inmutable contiene los ejecutables.
set -euo pipefail

mount_data() {
  local disk="$1" destination="$2" filesystem
  mkdir -p "$destination"
  mountpoint -q "$destination" && return 0
  filesystem=$(blkid -s TYPE -o value "$disk" || true)
  case "$filesystem" in
    ext4) ;;
    '')
      [[ "$(lsblk -rno TYPE "$disk")" == disk ]] || { echo 'Disco particionado: montaje rechazado' >&2; return 1; }
      mkfs.ext4 "$disk"
      ;;
    *) echo 'Sistema de archivos desconocido: no se modifica el disco' >&2; return 1 ;;
  esac
  mount "$disk" "$destination"
}

metadata() {
  curl --fail --silent --show-error --retry 5 -H 'Metadata-Flavor: Google' \
    "http://metadata.google.internal/computeMetadata/v1/$1"
}

main() {
  exec 9>/run/catalog-airflow-startup.lock
  flock -w 600 9
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 python3 curl logrotate
  systemctl enable --now docker
  mount_data /dev/disk/by-id/google-airflow-state /srv/airflow
  if ! grep -q '[[:space:]]/srv/airflow[[:space:]]' /etc/fstab; then
    echo '/dev/disk/by-id/google-airflow-state /srv/airflow ext4 defaults,nofail 0 2' >> /etc/fstab
  fi
  mkdir -p /etc/systemd/system/docker.service.d
  cat > /etc/systemd/system/docker.service.d/airflow-state.conf <<'UNIT'
[Unit]
RequiresMountsFor=/srv/airflow
UNIT
  systemctl daemon-reload
  mkdir -p /opt/airflow-host

  local previous_pause=true
  if [[ -f /opt/airflow-host/runtime.env ]]; then
    set -a; source /opt/airflow-host/runtime.env; set +a
    if docker compose -p catalog-airflow -f /opt/airflow-host/compose.yaml ps --services --status running | grep -q '^scheduler$'; then
      previous_pause=$(python3 /opt/airflow-host/host.py remember-pause)
      docker compose -p catalog-airflow -f /opt/airflow-host/compose.yaml exec -T scheduler airflow dags pause catalog_refresh
      if ! python3 /opt/airflow-host/host.py idle || ! python3 /opt/airflow-host/host.py backup; then
        if [[ "$previous_pause" == false ]]; then
          docker compose -p catalog-airflow -f /opt/airflow-host/compose.yaml exec -T scheduler airflow dags unpause catalog_refresh
        fi
        python3 /opt/airflow-host/host.py finish-release
        return 1
      fi
      docker compose -p catalog-airflow -f /opt/airflow-host/compose.yaml stop
    fi
  fi

  local airflow_image copy_id
  airflow_image=$(metadata instance/attributes/airflow-image)
  [[ "$airflow_image" =~ ^europe-west1-docker.pkg.dev/.+@sha256:[a-f0-9]{64}$ ]]
  metadata instance/service-accounts/default/token | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])' | \
    docker login -u oauth2accesstoken --password-stdin https://europe-west1-docker.pkg.dev
  docker pull "$airflow_image"
  docker logout https://europe-west1-docker.pkg.dev
  copy_id=$(docker create --entrypoint true "$airflow_image")
  docker cp "$copy_id:/opt/designer/deploy/airflow/." /opt/airflow-host/
  docker rm "$copy_id"
  export STATE_DIR=/srv/airflow/state AIRFLOW_IMAGE="$airflow_image"
  export BACKUP_BUCKET
  BACKUP_BUCKET=$(metadata instance/attributes/airflow-backup-bucket)
  umask 077
  printf 'STATE_DIR=%q\nAIRFLOW_IMAGE=%q\nBACKUP_BUCKET=%q\n' "$STATE_DIR" "$AIRFLOW_IMAGE" "$BACKUP_BUCKET" > /opt/airflow-host/runtime.env
  printf 'CATALOG_SITE=%q\nCATALOG_SITES=%q\nEMBEDDINGS_PROVIDER=%q\nCATALOG_REFRESH_SCHEDULE=%q\n' \
    "${CATALOG_SITE:-polyhaven}" "${CATALOG_SITES:-polyhaven}" "${EMBEDDINGS_PROVIDER:-hashing}" \
    "${CATALOG_REFRESH_SCHEDULE:-0 4 * * *}" >> /opt/airflow-host/runtime.env
  docker run --rm --network none --user 0:0 --entrypoint python -v "$STATE_DIR:/state" \
    "$AIRFLOW_IMAGE" /opt/designer/deploy/airflow/prepare_state.py /state
  docker compose -p catalog-airflow -f /opt/airflow-host/compose.yaml run --rm migrate
  docker compose -p catalog-airflow -f /opt/airflow-host/compose.yaml up -d --wait --wait-timeout 240

  for operation in health backup; do
    cat > "/etc/systemd/system/catalog-airflow-$operation.service" <<UNIT
[Unit]
Description=Airflow: $operation
After=docker.service
RequiresMountsFor=/srv/airflow
[Service]
Type=oneshot
EnvironmentFile=/opt/airflow-host/runtime.env
ExecStart=/usr/bin/python3 /opt/airflow-host/host.py $operation
UNIT
  done
  cat > /etc/systemd/system/catalog-airflow-health.timer <<'UNIT'
[Unit]
Description=Comprueba Airflow cada minuto
[Timer]
OnBootSec=4min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
UNIT
  cat > /etc/systemd/system/catalog-airflow-backup.timer <<'UNIT'
[Unit]
Description=Copia coherente diaria del metastore y sus claves
[Timer]
OnCalendar=*-*-* 01:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  cat > /etc/logrotate.d/catalog-airflow <<'ROTATE'
/srv/airflow/state/logs/host.jsonl /srv/airflow/state/logs/alerts.jsonl {
  daily
  rotate 14
  size 10M
  missingok
  notifempty
  copytruncate
  su root root
}
ROTATE
  curl --fail --silent --show-error --retry 5 \
    https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh -o /tmp/airflow-ops-agent.sh
  bash /tmp/airflow-ops-agent.sh --also-install
  cat > /etc/google-cloud-ops-agent/config.yaml <<'YAML'
logging:
  receivers:
    airflow:
      type: files
      include_paths: [/srv/airflow/state/logs/host.jsonl, /srv/airflow/state/logs/alerts.jsonl]
  processors:
    json:
      type: parse_json
  service:
    pipelines:
      airflow:
        receivers: [airflow]
        processors: [json]
YAML
  systemctl daemon-reload
  systemctl restart google-cloud-ops-agent
  systemctl enable --now catalog-airflow-health.timer catalog-airflow-backup.timer
  python3 /opt/airflow-host/host.py health
  python3 /opt/airflow-host/host.py backup
  if [[ -f "$STATE_DIR/release-pause.json" ]]; then
    previous_pause=$(python3 /opt/airflow-host/host.py remember-pause)
  fi
  if [[ "$previous_pause" == false ]]; then
    docker compose -p catalog-airflow -f /opt/airflow-host/compose.yaml exec -T scheduler airflow dags unpause catalog_refresh
  fi
  python3 /opt/airflow-host/host.py finish-release
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
