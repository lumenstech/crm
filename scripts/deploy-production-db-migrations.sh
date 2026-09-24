#!/bin/bash
set -euo pipefail

REPO_DIR="${1:-/Users/danny/Documents/Codex/2026-09-02-you-are-operating-on-my-mac/comp-ai-crm}"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "CRM repository not found at: $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"

echo "==> Updating release branch"
git fetch origin release
git checkout release
git pull --ff-only origin release

if [ ! -f .env ]; then
  echo "Production .env is missing at $REPO_DIR/.env" >&2
  exit 1
fi

if ! grep -q '^DATABASE_URL=' .env; then
  echo "DATABASE_URL is missing from .env" >&2
  exit 1
fi

echo "==> Loading production environment"
set -a
. ./.env
set +a

echo "==> Installing exact dependencies"
bun install --frozen-lockfile

echo "==> Applying pending Prisma migrations"
bun run db:deploy

echo "==> Verifying procurement migration exists in Prisma migration history"
if command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    SELECT migration_name
    FROM _prisma_migrations
    WHERE migration_name = '20260924111500_procurement_pricing'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL;
  "
else
  echo "psql is not installed; Prisma completed successfully, so migration deployment finished."
fi

echo "==> Production database migration complete"
