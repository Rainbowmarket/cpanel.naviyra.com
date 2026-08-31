#!/usr/bin/env bash
# Write nginx HTTP+HTTPS vhost for PANEL_HOSTNAME from .env (any domain).
# HTTP always reverse-proxies the panel (first-boot by IP works). HTTPS is extra.
# Usage: sudo bash scripts/setup-panel-https.sh
set -euo pipefail

# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"
require_panel_host

DOMAIN="${PANEL_HOST}"
EMAIL="${LETSENCRYPT_EMAIL:-admin@${BASE_DOMAIN:-$DOMAIN}}"
PORT="${PANEL_PORT:-3100}"
PUBLIC_IP="${PUBLIC_IP:-}"

if is_placeholder_host "${DOMAIN}"; then
  echo "Skipping panel HTTPS: PANEL_HOSTNAME is still a docs example (${DOMAIN}). Set your real host in .env." >&2
  exit 0
fi

if ! command -v nginx >/dev/null 2>&1; then
  NGINX_SETUP="$(dirname "$0")/install-nginx.sh"
  if [ -f "$NGINX_SETUP" ]; then
    bash "$NGINX_SETUP" || true
  fi
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "Skipping panel HTTPS: nginx is not installed." >&2
  exit 0
fi

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/ssl /etc/nginx/snippets /etc/nginx/conf.d /var/www/certbot

# Ubuntu default site would win http://IP/ and hide the panel.
rm -f /etc/nginx/sites-enabled/default

MAP_DST="/etc/nginx/conf.d/naviyra-websocket-map.conf"
if [ ! -f "$MAP_DST" ]; then
  MAP_SRC="$(dirname "$0")/nginx-websocket-map.conf"
  if [ -f "$MAP_SRC" ]; then
    cp -f "$MAP_SRC" "$MAP_DST"
  else
    cat > "$MAP_DST" <<'MAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
MAP
  fi
fi

if [ "${DOMAIN}" = "${BASE_DOMAIN:-}" ]; then
  SERVER_NAMES="${DOMAIN} www.${DOMAIN}"
  CERT_ARGS=(-d "${DOMAIN}" -d "www.${DOMAIN}")
  SAN="DNS:${DOMAIN},DNS:www.${DOMAIN}"
else
  SERVER_NAMES="${DOMAIN}"
  CERT_ARGS=(-d "${DOMAIN}")
  SAN="DNS:${DOMAIN}"
fi
if [ -n "${PUBLIC_IP}" ] && [[ "${PUBLIC_IP}" =~ ^[0-9.]+$ ]]; then
  SERVER_NAMES="${SERVER_NAMES} ${PUBLIC_IP}"
fi

if [ -f "$(dirname "$0")/install-nginx-snippets.sh" ]; then
  bash "$(dirname "$0")/install-nginx-snippets.sh" "$(cd "$(dirname "$0")/.." && pwd)" || true
fi

# HTTP vhost must exist before HTTP-01. Use LE if already issued, else self-signed for now.
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
      -addext "subjectAltName=${SAN}"
  fi
fi

SSL_OPTIONS=""
if [ -f /etc/nginx/snippets/naviyra-ssl-params.conf ]; then
  SSL_OPTIONS="    include /etc/nginx/snippets/naviyra-ssl-params.conf;"
