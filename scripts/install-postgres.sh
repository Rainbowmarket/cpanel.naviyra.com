#!/usr/bin/env bash
# Install PostgreSQL for Naviyra customer databases (localhost only).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
PANEL="${1:-/opt/naviyra-panel}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-postgres: apt-get required" >&2
  exit 1
fi

apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib

systemctl enable --now postgresql

# Ensure postgres can create roles/dbs (default peer auth for local socket is fine)
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "SELECT version();" >/dev/null

# Keep listen on localhost (do not open publicly). Port may be 5433 if 5432 is taken (e.g. Docker).
PG_CONF="$(sudo -u postgres psql -tAc "SHOW config_file" | tr -d '[:space:]')"
if [ -n "$PG_CONF" ] && [ -f "$PG_CONF" ]; then
  if grep -qE '^\s*listen_addresses\s*=' "$PG_CONF"; then
    sed -i "s/^\s*listen_addresses\s*=.*/listen_addresses = 'localhost'/" "$PG_CONF"
  else
    echo "listen_addresses = 'localhost'" >> "$PG_CONF"
  fi
  systemctl reload postgresql || systemctl restart postgresql
fi

PG_PORT="$(sudo -u postgres psql -tAc "SHOW port" | tr -d '[:space:]')"
PG_PORT="${PG_PORT:-5432}"

# Persist port for panel connection details
if [ -f "$PANEL/.env" ]; then
  if grep -q '^CUSTOMER_POSTGRES_PORT=' "$PANEL/.env"; then
    sed -i "s|^CUSTOMER_POSTGRES_PORT=.*|CUSTOMER_POSTGRES_PORT=${PG_PORT}|" "$PANEL/.env"
  else
    echo "CUSTOMER_POSTGRES_PORT=${PG_PORT}" >> "$PANEL/.env"
  fi
  if grep -q '^CUSTOMER_POSTGRES_HOST=' "$PANEL/.env"; then
    sed -i "s|^CUSTOMER_POSTGRES_HOST=.*|CUSTOMER_POSTGRES_HOST=127.0.0.1|" "$PANEL/.env"
  else
    echo "CUSTOMER_POSTGRES_HOST=127.0.0.1" >> "$PANEL/.env"
  fi
fi

echo "install-postgres: active=$(systemctl is-active postgresql) listen=localhost port=${PG_PORT}"
ss -lntp | grep -E ":${PG_PORT} " || true
