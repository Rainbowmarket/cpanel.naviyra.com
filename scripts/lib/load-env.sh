#!/usr/bin/env bash
# Load /opt/naviyra-panel/.env (or project .env) and resolve BASE_DOMAIN.
# Usage: source "$(dirname "$0")/lib/load-env.sh"   OR from scripts/: source "$(dirname "$0")/lib/load-env.sh"

_NAVIYRA_ENV_CANDIDATES=(
  "${NAVIYRA_ENV_FILE:-}"
  "/opt/naviyra-panel/.env"
  "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/.env"
  "$(pwd)/.env"
)

load_naviyra_env() {
  local f
  for f in "${_NAVIYRA_ENV_CANDIDATES[@]}"; do
    [ -n "$f" ] || continue
    if [ -f "$f" ]; then
      set -a
      # shellcheck disable=SC1090
      source "$f"
      set +a
      NAVIYRA_ENV_LOADED="$f"
      return 0
    fi
  done
  return 1
}

apex_from_host() {
  local h="${1:-}"
  h="${h#http://}"
  h="${h#https://}"
  h="${h%%/*}"
  h="${h%%:*}"
  h="${h#www.}"
  echo "$h"
}

resolve_base_domain() {
  if [ -n "${PANEL_HOSTNAME:-}" ]; then
    apex_from_host "$PANEL_HOSTNAME"
    return
  fi
  if [ -n "${PANEL_PUBLIC_URL:-}" ]; then
    apex_from_host "$PANEL_PUBLIC_URL"
    return
  fi
  if [ -n "${DEFAULT_SERVER_HOSTNAME:-}" ]; then
    local h
    h="$(apex_from_host "$DEFAULT_SERVER_HOSTNAME")"
    echo "${h#server1.}"
    return
  fi
  if [ -n "${DNS_NS1:-}" ]; then
    local h
    h="$(apex_from_host "$DNS_NS1")"
    echo "${h#ns1.}"
    return
  fi
  echo ""
}

load_naviyra_env || true
BASE_DOMAIN="$(resolve_base_domain)"
PUBLIC_IP="${SERVER_PUBLIC_IP:-127.0.0.1}"
PANEL_PORT="${PANEL_PORT:-3100}"
AGENT_PORT="${AGENT_PORT:-4100}"
DNS_NS1="${DNS_NS1:-${BASE_DOMAIN:+ns1.$BASE_DOMAIN}}"
DNS_NS2="${DNS_NS2:-${BASE_DOMAIN:+ns2.$BASE_DOMAIN}}"
DEFAULT_SERVER_HOSTNAME="${DEFAULT_SERVER_HOSTNAME:-${BASE_DOMAIN:+server1.$BASE_DOMAIN}}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-${BASE_DOMAIN:+admin@$BASE_DOMAIN}}"

require_base_domain() {
  if [ -z "${BASE_DOMAIN:-}" ]; then
    echo "ERROR: PANEL_HOSTNAME (or PANEL_PUBLIC_URL) is not set in .env"
    echo "Set PANEL_HOSTNAME=yourdomain.com or complete admin first-login."
    exit 1
  fi
}
