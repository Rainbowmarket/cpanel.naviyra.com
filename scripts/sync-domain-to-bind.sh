#!/usr/bin/env bash
# Sync panel DNS zones into BIND
set -euo pipefail

# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"
require_base_domain

DOMAIN="${1:-kongunattugounder.com}"
IP="${SERVER_PUBLIC_IP:-136.243.196.166}"
NS1="${DNS_NS1:-ns1.${BASE_DOMAIN}}"
NS2="${DNS_NS2:-ns2.${BASE_DOMAIN}}"
ZONES_DIR=/etc/bind/zones
NAMED_DIR=/etc/bind/naviyra-zones.d
INCLUDE_FILE=/etc/bind/naviyra-zones.conf
PANEL_ZONE=/opt/naviyra-panel/data/dns/zones/db.${DOMAIN}
SERIAL=$(date +%Y%m%d%H%M%S | cut -c1-10)

mkdir -p "$ZONES_DIR" "$NAMED_DIR"

if [ -f "$PANEL_ZONE" ]; then
  # Rewrite NS hostnames to .uk if zone still has old defaults
  sed -e "s/ns1\.naviyra\.com/${NS1}/g" -e "s/ns2\.naviyra\.com/${NS2}/g" \
    "$PANEL_ZONE" > "${ZONES_DIR}/db.${DOMAIN}"
else
  cat > "${ZONES_DIR}/db.${DOMAIN}" <<EOF
\$TTL 86400
@       IN  SOA ${NS1}. admin.${DOMAIN}. (
                ${SERIAL} ; serial
                3600       ; refresh
                1800       ; retry
                604800     ; expire
                86400 )    ; minimum

@       IN  NS  ${NS1}.
@       IN  NS  ${NS2}.

@       86400 IN A ${IP}
www     86400 IN A ${IP}
EOF
fi

# Ensure A records exist
if ! grep -qE '^@\s+.*\sIN\s+A\s' "${ZONES_DIR}/db.${DOMAIN}"; then
  echo "@       86400 IN A ${IP}" >> "${ZONES_DIR}/db.${DOMAIN}"
fi
if ! grep -qE '^www\s+.*\sIN\s+A\s' "${ZONES_DIR}/db.${DOMAIN}"; then
  echo "www     86400 IN A ${IP}" >> "${ZONES_DIR}/db.${DOMAIN}"
fi

chown bind:bind "${ZONES_DIR}/db.${DOMAIN}"

cat > "${NAMED_DIR}/${DOMAIN}.conf" <<EOF
zone "${DOMAIN}" {
    type master;
    file "${ZONES_DIR}/db.${DOMAIN}";
    allow-transfer { none; };
};
EOF

{
  for conf in "$NAMED_DIR"/*.conf; do
    [ -f "$conf" ] || continue
    echo "include \"${conf}\";"
  done
} > "$INCLUDE_FILE"

# Keep panel copy in sync
mkdir -p /opt/naviyra-panel/data/dns/zones /opt/naviyra-panel/data/dns/named
cp "${ZONES_DIR}/db.${DOMAIN}" "/opt/naviyra-panel/data/dns/zones/db.${DOMAIN}"
cp "${NAMED_DIR}/${DOMAIN}.conf" "/opt/naviyra-panel/data/dns/named/${DOMAIN}.conf"

named-checkzone "$DOMAIN" "${ZONES_DIR}/db.${DOMAIN}"
named-checkconf
rndc reload || systemctl reload named

echo "=== zone file ==="
cat "${ZONES_DIR}/db.${DOMAIN}"
echo "=== dig ==="
dig @127.0.0.1 "$DOMAIN" A +short
dig @127.0.0.1 "www.$DOMAIN" A +short
dig @"$IP" "$DOMAIN" A +short

# Ensure website docroot exists (nginx may still need a vhost)
DOC=/var/www/${DOMAIN}/public_html
mkdir -p "$DOC"
if [ ! -f "$DOC/index.html" ]; then
  cat > "$DOC/index.html" <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>${DOMAIN}</title></head>
<body style="font-family:sans-serif;padding:2rem">
<h1>${DOMAIN}</h1>
<p>Hosted on Naviyra Panel.</p>
</body></html>
HTML
fi

# Minimal nginx site if missing
if [ ! -f /etc/nginx/sites-available/${DOMAIN} ]; then
  cat > /etc/nginx/sites-available/${DOMAIN} <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};
    root ${DOC};
    index index.html index.htm;
    location / { try_files \$uri \$uri/ =404; }
}
NGX
  ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}
  nginx -t && systemctl reload nginx
  echo "nginx site created"
else
  echo "nginx site already exists"
fi

echo DONE
