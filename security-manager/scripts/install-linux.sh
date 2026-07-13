#!/usr/bin/env bash
# Naviyra Visitor & Security Manager — Linux install script
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_NAME="${DB_NAME:-naviyra_security}"
DB_USER="${DB_USER:-naviyra_sec}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24)}"

echo "==> Naviyra Security Manager install"
echo "    Root: $ROOT"

if ! command -v mysql >/dev/null; then
  echo "MySQL client required. Install: apt install mysql-server"
  exit 1
fi

if ! command -v php >/dev/null; then
  echo "PHP 8.2+ required. Install: apt install php-cli php-mysql php-json"
  exit 1
fi

echo "==> Creating database and user"
sudo mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
sudo mysql -e "GRANT ALL ON ${DB_NAME}.* TO '${DB_USER}'@'localhost'; FLUSH PRIVILEGES;"

echo "==> Importing schema"
mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$ROOT/database/schema.sql"

if [ ! -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  JWT_SECRET=$(openssl rand -hex 32)
  INGEST_KEY=$(openssl rand -hex 24)
  sed -i "s/your_secure_password/${DB_PASS}/" "$ROOT/backend/.env"
  sed -i "s/change-this-to-a-long-random-secret-key-32chars/${JWT_SECRET}/" "$ROOT/backend/.env"
  sed -i "s/change-this-ingest-key/${INGEST_KEY}/" "$ROOT/backend/.env"
  echo "==> Created backend/.env"
fi

echo "==> Setting admin password (admin@naviyra.local)"
read -rsp "Enter new admin password: " ADMIN_PASS
echo
HASH=$(php -r "echo password_hash('${ADMIN_PASS}', PASSWORD_BCRYPT);")
mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e \
  "UPDATE admins SET password_hash='${HASH}' WHERE email='admin@naviyra.local';"

echo "==> Nginx blocked-IPs file"
sudo touch /etc/nginx/naviyra-blocked-ips.conf
sudo chmod 644 /etc/nginx/naviyra-blocked-ips.conf
echo "# Naviyra blocked IPs" | sudo tee /etc/nginx/naviyra-blocked-ips.conf >/dev/null

echo "==> Install complete"
echo ""
echo "Start PHP API:"
echo "  cd $ROOT/backend/public && php -S 127.0.0.1:8090"
echo ""
echo "Start React dashboard:"
echo "  cd $ROOT/frontend && npm install && npm run dev"
echo ""
echo "Log parser cron:"
echo "  * * * * * php $ROOT/scripts/log-parser.php /var/log/nginx/access.log"
echo ""
echo "Default login: admin@naviyra.local (password you just set)"
