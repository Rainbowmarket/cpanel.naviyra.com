#!/usr/bin/env bash
# 1) Stop HTTPS default_server from serving Naviyra Chat for other domains
# 2) Issue Let's Encrypt + HTTPS vhost for a customer domain
set -euo pipefail

# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"

DOMAIN="${1:-kongunattugounder.com}"
DOC=/var/www/${DOMAIN}/public_html
ACME=/var/www/certbot
CHAT_CONF=/etc/nginx/sites-available/naviyra-chat
EMAIL="${LETSENCRYPT_EMAIL:-admin@${BASE_DOMAIN:-localhost}}"

mkdir -p "$DOC" "$ACME"

python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/sites-available/naviyra-chat")
text = p.read_text()
old = """# Keep IP access working with temporary self-signed until LE is ready
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name 136.243.196.166 _;

    ssl_certificate     /etc/ssl/certs/naviyra-chat.crt;
    ssl_certificate_key /etc/ssl/private/naviyra-chat.key;

    root /opt/naviyra-chat/apps/web/dist;
    index index.html;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400;
    }

    location /chat {
        proxy_pass http://127.0.0.1:3000/chat;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400;
    }

    location /media/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}"""
new = """# Default HTTPS catch-all: do NOT serve chat for unknown hosts
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate     /etc/ssl/certs/naviyra-chat.crt;
    ssl_certificate_key /etc/ssl/private/naviyra-chat.key;

    location / {
        default_type text/plain;
        return 200 'Naviyra host\\n';
    }
}

# Optional: raw IP HTTPS still reaches chat intentionally? keep IP-only block
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name 136.243.196.166;

    ssl_certificate     /etc/ssl/certs/naviyra-chat.crt;
    ssl_certificate_key /etc/ssl/private/naviyra-chat.key;

    root /opt/naviyra-chat/apps/web/dist;
    index index.html;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400;
    }

    location /chat {
        proxy_pass http://127.0.0.1:3000/chat;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400;
    }

    location /media/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}"""
if old not in text:
    if "Default HTTPS catch-all" in text:
        print("https default already patched")
    else:
        raise SystemExit("expected https default block not found")
else:
    p.write_text(text.replace(old, new, 1))
    print("https default patched")
PY

# HTTP site + default index for domain
cat > /etc/nginx/sites-available/${DOMAIN} <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    root ${DOC};
    index index.html index.htm;

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME};
        default_type text/plain;
    }

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}

if [ ! -s "${DOC}/index.html" ]; then
  cat > "${DOC}/index.html" <<HTML
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${DOMAIN}</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0">
  <h1>${DOMAIN}</h1>
  <p style="color:#94a3b8">Hosted on Naviyra Panel. Upload your site files to replace this page.</p>
</body>
</html>
HTML
fi

nginx -t
systemctl reload nginx

# Certbot
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y certbot python3-certbot-nginx
fi

certbot certonly --non-interactive --agree-tos --keep-until-expiring \
  --webroot -w "${ACME}" \
  --email "${EMAIL}" \
  -d "${DOMAIN}" -d "www.${DOMAIN}"

CERT=/etc/letsencrypt/live/${DOMAIN}
cat > /etc/nginx/sites-available/${DOMAIN} <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME};
        default_type text/plain;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN};

    ssl_certificate     ${CERT}/fullchain.pem;
    ssl_certificate_key ${CERT}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root ${DOC};
    index index.html index.htm;
    client_max_body_size 64M;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF

nginx -t
systemctl reload nginx

echo "=== verify ==="
curl -skI -H "Host: ${DOMAIN}" https://127.0.0.1/ | head -15
curl -sI http://${DOMAIN}/ | head -10
echo DONE
