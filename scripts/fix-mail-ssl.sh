#!/usr/bin/env bash
# Re-issue SSL for mail.kongunattugounder.com only (no www.mail)
set -euo pipefail

HOST=mail.kongunattugounder.com
DOC=/var/www/kongunattugounder.com/subdomains/mail/public_html
ACME=/var/www/certbot

mkdir -p "$DOC" "$ACME/.well-known/acme-challenge"

cat > /etc/nginx/sites-available/${HOST} <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${HOST};

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
ln -sfn /etc/nginx/sites-available/${HOST} /etc/nginx/sites-enabled/${HOST}
nginx -t
systemctl reload nginx

echo test-token > "${ACME}/.well-known/acme-challenge/ping-test"
curl -sf -H "Host: ${HOST}" "http://127.0.0.1/.well-known/acme-challenge/ping-test" | grep -q test-token
echo "ACME webroot OK"

certbot certonly --non-interactive --agree-tos --keep-until-expiring \
  --cert-name "${HOST}" \
  --webroot -w "${ACME}" \
  --email admin@naviyra.uk \
  -d "${HOST}"

CERT=/etc/letsencrypt/live/${HOST}
cat > /etc/nginx/sites-available/${HOST} <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${HOST};

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
    server_name ${HOST};

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
echo | openssl s_client -connect 127.0.0.1:443 -servername ${HOST} 2>/dev/null | openssl x509 -noout -subject -dates
curl -skI --resolve ${HOST}:443:127.0.0.1 https://${HOST}/ | head -12
systemctl restart naviyra-panel
echo DONE
