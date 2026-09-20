#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--bootstrap] <sql-file>" >&2
  echo "Set DATABASE_URL, or DB_CONTAINER with optional DB_USER and DB_NAME." >&2
}

bootstrap=false
if [[ "${1:-}" == "--bootstrap" ]]; then
  bootstrap=true
  shift
fi
if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sql_file="$(realpath "$1")"
schema_file="$(realpath "$repo_root/src/db/schema.sql")"

if [[ ! -f "$sql_file" || "$sql_file" != "$repo_root"/* ]]; then
  echo "Refusing SQL outside the expense-api repository: $sql_file" >&2
  exit 2
fi
if [[ "$sql_file" == "$schema_file" && "$bootstrap" != true ]]; then
  echo "Refusing to replay schema.sql on an existing database; use a reviewed additive SQL file." >&2
  exit 2
fi
if [[ "$sql_file" != "$schema_file" && "$bootstrap" == true ]]; then
  echo "--bootstrap is only valid with src/db/schema.sql" >&2
  exit 2
fi

db_user="${DB_USER:-postgres}"
db_name="${DB_NAME:-postgres}"

query_scalar() {
  local statement="$1"
  if [[ -n "${DB_CONTAINER:-}" ]]; then
    docker exec "$DB_CONTAINER" psql -X -U "$db_user" -d "$db_name" -tAc "$statement"
  else
    : "${DATABASE_URL:?Set DATABASE_URL or DB_CONTAINER}"
    psql -X "$DATABASE_URL" -tAc "$statement"
  fi
}

if [[ "$bootstrap" == true ]]; then
  table_count="$(query_scalar "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'")"
  if [[ "$table_count" != "0" ]]; then
    echo "Refusing bootstrap: target database already has $table_count public table(s)." >&2
    exit 1
  fi
fi

if [[ -n "${DB_CONTAINER:-}" ]]; then
  docker exec -i "$DB_CONTAINER" \
    psql -X -v ON_ERROR_STOP=1 --single-transaction -U "$db_user" -d "$db_name" < "$sql_file"
else
  : "${DATABASE_URL:?Set DATABASE_URL or DB_CONTAINER}"
  psql -X -v ON_ERROR_STOP=1 --single-transaction "$DATABASE_URL" -f "$sql_file"
fi

echo "Applied $(realpath --relative-to="$repo_root" "$sql_file") successfully."
