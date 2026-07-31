#!/usr/bin/env bash
# Invoked by systemd naviyra-backup.service — triggers a panel backup run.
set -euo pipefail

PANEL_PORT="${PANEL_PORT:-3100}"
TOKEN="${BACKUP_WORKER_TOKEN:-${AGENT_API_KEY:-naviyra-local-agent-key}}"
URL="http://127.0.0.1:${PANEL_PORT}/api/backups"

# Load token from panel .env when not passed by the unit
if [[ -z "${BACKUP_WORKER_TOKEN:-}" && -f /opt/naviyra-panel/.env ]]; then
  # shellcheck disable=SC1091
  set -a
  # Prefer explicit keys without sourcing whole file (may have spaces)
  while IFS= read -r line; do
    case "$line" in
      BACKUP_WORKER_TOKEN=*|AGENT_API_KEY=*|PANEL_PORT=*)
        key="${line%%=*}"
        val="${line#*=}"
        val="${val%\"}"
        val="${val#\"}"
        export "$key=$val"
        ;;
    esac
  done < /opt/naviyra-panel/.env
  set +a
  PANEL_PORT="${PANEL_PORT:-3100}"
  TOKEN="${BACKUP_WORKER_TOKEN:-${AGENT_API_KEY:-naviyra-local-agent-key}}"
  URL="http://127.0.0.1:${PANEL_PORT}/api/backups"
fi

curl -fsS -X POST "$URL" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
