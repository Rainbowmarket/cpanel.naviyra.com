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
# Prefer nvm LTS under /root when systemd PATH only has distro Node 18.
if [ -d /root/.nvm/versions/node ]; then
  NVM_NODE="$(ls -d /root/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "${NVM_NODE:-}" ] && [ -x "$NVM_NODE" ]; then
    NODE_BIN="$NVM_NODE"
  fi
fi
if [ -f "$PANEL/.naviyra-install.json" ]; then
  META_NODE="$(python3 -c "import json; print(json.load(open('$PANEL/.naviyra-install.json')).get('nodePath',''))" 2>/dev/null || true)"
  if [ -n "${META_NODE:-}" ] && [ -x "$META_NODE" ]; then
    NODE_BIN="$META_NODE"
  fi
fi
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
if [ ! -x "$NODE_BIN" ]; then
  echo "visitor-ingest: node not found" >&2
  exit 1
fi

# Always hit the local panel — never the public HTTPS hostname.
unset PANEL_URL || true
export PANEL_PORT="${PANEL_PORT:-3100}"
export SECURITY_INGEST_KEY="${SECURITY_INGEST_KEY:-${AGENT_API_KEY:-}}"

"$NODE_BIN" "$PANEL/scripts/parse-nginx-visitors.mjs"
"$NODE_BIN" "$PANEL/scripts/purge-old-visitors.mjs" >/dev/null 2>&1 || true
