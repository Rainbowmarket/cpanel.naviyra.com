#!/usr/bin/env bash
# Install PHP-FPM and enable PHP on existing Naviyra nginx sites.
set -euo pipefail

PHP_VER="${1:-8.3}"
SOCK="/run/php/php${PHP_VER}-fpm.sock"

echo "==> Installing php${PHP_VER}-fpm"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  "php${PHP_VER}-fpm" \
  "php${PHP_VER}-cli" \
  "php${PHP_VER}-common" \
  "php${PHP_VER}-mysql" \
  "php${PHP_VER}-pgsql" \
  "php${PHP_VER}-sqlite3" \
  "php${PHP_VER}-curl" \
  "php${PHP_VER}-gd" \
  "php${PHP_VER}-mbstring" \
  "php${PHP_VER}-xml" \
  "php${PHP_VER}-zip" \
  "php${PHP_VER}-bcmath" \
  "php${PHP_VER}-intl"

POOL="/etc/php/${PHP_VER}/fpm/pool.d/www.conf"
if [[ -f "$POOL" ]]; then
  sed -i 's|^;*\s*listen.owner\s*=.*|listen.owner = www-data|' "$POOL"
  sed -i 's|^;*\s*listen.group\s*=.*|listen.group = www-data|' "$POOL"
  sed -i 's|^;*\s*listen.mode\s*=.*|listen.mode = 0660|' "$POOL"
fi

systemctl enable --now "php${PHP_VER}-fpm"
systemctl restart "php${PHP_VER}-fpm"

# Panel env
ENV_FILE="/opt/naviyra-panel/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^PHP_FPM_SOCKET=' "$ENV_FILE"; then
    sed -i "s|^PHP_FPM_SOCKET=.*|PHP_FPM_SOCKET=${SOCK}|" "$ENV_FILE"
  else
    echo "PHP_FPM_SOCKET=${SOCK}" >> "$ENV_FILE"
  fi
fi

PHP_BLOCK=$(cat <<EOF
    location ~ \\.php\$ {
        try_files \$uri =404;
        fastcgi_split_path_info ^(.+\\.php)(/.+)\$;
        fastcgi_pass unix:${SOCK};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param PATH_INFO \$fastcgi_path_info;
        fastcgi_read_timeout 300;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }
EOF
)

enable_php_in_conf() {
  local conf="$1"
  [[ -f "$conf" ]] || return 0
  # Prefer html then php
  sed -i 's/index index.html index.htm;/index index.html index.htm index.php;/' "$conf"
  sed -i 's/index index.html index.htm index.php;/index index.html index.htm index.php;/' "$conf"

  # Replace deny-php block or insert FPM block
  python3 - <<PY
from pathlib import Path
import re
p = Path("$conf")
text = p.read_text()
block = '''$PHP_BLOCK'''

# remove previous deny or old php locations
text = re.sub(r"\n\s*location ~ \\\\.php\\\$ \{.*?\n\s*\}\n", "\n", text, flags=re.S)

# After each HTTPS server root/index section's location / block, add php once per server with root
parts = []
i = 0
# simpler: for each 'location / {' inside ssl servers, append php after that location if not present
if "fastcgi_pass" in text:
    p.write_text(text)
    print("already has fastcgi:", p)
else:
    # insert php block before the closing brace of each server that has 'root '
    out = []
    chunks = re.split(r"(?m)^(server \{)", text)
    # chunks[0] preamble, then pairs of 'server {' + body
    out.append(chunks[0])
    for i in range(1, len(chunks), 2):
        header = chunks[i]
        body = chunks[i+1] if i+1 < len(chunks) else ""
        if "listen 443" in body or "ssl" in body[:400] or "root " in body:
            # insert before final closing of this server — last lone }
            if "fastcgi_pass" not in body and "root " in body:
                # put before last }
                idx = body.rfind("}")
                body = body[:idx] + "\n" + block + "\n" + body[idx:]
                print("enabled php in server of", p)
        out.append(header + body)
    p.write_text("".join(out))
PY
}

for conf in /etc/nginx/sites-available/test.kongunattugounder.com \
            /etc/nginx/sites-available/kongunattugounder.com; do
  enable_php_in_conf "$conf"
done

# Sample index.php on test subdomain for verification
TEST_ROOT=/var/www/kongunattugounder.com/subdomains/test/public_html
mkdir -p "$TEST_ROOT"
if [[ ! -f "$TEST_ROOT/index.php" ]]; then
  cat > "$TEST_ROOT/index.php" <<'EOF'
<?php
header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><html><head><meta charset="utf-8"><title>PHP OK</title></head>';
echo '<body style="font-family:system-ui;padding:2rem;background:#0f172a;color:#e2e8f0">';
echo '<h1>PHP is running</h1>';
echo '<p>PHP ' . htmlspecialchars(PHP_VERSION) . ' on ' . htmlspecialchars($_SERVER['HTTP_HOST'] ?? '') . '</p>';
echo '<p><a href="/" style="color:#34d399">Home</a></p>';
echo '</body></html>';
EOF
fi

# Prefer index.php for a quick test? Keep html first so existing html still works.
# User wants index.php to run when they use it — requesting /index.php or putting php first.
# Use: index index.php index.html index.htm for test site only
sed -i 's/index index.html index.htm index.php;/index index.php index.html index.htm;/' \
  /etc/nginx/sites-available/test.kongunattugounder.com || true

nginx -t
systemctl reload nginx
systemctl restart naviyra-panel 2>/dev/null || true

echo ""
echo "PHP-FPM: $(systemctl is-active php${PHP_VER}-fpm)"
echo "Socket : ${SOCK}"
echo "Test   : curl -sI https://test.kongunattugounder.com/index.php"
curl -sI https://test.kongunattugounder.com/index.php | head -n 12
echo "--- body ---"
curl -s https://test.kongunattugounder.com/index.php | head -n 8
