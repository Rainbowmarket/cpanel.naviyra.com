#!/usr/bin/env bash
# Point PANEL_HOSTNAME (+ www) HTTPS at Naviyra Panel (127.0.0.1:PANEL_PORT)
# Domain / email come from .env (or first admin login values).
set -euo pipefail

# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"
require_base_domain

DOMAIN="${BASE_DOMAIN}"
WWW="www.${DOMAIN}"
EMAIL="${LETSENCRYPT_EMAIL:-admin@${DOMAIN}}"
PORT="${PANEL_PORT:-3100}"

mkdir -p /var/www/certbot /etc/nginx/ssl

if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  certbot certonly --webroot -w /var/www/certbot \
    -d "${DOMAIN}" -d "${WWW}" \
    --non-interactive --agree-tos --email "${EMAIL}" \
    --keep-until-expiring || true
fi

CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"

if [ ! -f "$CERT" ]; then
  echo "Using self-signed cert for origin"
  CERT="/etc/nginx/ssl/${DOMAIN}.crt"
  KEY="/etc/nginx/ssl/${DOMAIN}.key"
  if [ ! -f "$CERT" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$KEY" -out "$CERT" \
      -subj "/CN=${DOMAIN}" \
      -addext "subjectAltName=DNS:${DOMAIN},DNS:${WWW}"
  fi
fi

SSL_OPTIONS=""
if [ -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
  SSL_OPTIONS="    include /etc/letsencrypt/options-ssl-nginx.conf;"
fi
DH=""
if [ -f /etc/letsencrypt/ssl-dhparams.pem ]; then
  DH="    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
fi

cat > "/etc/nginx/sites-available/${DOMAIN}" <<EOF
# Naviyra Panel — ${DOMAIN} → :${PORT}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN} ${WWW};

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
${SSL_OPTIONS}
${DH}

    client_max_body_size 64M;

    include /etc/nginx/snippets/naviyra-terminal-ws.conf;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF

ln -sfn "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t
systemctl reload nginx

echo "=== local https ==="
curl -skI -H "Host: ${DOMAIN}" https://127.0.0.1/ | head -n 12
echo "cert: $CERT domain: $DOMAIN"
