#!/usr/bin/env bash
# Stop unknown hosts (ns1.naviyra.uk, etc.) from redirecting to chat.naviyra.uk
set -euo pipefail

CONF=/etc/nginx/sites-available/naviyra-chat
BACKUP="/etc/nginx/sites-available/naviyra-chat.bak.$(date +%Y%m%d%H%M%S)"
cp "$CONF" "$BACKUP"

python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/sites-available/naviyra-chat")
text = p.read_text()
old = """server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name chat.naviyra.uk 136.243.196.166;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://chat.naviyra.uk$request_uri;
    }
}"""
new = """# Default catch-all: do not send unknown hosts (e.g. ns1) to chat
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        default_type text/plain;
        return 200 'Naviyra host\\n';
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name chat.naviyra.uk;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://chat.naviyra.uk$request_uri;
    }
}

# Nameserver hostnames should not redirect to chat
server {
    listen 80;
    listen [::]:80;
    server_name ns1.naviyra.uk ns2.naviyra.uk;

    location / {
        default_type text/plain;
        return 200 'Naviyra nameserver\\n';
    }
}"""
if old not in text:
    raise SystemExit("expected http block not found — already patched?")
p.write_text(text.replace(old, new, 1))
print("patched ok")
PY

nginx -t
systemctl reload nginx

echo "=== ns1 host ==="
curl -sI -H 'Host: ns1.naviyra.uk' http://127.0.0.1/ | head -12
curl -s -H 'Host: ns1.naviyra.uk' http://127.0.0.1/
echo
echo "=== chat host ==="
curl -sI -H 'Host: chat.naviyra.uk' http://127.0.0.1/ | head -10
