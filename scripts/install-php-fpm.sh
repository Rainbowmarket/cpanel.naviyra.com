#!/usr/bin/env bash
# Install PHP-FPM for Naviyra Panel nginx sites.
# Usage: sudo ./scripts/install-php-fpm.sh [8.3]
set -euo pipefail

PHP_VER="${1:-8.3}"

echo "==> Installing PHP ${PHP_VER} FPM + common extensions"
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

SOCK="/run/php/php${PHP_VER}-fpm.sock"
systemctl enable --now "php${PHP_VER}-fpm"

# Pool: allow nginx (www-data) to talk to FPM
POOL="/etc/php/${PHP_VER}/fpm/pool.d/www.conf"
if [[ -f "$POOL" ]]; then
  sed -i 's|^;*\s*listen.owner\s*=.*|listen.owner = www-data|' "$POOL"
  sed -i 's|^;*\s*listen.group\s*=.*|listen.group = www-data|' "$POOL"
  sed -i 's|^;*\s*listen.mode\s*=.*|listen.mode = 0660|' "$POOL"
  systemctl restart "php${PHP_VER}-fpm"
fi

# Optional env for Naviyra agent / panel
ENV_FILE="/opt/naviyra-panel/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^PHP_FPM_SOCKET=' "$ENV_FILE"; then
    sed -i "s|^PHP_FPM_SOCKET=.*|PHP_FPM_SOCKET=${SOCK}|" "$ENV_FILE"
  else
    echo "PHP_FPM_SOCKET=${SOCK}" >> "$ENV_FILE"
  fi
  echo "==> Set PHP_FPM_SOCKET=${SOCK} in ${ENV_FILE}"
  systemctl restart naviyra-panel 2>/dev/null || true
fi

echo ""
echo "PHP-FPM ready."
echo "  Socket : ${SOCK}"
echo "  Status : $(systemctl is-active "php${PHP_VER}-fpm")"
echo ""
echo "Next:"
echo "  1. Deploy updated agent (nginx PHP location blocks)."
echo "  2. Re-save / Retry domain or subdomain in panel so nginx rewrites the vhost,"
echo "     or renew SSL (also rewrites HTTPS config with PHP)."
echo "  3. Upload index.php to public_html and open the site."
