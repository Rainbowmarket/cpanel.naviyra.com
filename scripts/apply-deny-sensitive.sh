#!/usr/bin/env bash
# Apply / refresh Naviyra "htaccess-equivalent" nginx deny rules on all sites.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNIP_SRC="$ROOT/scripts/nginx-deny-sensitive.conf"
SNIP_DST="/etc/nginx/snippets/naviyra-deny-sensitive.conf"
INCLUDE_LINE='    include /etc/nginx/snippets/naviyra-deny-sensitive.conf;'

mkdir -p /etc/nginx/snippets
cp -f "$SNIP_SRC" "$SNIP_DST"
chmod 644 "$SNIP_DST"

python3 - <<'PY'
from pathlib import Path
include = "    include /etc/nginx/snippets/naviyra-deny-sensitive.conf;\n"
skip_exact = {"naviyra.uk", "naviyra-chat", "default"}
for conf in Path("/etc/nginx/sites-available").iterdir():
    if not conf.is_file():
        continue
    name = conf.name
    if name in skip_exact or name.startswith("default") or ".bak" in name:
        continue
    text = conf.read_text()
    if "root /var/www/" not in text and "try_files" not in text and "fastcgi_pass" not in text:
        continue
    if "naviyra-deny-sensitive.conf" in text:
        print("ok:", name)
        continue
    lines = text.splitlines(keepends=True)
    out = []
    for line in lines:
        out.append(line)
        if "client_max_body_size" in line:
            out.append(include)
    new = "".join(out)
    if include not in new:
        rebuilt = []
        inserted = False
        for line in lines:
            if not inserted and line.lstrip().startswith("location /"):
                rebuilt.append(include)
                inserted = True
            rebuilt.append(line)
        new = "".join(rebuilt)
    conf.write_text(new)
    print("patched:", name)
PY

nginx -t
systemctl reload nginx

echo "=== sample checks (kongunattugounder.com) ==="
for path in /env /.env /.htaccess /.git/HEAD /wp-config.php /uploads/shell.php; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve kongunattugounder.com:443:127.0.0.1 "https://kongunattugounder.com${path}" || echo err)
  echo "$path -> HTTP $code"
done
echo DONE
