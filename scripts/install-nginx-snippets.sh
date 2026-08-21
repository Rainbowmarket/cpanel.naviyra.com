#!/usr/bin/env bash
# Install Naviyra nginx snippets (terminal WS, deny-sensitive, error pages).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PANEL_ROOT="${1:-$ROOT}"

if [ ! -d /etc/nginx ]; then
  echo "install-nginx-snippets: nginx not installed — skip"
  exit 0
fi

mkdir -p /etc/nginx/snippets

if [ -f "$ROOT/scripts/nginx-deny-sensitive.conf" ]; then
  install -m 0644 "$ROOT/scripts/nginx-deny-sensitive.conf" \
    /etc/nginx/snippets/naviyra-deny-sensitive.conf
fi
if [ -f "$ROOT/scripts/nginx-error-pages.conf" ]; then
  install -m 0644 "$ROOT/scripts/nginx-error-pages.conf" \
    /etc/nginx/snippets/naviyra-error-pages.conf
fi

AGENT_PORT="4100"
ENV_FILE="$PANEL_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  raw="$(grep -E '^AGENT_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  if [ -n "$raw" ]; then
    AGENT_PORT="$raw"
  fi
fi

if [ -f "$ROOT/scripts/nginx-terminal-ws.conf" ]; then
  sed -e "s|127.0.0.1:4100|127.0.0.1:${AGENT_PORT}|g" \
    "$ROOT/scripts/nginx-terminal-ws.conf" \
    > /etc/nginx/snippets/naviyra-terminal-ws.conf
  chmod 644 /etc/nginx/snippets/naviyra-terminal-ws.conf
  echo "install-nginx-snippets: wrote terminal-ws (agent :${AGENT_PORT})"
fi

mkdir -p /etc/nginx/conf.d /etc/nginx/snippets
if [ -f "$ROOT/scripts/nginx-upload.conf" ]; then
  if [ ! -f /etc/nginx/conf.d/naviyra-upload.conf ]; then
    install -m 0644 "$ROOT/scripts/nginx-upload.conf" /etc/nginx/conf.d/naviyra-upload.conf
    echo "install-nginx-snippets: wrote upload body-size (512M default)"
  fi
  if [ ! -f /etc/nginx/snippets/naviyra-upload-limit.conf ]; then
    install -m 0644 "$ROOT/scripts/nginx-upload.conf" \
      /etc/nginx/snippets/naviyra-upload-limit.conf
  fi
fi
