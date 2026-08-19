#!/usr/bin/env bash
# Install PostgreSQL for Naviyra customer databases (localhost only).
# Skips apt when PostgreSQL is already installed.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
PANEL="${1:-/opt/naviyra-panel}"

find_psql() {
  if [ -x /usr/bin/psql ]; then
    echo /usr/bin/psql
    return 0
  fi
  local found
  found="$(ls -1d /usr/lib/postgresql/*/bin/psql 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$found" ] && [ -x "$found" ]; then
    echo "$found"
    return 0
  fi
  return 1
}

postgres_pkg_installed() {
  dpkg-query -W -f='${Status}\n' postgresql postgresql-contrib 2>/dev/null \
    | grep -q "install ok installed" && return 0
  dpkg-query -W -f='${Package}\n' 'postgresql-[0-9]*' 2>/dev/null \
    | grep -Eq '^postgresql-[0-9]+$' && return 0
  return 1
}

postgres_running() {
  systemctl is-active --quiet postgresql 2>/dev/null && return 0
  systemctl is-active --quiet postgresql.service 2>/dev/null && return 0
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -q && return 0
  fi
  if command -v pg_lsclusters >/dev/null 2>&1; then
    pg_lsclusters --no-header 2>/dev/null | grep -q ' online ' && return 0
  fi
  return 1
}

run_psql() {
  local psql_bin
  psql_bin="$(find_psql)"
  sudo -n -u postgres -- "$psql_bin" "$@"
}

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-postgres: apt-get required" >&2
  exit 1
fi

if find_psql >/dev/null 2>&1 && (postgres_pkg_installed || postgres_running); then
  echo "install-postgres: already installed, skipping apt"
else
  echo "install-postgres: installing packages…"
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib
fi

systemctl enable --now postgresql >/dev/null 2>&1 || true

# Wait for the socket; first boot after apt can take a few seconds.
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if run_psql -v ON_ERROR_STOP=1 -c "SELECT 1;" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "install-postgres: PostgreSQL did not become ready" >&2
  exit 1
fi

# Ensure postgres can create roles/dbs (default peer auth for local socket is fine)
run_psql -v ON_ERROR_STOP=1 -c "SELECT version();" >/dev/null

# Keep listen on localhost (do not open publicly). Port may be 5433 if 5432 is taken (e.g. Docker).
PG_CONF="$(run_psql -tAc "SHOW config_file" | tr -d '[:space:]')"
if [ -n "$PG_CONF" ] && [ -f "$PG_CONF" ]; then
  if grep -qE '^\s*listen_addresses\s*=' "$PG_CONF"; then
    sed -i "s/^\s*listen_addresses\s*=.*/listen_addresses = 'localhost'/" "$PG_CONF"
  else
    echo "listen_addresses = 'localhost'" >> "$PG_CONF"
  fi
  systemctl reload postgresql || systemctl restart postgresql
fi

PG_PORT="$(run_psql -tAc "SHOW port" | tr -d '[:space:]')"
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

echo "install-postgres: active=$(systemctl is-active postgresql 2>/dev/null || echo unknown) listen=localhost port=${PG_PORT}"
ss -lntp | grep -E ":${PG_PORT} " || true
