#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="${CRM_ENV_FILE:-$ROOT_DIR/.env}"

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is required but was not found in PATH" >&2
  echo "install PostgreSQL client tools, then retry" >&2
  exit 127
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "error: environment file not found: $ENV_FILE" >&2
  echo "set CRM_ENV_FILE=/path/to/.env or create $ROOT_DIR/.env" >&2
  exit 2
fi

DATABASE_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -n 1)"
DATABASE_URL="$(printf '%s' "$DATABASE_URL" | sed 's/^"//; s/"$//; s/^'\''//; s/'\''$//')"

if [ -z "$DATABASE_URL" ]; then
  echo "error: DATABASE_URL is missing from $ENV_FILE" >&2
  exit 3
fi

case "$DATABASE_URL" in
  postgresql://*|postgres://*) ;;
  *)
    echo "error: DATABASE_URL is not a PostgreSQL connection string" >&2
    exit 4
    ;;
esac

usage() {
  cat <<'EOF'
Usage:
  scripts/neon-direct.sh health
  scripts/neon-direct.sh sql "SELECT now();"
  scripts/neon-direct.sh file path/to/query.sql
  scripts/neon-direct.sh psql [psql arguments...]

Environment:
  CRM_ENV_FILE=/path/to/.env   Override the root .env file.

Notes:
  - The script never prints DATABASE_URL.
  - All connections use the existing CRM DATABASE_URL directly.
  - Use read-only SQL for diagnostics unless a write has been explicitly approved.
EOF
}

cmd="${1:-}"
case "$cmd" in
  health)
    exec psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off       -c "SELECT current_database() AS database_name, current_user AS database_user, now() AS checked_at;"
    ;;
  sql)
    shift
    [ "$#" -gt 0 ] || { usage >&2; exit 64; }
    exec psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off -c "$*"
    ;;
  file)
    shift
    [ "$#" -eq 1 ] || { usage >&2; exit 64; }
    exec psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off -f "$1"
    ;;
  psql)
    shift
    exec psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 "$@"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "error: unknown command: $cmd" >&2
    usage >&2
    exit 64
    ;;
esac
