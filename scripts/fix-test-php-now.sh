#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/www/kongunattugounder.com/subdomains/test/public_html
CONF=/etc/nginx/sites-available/test.kongunattugounder.com
cp /tmp/tmp-test-index.php "$ROOT/index.php"
chown www-data:www-data "$ROOT/index.php"
chmod 644 "$ROOT/index.php"
# remove any leftover html that could confuse testing
rm -f "$ROOT/index.html" "$ROOT/index.htm"
sed -i 's/index .*/index index.php index.html index.htm;/' "$CONF"
# Ensure php fastcgi block exists
if ! grep -q 'fastcgi_pass unix:/run/php/php8.3-fpm.sock' "$CONF"; then
  echo "ERROR: php fpm block missing in $CONF"
  exit 1
fi
# Remove any php deny return 404 blocks
python3 - <<'PY'
from pathlib import Path
import re
p = Path("/etc/nginx/sites-available/test.kongunattugounder.com")
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
systemctl is-active php8.3-fpm
echo "FILES:"; ls -la "$ROOT"
echo "HEADERS:"; curl -sI "https://test.kongunattugounder.com/index.php?nocache=$(date +%s)" | head -n 15
echo "BODY:"; curl -s "https://test.kongunattugounder.com/index.php?nocache=$(date +%s)" | head -n 15
