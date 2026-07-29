#!/usr/bin/env bash
# Install branded error pages and enable them on all customer nginx sites.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERR_DIR=/var/www/naviyra-errors
SNIP_DST=/etc/nginx/snippets/naviyra-error-pages.conf
INCLUDE_LINE='    include /etc/nginx/snippets/naviyra-error-pages.conf;'

mkdir -p "$ERR_DIR" /etc/nginx/snippets
node "$ROOT/scripts/generate-error-pages.mjs" "$ERR_DIR"
cp -f "$ROOT/scripts/nginx-error-pages.conf" "$SNIP_DST"
chmod 644 "$SNIP_DST"
chown -R www-data:www-data "$ERR_DIR" 2>/dev/null || true

python3 - <<'PY'
from pathlib import Path
include = "    include /etc/nginx/snippets/naviyra-error-pages.conf;\n"
skip_exact = {"naviyra-chat", "default"}
# Include panel host so custom errors show there too
for conf in Path("/etc/nginx/sites-available").iterdir():
    if not conf.is_file():
        continue
    name = conf.name
    if name in skip_exact or name.startswith("default") or ".bak" in name:
        continue
    text = conf.read_text()
    if name != "naviyra.uk" and "root /var/www/" not in text and "try_files" not in text and "fastcgi_pass" not in text and "proxy_pass" not in text:
        continue
    if "naviyra-error-pages.conf" in text:
        print("ok:", name)
        continue
    lines = text.splitlines(keepends=True)
    out = []
    inserted = False
    for line in lines:
        out.append(line)
        if not inserted and (
            "naviyra-deny-sensitive.conf" in line
            or "client_max_body_size" in line
            or "naviyra-terminal-ws.conf" in line
        ):
            out.append(include)
            inserted = True
    new = "".join(out)
    if include not in new:
        rebuilt = []
        inserted = False
        for line in lines:
            if not inserted and (
                line.lstrip().startswith("location /")
                or "proxy_pass" in line
            ):
                rebuilt.append(include)
                inserted = True
            rebuilt.append(line)
        new = "".join(rebuilt)
    conf.write_text(new)
    print("patched:", name)
PY

nginx -t
systemctl reload nginx

echo "=== verify 404 page ==="
body=$(curl -sk --resolve kongunattugounder.com:443:127.0.0.1 https://kongunattugounder.com/this-page-does-not-exist-xyz || true)
echo "$body" | head -n 5
echo "$body" | grep -q "Page Not Found\|Naviyra Hosting" && echo CUSTOM_404_OK || echo CUSTOM_404_CHECK
echo DONE
