#!/usr/bin/env bash
# Rewrite all mail.* nginx sites to reverse-proxy the panel webmail login.
set -euo pipefail

PANEL="${1:-/opt/naviyra-panel}"
PANEL_PORT="${PANEL_PORT:-3100}"
ENABLED=/etc/nginx/sites-enabled
AVAILABLE=/etc/nginx/sites-available

if [ ! -d "$ENABLED" ]; then
  echo "mail_proxies=skipped (no nginx)"
  exit 0
fi

refresh_one() {
  local host="$1"
  local conf="$AVAILABLE/$host"
  local cert="/etc/letsencrypt/live/$host"
  local has_cert=0
  if [ -f "$cert/fullchain.pem" ] && [ -f "$cert/privkey.pem" ]; then
    has_cert=1
  fi

  if [ "$has_cert" = 1 ]; then
    cat >"$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${host};

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
    server_name ${host};

    ssl_certificate     ${cert}/fullchain.pem;
    ssl_certificate_key ${cert}/privkey.pem;
    include /etc/nginx/snippets/naviyra-ssl-params.conf;

    client_max_body_size 64M;

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
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
  else
    cat >"$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    client_max_body_size 64M;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
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
  fi

  ln -sfn "$conf" "$ENABLED/$host"
  echo "refreshed $host (ssl=$has_cert)"
}

count=0
shopt -s nullglob
for path in "$ENABLED"/mail.*; do
  base=$(basename "$path")
  # skip backups / broken links
  [ -e "$AVAILABLE/$base" ] || [ -L "$path" ] || continue
  case "$base" in
    mail.*)
      refresh_one "$base"
      count=$((count + 1))
      ;;
  esac
done

# Also catch sites-available mail.* not yet enabled
for path in "$AVAILABLE"/mail.*; do
  base=$(basename "$path")
  if [ ! -e "$ENABLED/$base" ]; then
    refresh_one "$base"
    count=$((count + 1))
  fi
done

if [ "$count" -gt 0 ]; then
  nginx -t
  systemctl reload nginx
fi
echo "mail_proxies_refreshed=$count"
