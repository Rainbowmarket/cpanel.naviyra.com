#!/usr/bin/env bash
# Point PANEL_HOSTNAME at Naviyra Panel (no www unless the panel is the zone apex)
# Usage: sudo ./scripts/setup-panel-domain.sh
set -euo pipefail

# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"
require_panel_host

PANEL_PORT="${PANEL_PORT:-3100}"
DOMAIN="${PANEL_HOST}"
ENV_FILE="${NAVIYRA_ENV_LOADED:-/opt/naviyra-panel/.env}"
ACME_ROOT="/var/www/certbot"
CONF_DST="/etc/nginx/sites-available/${DOMAIN}"

if [ "${DOMAIN}" = "${BASE_DOMAIN:-}" ]; then
  SERVER_NAMES="${DOMAIN} www.${DOMAIN}"
else
  SERVER_NAMES="${DOMAIN}"
fi

mkdir -p "$ACME_ROOT"

cat > "$CONF_DST" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAMES};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
    }

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

ln -sfn "$CONF_DST" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t
systemctl reload nginx

if [[ -f "$ENV_FILE" ]]; then
  grep -q '^PANEL_HOSTNAME=' "$ENV_FILE" \
    && sed -i "s|^PANEL_HOSTNAME=.*|PANEL_HOSTNAME=${DOMAIN}|" "$ENV_FILE" \
    || echo "PANEL_HOSTNAME=${DOMAIN}" >> "$ENV_FILE"
  grep -q '^PANEL_PUBLIC_URL=' "$ENV_FILE" \
    && sed -i "s|^PANEL_PUBLIC_URL=.*|PANEL_PUBLIC_URL=https://${DOMAIN}|" "$ENV_FILE" \
    || echo "PANEL_PUBLIC_URL=https://${DOMAIN}" >> "$ENV_FILE"
  systemctl restart naviyra-panel || true
fi

echo ""
echo "nginx: ${DOMAIN} → 127.0.0.1:${PANEL_PORT}"
echo "HTTPS: sudo bash scripts/setup-panel-https.sh"
echo ""
curl -sI -H "Host: ${DOMAIN}" "http://127.0.0.1/" | head -n 8 || true
