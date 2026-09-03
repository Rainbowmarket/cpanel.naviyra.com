#!/usr/bin/env bash
# Hourly: evaluate controller host CPU/RAM/disk/agent and email admins if needed.
set -euo pipefail

PANEL_PORT="${PANEL_PORT:-3100}"
TOKEN="${BACKUP_WORKER_TOKEN:-${AGENT_API_KEY:-}}"
URL="http://127.0.0.1:${PANEL_PORT}/api/system/host-alerts"

if [[ -z "${BACKUP_WORKER_TOKEN:-}" && -f /opt/naviyra-panel/.env ]]; then
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
  PANEL_PORT="${PANEL_PORT:-3100}"
  TOKEN="${BACKUP_WORKER_TOKEN:-${AGENT_API_KEY:-}}"
  URL="http://127.0.0.1:${PANEL_PORT}/api/system/host-alerts"
fi

curl -fsS -X POST "$URL" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
