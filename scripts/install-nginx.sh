#!/usr/bin/env bash
# Install nginx if missing. Idempotent.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if command -v nginx >/dev/null 2>&1 && [ -d /etc/nginx ]; then
  echo "install-nginx: already installed"
else
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "install-nginx: apt-get required" >&2
    exit 1
  fi
  echo "install-nginx: installing packages…"
  apt-get update -qq
  apt-get install -y -qq nginx certbot
fi

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d /etc/nginx/snippets /var/log/nginx

systemctl enable --now nginx >/dev/null 2>&1 || true
rm -f /etc/nginx/sites-enabled/default

if ! command -v certbot >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  echo "install-nginx: installing certbot…"
  apt-get update -qq
  apt-get install -y -qq certbot || true
fi

if command -v nginx >/dev/null 2>&1; then
  echo "install-nginx: $(nginx -v 2>&1) active=$(systemctl is-active nginx 2>/dev/null || echo unknown)"
  SNIPPETS="$(cd "$(dirname "$0")" && pwd)/install-nginx-snippets.sh"
  if [ -f "$SNIPPETS" ]; then
    bash "$SNIPPETS" "$(cd "$(dirname "$0")/.." && pwd)" || true
  fi
else
  echo "install-nginx: nginx binary still missing" >&2
  exit 1
fi
