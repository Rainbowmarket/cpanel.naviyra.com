#!/usr/bin/env bash
# Point naviyra.uk (+ www) at Naviyra Panel (127.0.0.1:3100)
# Usage: sudo ./scripts/setup-panel-domain.sh
set -euo pipefail

PANEL_PORT="${PANEL_PORT:-3100}"
DOMAIN="naviyra.uk"
CONF_SRC="$(cd "$(dirname "$0")" && pwd)/nginx-naviyra-uk-panel.conf"
CONF_DST="/etc/nginx/sites-available/${DOMAIN}"
ENV_FILE="/opt/naviyra-panel/.env"
ACME_ROOT="/var/www/certbot"

mkdir -p "$ACME_ROOT"
cp "$CONF_SRC" "$CONF_DST"
# Ensure port matches env
sed -i "s|127.0.0.1:3100|127.0.0.1:${PANEL_PORT}|g" "$CONF_DST"
ln -sfn "$CONF_DST" "/etc/nginx/sites-enabled/${DOMAIN}"

nginx -t
systemctl reload nginx

if [[ -f "$ENV_FILE" ]]; then
  grep -q '^PANEL_PUBLIC_URL=' "$ENV_FILE" \
    && sed -i 's|^PANEL_PUBLIC_URL=.*|PANEL_PUBLIC_URL=https://naviyra.uk|' "$ENV_FILE" \
    || echo 'PANEL_PUBLIC_URL=https://naviyra.uk' >> "$ENV_FILE"
  # Behind Cloudflare HTTPS, cookies should be Secure when COOKIE_SECURE=true
  # Keep false until HTTPS works end-to-end if you use HTTP Flexible only.
  systemctl restart naviyra-panel || true
fi

echo ""
echo "nginx: ${DOMAIN} → 127.0.0.1:${PANEL_PORT}"
echo ""
echo "Cloudflare DNS (naviyra.uk is still on Cloudflare NS):"
echo "  1. A  @    → 136.243.196.166   (Proxy: ON or OFF)"
echo "  2. A  www  → 136.243.196.166"
echo "  3. SSL/TLS mode: Flexible (HTTP to origin) OR Full (after cert below)"
echo ""
echo "Optional Let's Encrypt (set Proxy OFF temporarily, or use DNS challenge):"
echo "  certbot certonly --webroot -w /var/www/certbot -d naviyra.uk -d www.naviyra.uk"
echo ""
curl -sI -H "Host: naviyra.uk" "http://127.0.0.1/" | head -n 8 || true
