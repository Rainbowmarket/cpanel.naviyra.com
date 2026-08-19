#!/usr/bin/env bash
# One-shot: parse nginx access logs and POST visits to the panel Security ingest API.
set -euo pipefail

PANEL="${NAVIYRA_ROOT:-/opt/naviyra-panel}"
cd "$PANEL"

if [ -f "$PANEL/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      PANEL_PORT=*|PANEL_HOSTNAME=*|AGENT_API_KEY=*|SECURITY_INGEST_KEY=*)
        key="${line%%=*}"
        val="${line#*=}"
        val="${val%\"}"
        val="${val#\"}"
        val="${val%\'}"
        val="${val#\'}"
        export "$key=$val"
        ;;
    esac
  done < "$PANEL/.env"
fi

NODE_BIN="$(command -v node || true)"
if [ -f "$PANEL/.naviyra-install.json" ]; then
  META_NODE="$(python3 -c "import json; print(json.load(open('$PANEL/.naviyra-install.json')).get('nodePath',''))" 2>/dev/null || true)"
  if [ -n "${META_NODE:-}" ] && [ -x "$META_NODE" ]; then
    NODE_BIN="$META_NODE"
  fi
fi
NODE_BIN="${NODE_BIN:-/usr/bin/node}"

# Always hit the local panel — never the public HTTPS hostname.
unset PANEL_URL || true
export PANEL_PORT="${PANEL_PORT:-3100}"
export SECURITY_INGEST_KEY="${SECURITY_INGEST_KEY:-${AGENT_API_KEY:-}}"

exec "$NODE_BIN" "$PANEL/scripts/parse-nginx-visitors.mjs"
