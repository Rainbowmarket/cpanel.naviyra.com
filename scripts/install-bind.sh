#!/usr/bin/env bash
# Install & configure BIND9 as authoritative nameserver for Naviyra Panel
# Usage: sudo ./scripts/install-bind.sh [PUBLIC_IP] [BASE_DOMAIN]
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./scripts/install-bind.sh"
  exit 1
fi

PUBLIC_IP_ARG="${1:-}"
BASE_DOMAIN_ARG="${2:-}"

# shellcheck source=lib/load-env.sh
if [ -f "$(dirname "$0")/lib/load-env.sh" ]; then
  # shellcheck disable=SC1091
  source "$(dirname "$0")/lib/load-env.sh"
fi

PUBLIC_IP="${PUBLIC_IP_ARG:-${SERVER_PUBLIC_IP:-}}"
BASE_DOMAIN="${BASE_DOMAIN_ARG:-${BASE_DOMAIN:-}}"

if [ -z "$PUBLIC_IP" ] || [ -z "$BASE_DOMAIN" ]; then
  echo "Usage: sudo ./scripts/install-bind.sh <PUBLIC_IP> <BASE_DOMAIN>"
  echo "Or set SERVER_PUBLIC_IP and PANEL_HOSTNAME in .env"
  exit 1
fi

NS1="ns1.${BASE_DOMAIN}"
NS2="ns2.${BASE_DOMAIN}"
ZONES_DIR=/etc/bind/zones
NAMED_DIR=/etc/bind/naviyra-zones.d
INCLUDE_FILE=/etc/bind/naviyra-zones.conf
SERIAL="$(date +%Y%m%d01)"

echo "==> Installing bind9..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y bind9 bind9utils bind9-doc dnsutils

mkdir -p "$ZONES_DIR" "$NAMED_DIR"
chown bind:bind "$ZONES_DIR" "$NAMED_DIR"
chmod 775 "$ZONES_DIR" "$NAMED_DIR"

# Authoritative-only options (public NS must not recurse for the world)
cat > /etc/bind/named.conf.options <<EOF
options {
    directory "/var/cache/bind";

    // Authoritative nameserver for Naviyra hosted zones
    recursion no;
    allow-query { any; };
    allow-transfer { none; };

    listen-on { any; };
    listen-on-v6 { any; };

    dnssec-validation auto;
};
EOF

# Wire Naviyra include into named.conf.local (idempotent)
touch "$INCLUDE_FILE"
if ! grep -qF 'naviyra-zones.conf' /etc/bind/named.conf.local 2>/dev/null; then
  cat >> /etc/bind/named.conf.local <<EOF

// Naviyra Panel managed zones
include "${INCLUDE_FILE}";
EOF
fi

# Base domain zone (glue for ns1/ns2 + common hosts)
ZONE_FILE="${ZONES_DIR}/db.${BASE_DOMAIN}"
cat > "$ZONE_FILE" <<EOF
\$TTL 86400
@       IN  SOA ${NS1}. admin.${BASE_DOMAIN}. (
                ${SERIAL} ; serial
                3600       ; refresh
                1800       ; retry
                604800     ; expire
                86400 )    ; minimum

@       IN  NS  ${NS1}.
@       IN  NS  ${NS2}.

@       IN  A   ${PUBLIC_IP}
www     IN  A   ${PUBLIC_IP}
ns1     IN  A   ${PUBLIC_IP}
ns2     IN  A   ${PUBLIC_IP}
chat    IN  A   ${PUBLIC_IP}
panel   IN  A   ${PUBLIC_IP}
cpanel  IN  A   ${PUBLIC_IP}
mail    IN  A   ${PUBLIC_IP}
EOF
chown bind:bind "$ZONE_FILE"

cat > "${NAMED_DIR}/${BASE_DOMAIN}.conf" <<EOF
zone "${BASE_DOMAIN}" {
    type master;
    file "${ZONE_FILE}";
    allow-transfer { none; };
};
EOF

# Rebuild master include
{
  for conf in "$NAMED_DIR"/*.conf; do
    [ -f "$conf" ] || continue
    echo "include \"${conf}\";"
  done
} > "$INCLUDE_FILE"

# Firewall
if command -v ufw >/dev/null 2>&1; then
  ufw allow 53/tcp || true
  ufw allow 53/udp || true
fi

named-checkconf
named-checkzone "$BASE_DOMAIN" "$ZONE_FILE"
systemctl enable named
systemctl restart named

echo ""
echo "BIND installed as authoritative NS."
echo "  NS1: ${NS1} -> ${PUBLIC_IP}"
echo "  NS2: ${NS2} -> ${PUBLIC_IP}"
echo "  Zones dir: ${ZONES_DIR}"
echo ""
echo "Panel .env should include:"
echo "  DNS_NS1=${NS1}"
echo "  DNS_NS2=${NS2}"
echo "  SERVER_PUBLIC_IP=${PUBLIC_IP}"
echo "  BIND_ZONES_DIR=${ZONES_DIR}"
echo "  BIND_NAMED_DIR=${NAMED_DIR}"
echo "  BIND_INCLUDE_FILE=${INCLUDE_FILE}"
echo "  BIND_RELOAD_CMD=rndc reload"
echo ""
echo "Registrar steps (required for ${BASE_DOMAIN} itself):"
echo "  1. At your domain registrar, set glue / host records:"
echo "       ${NS1} -> ${PUBLIC_IP}"
echo "       ${NS2} -> ${PUBLIC_IP}"
echo "  2. Change nameservers from Cloudflare to:"
echo "       ${NS1}"
echo "       ${NS2}"
echo "  Until then, Cloudflare still answers for ${BASE_DOMAIN},"
echo "  but customer domains using these NS will query this server on port 53."
echo ""
echo "Test: dig @${PUBLIC_IP} ${NS1} A +short"
