#!/usr/bin/env bash
# Drop a PHP probe page into a site document root (from panel path layout).
# Usage: sudo bash scripts/fix-test-php-now.sh example.com [subdomain]
set -euo pipefail

DOMAIN="${1:-}"
SUB="${2:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain> [subdomain]" >&2
  echo "  example: $0 example.com" >&2
  echo "  example: $0 example.com test" >&2
  exit 1
fi

if [[ -n "$SUB" ]]; then
  HOST="${SUB}.${DOMAIN}"
  ROOT="/var/www/${DOMAIN}/subdomains/${SUB}/public_html"
else
  HOST="$DOMAIN"
  ROOT="/var/www/${DOMAIN}/public_html"
fi
CONF="/etc/nginx/sites-available/${HOST}"

if [[ ! -d "$ROOT" ]]; then
  echo "Document root missing: $ROOT" >&2
  exit 1
fi
if [[ ! -f "$CONF" ]]; then
  echo "nginx site missing: $CONF (add the site in the panel first)" >&2
  exit 1
fi

cat > "$ROOT/index.php" <<'EOF'
<?php
header('Content-Type: text/html; charset=utf-8');
$host = $_SERVER['HTTP_HOST'] ?? '';
echo '<!doctype html><html><head><meta charset="utf-8"><title>PHP OK</title></head>';
echo '<body style="font-family:system-ui;padding:2rem">';
echo '<h1>PHP is running</h1>';
echo '<p>' . htmlspecialchars(PHP_VERSION) . ' on ' . htmlspecialchars($host) . '</p>';
echo '</body></html>';
EOF
chown www-data:www-data "$ROOT/index.php"
chmod 644 "$ROOT/index.php"
sed -i 's/index .*/index index.php index.html index.htm;/' "$CONF"

python3 - "$CONF" <<'PY'
from pathlib import Path
import re
import sys
p = Path(sys.argv[1])
text = p.read_text()
text2 = re.sub(
    r"\n\s*location ~ \\.php\$ \{\s*return 404;\s*\}\n",
    "\n",
    text,
)
p.write_text(text2)
print("cleaned deny blocks" if text2 != text else "no deny blocks")
PY

nginx -t
systemctl reload nginx
echo "FILES:"; ls -la "$ROOT"
echo "HEADERS:"; curl -sI "https://${HOST}/index.php?nocache=$(date +%s)" | head -n 15
echo "BODY:"; curl -s "https://${HOST}/index.php?nocache=$(date +%s)" | head -n 15
