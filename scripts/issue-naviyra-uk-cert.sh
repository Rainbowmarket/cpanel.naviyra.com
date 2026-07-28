#!/usr/bin/env bash
set -euo pipefail

# Keep HTTP serving ACME + panel while issuing cert
python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/sites-available/naviyra.uk")
text = p.read_text()
old = """    location / {
        return 301 https://$host$request_uri;
    }"""
new = """    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }"""
if old in text:
    p.write_text(text.replace(old, new, 1))
    print("patched http for acme")
else:
    print("http already proxy or different")
PY

nginx -t
systemctl reload nginx

certbot certonly --webroot -w /var/www/certbot -d naviyra.uk \
  --non-interactive --agree-tos --email admin@naviyra.uk

sed -i 's|ssl_certificate     /etc/nginx/ssl/naviyra.uk.crt;|ssl_certificate     /etc/letsencrypt/live/naviyra.uk/fullchain.pem;|' /etc/nginx/sites-available/naviyra.uk
sed -i 's|ssl_certificate_key /etc/nginx/ssl/naviyra.uk.key;|ssl_certificate_key /etc/letsencrypt/live/naviyra.uk/privkey.pem;|' /etc/nginx/sites-available/naviyra.uk

python3 - <<'PY'
from pathlib import Path
import re
p = Path("/etc/nginx/sites-available/naviyra.uk")
text = p.read_text()
text2, n = re.subn(
    r"(server \{\n    listen 80;.*?location \^~ /\.well-known/acme-challenge/ \{.*?\n    \}\n\n)    location / \{.*?proxy_pass http://127\.0\.0\.1:3100;.*?\}",
    r"""\1    location / {
        return 301 https://$host$request_uri;
    }""",
    text,
    count=1,
    flags=re.S,
)
p.write_text(text2)
print(f"restored https redirect n={n}")
PY

nginx -t
systemctl reload nginx
curl -sI --resolve naviyra.uk:443:127.0.0.1 https://naviyra.uk/ | head -n 12
openssl x509 -in /etc/letsencrypt/live/naviyra.uk/fullchain.pem -noout -subject -issuer -dates
