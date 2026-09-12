#!/bin/sh
set -eu
# Los secretos se leen al ejecutar; nunca se incluyen en el DAG serializado.
secrets_dir="${CATALOG_SECRETS_DIR:-/run/catalog-secrets}"
export SEARCH_SYNC_TOKEN="$(cat "$secrets_dir/search_token")"
if [ -f "$secrets_dir/tripo" ]; then export TRIPO_API_KEY="$(cat "$secrets_dir/tripo")"; fi
if [ -f "$secrets_dir/jina" ]; then export JINA_API_KEY="$(cat "$secrets_dir/jina")"; fi
if [ "$1" = search-serve ]; then
  shift
  exec /opt/catalog/bin/search-serve "$@"
fi
exec /opt/catalog/bin/catalog "$@"
