#!/usr/bin/env bash
set -euo pipefail

mkdir -p /var/www/certbot /etc/nginx/ssl

# Prefer Let's Encrypt; fall back to self-signed (Cloudflare Full accepts it)
if [ ! -f /etc/letsencrypt/live/naviyra.uk/fullchain.pem ]; then
  certbot certonly --webroot -w /var/www/certbot \
    -d naviyra.uk -d www.naviyra.uk \
    --non-interactive --agree-tos --email admin@naviyra.uk \
    --keep-until-expiring || true
fi

CERT=/etc/letsencrypt/live/naviyra.uk/fullchain.pem
KEY=/etc/letsencrypt/live/naviyra.uk/privkey.pem

if [ ! -f "$CERT" ]; then
  echo "Using self-signed cert for origin (Cloudflare Full)"
  mkdir -p /etc/nginx/ssl
  CERT=/etc/nginx/ssl/naviyra.uk.crt
  KEY=/etc/nginx/ssl/naviyra.uk.key
  if [ ! -f "$CERT" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$KEY" -out "$CERT" \
      -subj "/CN=naviyra.uk" \
      -addext "subjectAltName=DNS:naviyra.uk,DNS:www.naviyra.uk"
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

cat > /etc/nginx/sites-available/naviyra.uk <<EOF
# Naviyra Panel — apex → :3100
server {
    listen 80;
    listen [::]:80;
    server_name naviyra.uk www.naviyra.uk;

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
    server_name naviyra.uk www.naviyra.uk;

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
${SSL_OPTIONS}
${DH}

    client_max_body_size 64M;

    location / {
        proxy_pass http://127.0.0.1:3100;
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

ln -sfn /etc/nginx/sites-available/naviyra.uk /etc/nginx/sites-enabled/naviyra.uk
nginx -t
systemctl reload nginx

echo "=== local https ==="
curl -skI -H 'Host: naviyra.uk' https://127.0.0.1/ | head -n 12
echo "cert: $CERT"
