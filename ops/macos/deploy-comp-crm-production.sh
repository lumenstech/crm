#!/usr/bin/env bash
set -euo pipefail

SOURCE_REF="${1:-release}"
PROD_DIR="${COMP_CRM_PROD_DIR:-/Users/danny/Documents/Codex/comp-ai-crm-release-migration}"
EXPECTED_HEAD="${EXPECTED_HEAD:-}"

cd "$PROD_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Production worktree is dirty; refusing deployment."
  git status --short
  exit 2
fi

previous_sha="$(git rev-parse HEAD)"
echo "Previous production SHA: $previous_sha"

git fetch --prune origin "$SOURCE_REF"
target_sha="$(git rev-parse FETCH_HEAD)"

if [ -n "$EXPECTED_HEAD" ] && [ "$target_sha" != "$EXPECTED_HEAD" ]; then
  echo "Expected $EXPECTED_HEAD but fetched $target_sha; refusing deployment."
  exit 3
fi

echo "Target production SHA: $target_sha"

restart_services() {
  uid_now="$(id -u)"
  labels=(
    com.sequencenow.comp-ai-app
    com.sequencenow.comp-ai-api
    com.sequencenow.comp-ai-agent
    com.sequencenow.comp-ai-mcp
  )

  for label in "${labels[@]}"; do
    if launchctl print "gui/$uid_now/$label" >/dev/null 2>&1; then
      echo "Restarting $label"
      launchctl kickstart -k "gui/$uid_now/$label"
    else
      echo "Skipping $label (not loaded)"
    fi
  done
}

health_check() {
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3100/ >/dev/null
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3101/health >/dev/null
  if launchctl print "gui/$(id -u)/com.sequencenow.comp-ai-mcp" >/dev/null 2>&1; then
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3103/health >/dev/null
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3103/ready >/dev/null
  fi
}

rollback() {
  echo "Deployment failed; rolling back to $previous_sha"
  git checkout --detach "$previous_sha"
  bun install --frozen-lockfile
  bun run build
  restart_services
  health_check
  echo "Rollback completed."
}

trap rollback ERR

git checkout --detach "$target_sha"
bun install --frozen-lockfile
bun run db:deploy
bun run build
restart_services
sleep 3
health_check

trap - ERR

echo "Production deployment passed."
echo "DEPLOYED_SHA=$target_sha"
