#!/usr/bin/env bash
# Load /opt/naviyra-panel/.env (or project .env).
# PANEL_HOST = control panel hostname (hpanel.example.com)
# BASE_DOMAIN = DNS/marketing zone apex (example.com)
# Usage: source "$(dirname "$0")/lib/load-env.sh"

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

# hpanel.example.com → example.com ; example.com stays example.com
zone_apex_from_host() {
  local h
  h="$(apex_from_host "${1:-}")"
  local rest="${h#*.}"
  if [ "$rest" != "$h" ] && [ -n "$rest" ] && [[ "$rest" == *.* ]]; then
    echo "$rest"
  else
    echo "$h"
  fi
}

resolve_panel_host() {
  local h=""
  if [ -n "${PANEL_HOSTNAME:-}" ]; then
    h="$(apex_from_host "$PANEL_HOSTNAME")"
  elif [ -n "${PANEL_PUBLIC_URL:-}" ]; then
    h="$(apex_from_host "$PANEL_PUBLIC_URL")"
  fi
  if [ -n "$h" ] && ! is_placeholder_host "$h"; then
    echo "$h"
    return
  fi
  echo ""
}

resolve_base_domain() {
  if [ -n "${DNS_NS1:-}" ]; then
    local h
    h="$(apex_from_host "$DNS_NS1")"
    h="${h#ns1.}"
    h="${h#ns2.}"
    if [ -n "$h" ] && ! is_placeholder_host "$h"; then
      echo "$h"
      return
    fi
  fi
  if [ -n "${DEFAULT_SERVER_HOSTNAME:-}" ]; then
    local h
    h="$(apex_from_host "$DEFAULT_SERVER_HOSTNAME")"
    h="${h#s1.}"
    h="${h#server1.}"
    if [ -n "$h" ] && ! is_placeholder_host "$h"; then
      echo "$h"
      return
    fi
  fi
  local panel
  panel="$(resolve_panel_host)"
  if [ -n "$panel" ]; then
    zone_apex_from_host "$panel"
    return
  fi
  echo ""
}

is_placeholder_host() {
  case "${1:-}" in
    *yourdomain.com*|*example.com*|*example.org*|localhost) return 0 ;;
  esac
  return 1
}

load_naviyra_env || true
PANEL_HOST="$(resolve_panel_host)"
BASE_DOMAIN="$(resolve_base_domain)"

if is_placeholder_host "$BASE_DOMAIN"; then
  BASE_DOMAIN=""
fi
# Docs example hpanel.yourdomain.com is not a live host. Infer hpanel.{real apex}.
if [ -z "$PANEL_HOST" ] && [ -n "$BASE_DOMAIN" ]; then
  PANEL_HOST="hpanel.${BASE_DOMAIN}"
  echo "[naviyra] PANEL_HOSTNAME was a docs example; using ${PANEL_HOST}. Set PANEL_HOSTNAME in .env." >&2
fi
# Marketing apex (naviyra.uk) is not the panel vhost — use hpanel.{apex}.
if [ -n "$PANEL_HOST" ] && [ -n "$BASE_DOMAIN" ] && [ "$PANEL_HOST" = "$BASE_DOMAIN" ]; then
  PANEL_HOST="hpanel.${BASE_DOMAIN}"
  echo "[naviyra] PANEL_HOSTNAME was the zone apex; using ${PANEL_HOST}." >&2
fi
if is_placeholder_host "$PANEL_HOST"; then
  PANEL_HOST=""
  echo "[naviyra] PANEL_HOSTNAME is still a docs example — not writing an nginx vhost. Set PANEL_HOSTNAME to your real host (e.g. hpanel.your-domain)." >&2
fi

PUBLIC_IP="${SERVER_PUBLIC_IP:-127.0.0.1}"
PANEL_PORT="${PANEL_PORT:-3100}"
AGENT_PORT="${AGENT_PORT:-4100}"
DNS_NS1="${DNS_NS1:-${BASE_DOMAIN:+ns1.$BASE_DOMAIN}}"
DNS_NS2="${DNS_NS2:-${BASE_DOMAIN:+ns2.$BASE_DOMAIN}}"
DEFAULT_SERVER_HOSTNAME="${DEFAULT_SERVER_HOSTNAME:-${BASE_DOMAIN:+s1.$BASE_DOMAIN}}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-${BASE_DOMAIN:+admin@$BASE_DOMAIN}}"

require_base_domain() {
  if [ -z "${PANEL_HOST:-}" ] && [ -z "${BASE_DOMAIN:-}" ]; then
    echo "ERROR: PANEL_HOSTNAME (or PANEL_PUBLIC_URL) is not set in .env"
    echo "Set PANEL_HOSTNAME=hpanel.yourdomain.com (or yourdomain.com) or complete admin first-login."
    exit 1
  fi
}

require_panel_host() {
  if [ -z "${PANEL_HOST:-}" ]; then
    echo "ERROR: PANEL_HOSTNAME (or PANEL_PUBLIC_URL) is not set in .env"
    exit 1
  fi
}