elif [ -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
  SSL_OPTIONS="    include /etc/letsencrypt/options-ssl-nginx.conf;"
fi
DH=""
if [ -f /etc/letsencrypt/ssl-dhparams.pem ]; then
  DH="    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
fi

SNIPPET=""
if [ -f /etc/nginx/snippets/naviyra-terminal-ws.conf ]; then
  SNIPPET="    include /etc/nginx/snippets/naviyra-terminal-ws.conf;"
fi

PROXY_HEADERS=$(cat <<EOF
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
EOF
)

PMA_ROOT="${PHPMYADMIN_DIR:-${PANEL_ROOT:-/opt/naviyra-panel}/phpmyadmin}"
PPA_ROOT="${PHPPGADMIN_DIR:-${PANEL_ROOT:-/opt/naviyra-panel}/phppgadmin}"
if [ -z "${PANEL_ROOT:-}" ]; then
  PANEL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  PMA_ROOT="${PHPMYADMIN_DIR:-$PANEL_ROOT/phpmyadmin}"
  PPA_ROOT="${PHPPGADMIN_DIR:-$PANEL_ROOT/phppgadmin}"
fi
PHP_SOCK="${PHP_FPM_SOCKET:-}"
if [ -z "$PHP_SOCK" ] || [ ! -S "$PHP_SOCK" ]; then
  for s in /run/php/php*-fpm.sock; do
    if [ -S "$s" ]; then
      PHP_SOCK="$s"
      break
    fi
  done
fi
PHP_SOCK="${PHP_SOCK:-/run/php/php8.3-fpm.sock}"

PMA_BLOCK=""
if [ -f "$PMA_ROOT/index.php" ]; then
  PMA_BLOCK=$(cat <<EOF

    # phpMyAdmin (panel host only — not on customer sites)
    location /_pma/ {
        alias ${PMA_ROOT}/;
        index index.php;
    }
    location ~ ^/_pma/(.+\\.php)(/.*)?\$ {
        include fastcgi_params;
        fastcgi_pass unix:${PHP_SOCK};
        fastcgi_param SCRIPT_FILENAME ${PMA_ROOT}/\$1;
        fastcgi_param PATH_INFO \$2;
        fastcgi_read_timeout 300;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }
EOF
)
fi

PPA_BLOCK=""
if [ -f "$PPA_ROOT/index.php" ]; then
  PPA_BLOCK=$(cat <<EOF

    # phpPgAdmin (panel host only — not on customer sites)
    location /_ppa/ {
        alias ${PPA_ROOT}/;
        index index.php;
    }
    location ~ ^/_ppa/(.+\\.php)(/.*)?\$ {
        include fastcgi_params;
        fastcgi_pass unix:${PHP_SOCK};
        fastcgi_param SCRIPT_FILENAME ${PPA_ROOT}/\$1;
        fastcgi_param PATH_INFO \$2;
        fastcgi_read_timeout 300;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }
EOF
)
fi

cat > "/etc/nginx/sites-available/${DOMAIN}" <<EOF
# Naviyra Panel — ${DOMAIN} → 127.0.0.1:${PORT}
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${SERVER_NAMES};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    client_max_body_size 512M;
${SNIPPET}
${PMA_BLOCK}
${PPA_BLOCK}

    location / {
${PROXY_HEADERS}
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${SERVER_NAMES};

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
${SSL_OPTIONS}
${DH}

    client_max_body_size 512M;
${SNIPPET}
${PMA_BLOCK}
${PPA_BLOCK}

    location / {
${PROXY_HEADERS}
    }
}
EOF

# Drop customer website vhosts that stole the panel hostname
for link in /etc/nginx/sites-enabled/*; do
  [ -e "$link" ] || continue
  [ "$(basename "$link")" = "${DOMAIN}" ] && continue
  if grep -qE "server_name[^;]*[[:space:]]${DOMAIN}([[:space:];]|$)" "$link" 2>/dev/null; then
    echo "Disabling ${link} (also claims ${DOMAIN})"
    rm -f "$link"
  fi
done

ln -sfn "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
if nginx -t; then
  systemctl reload nginx
else
  echo "nginx -t failed with default_server; retrying without it" >&2
  sed -i 's/ default_server//g' "/etc/nginx/sites-available/${DOMAIN}"
  if nginx -t; then
    systemctl reload nginx
  else
    echo "nginx -t failed after writing ${DOMAIN} vhost" >&2
    exit 1
  fi
fi

if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  if command -v certbot >/dev/null 2>&1; then
    certbot certonly --webroot -w /var/www/certbot \
      "${CERT_ARGS[@]}" \
      --non-interactive --agree-tos --email "${EMAIL}" \
      --keep-until-expiring || true
  else
    echo "certbot not installed — using a self-signed origin cert"
  fi
fi

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  sed -i "s|^    ssl_certificate     .*|    ssl_certificate     ${CERT};|" "/etc/nginx/sites-available/${DOMAIN}"
  sed -i "s|^    ssl_certificate_key .*|    ssl_certificate_key ${KEY};|" "/etc/nginx/sites-available/${DOMAIN}"
  if nginx -t; then
    systemctl reload nginx
  fi
fi

echo "Panel nginx: http://${PUBLIC_IP:-SERVER_IP}:${PORT}  and  http://${DOMAIN} → 127.0.0.1:${PORT}"
echo "  cert=${CERT}"
