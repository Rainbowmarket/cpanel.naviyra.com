#!/usr/bin/env bash
# Install / verify runtimes for Naviyra multi-app hosting (Node, PHP, Python, Go).
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo $0"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Ensuring nginx + systemd"
apt-get update -y
apt-get install -y nginx

echo "==> Node.js 20+"
if [[ -x "$SCRIPT_DIR/ensure-node.sh" ]]; then
  bash "$SCRIPT_DIR/ensure-node.sh"
else
  if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)" -lt 20 ]]; then
    apt-get install -y ca-certificates curl gnupg
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
  fi
fi

echo "==> PHP-FPM"
if [[ -x "$SCRIPT_DIR/install-php-fpm.sh" ]]; then
  bash "$SCRIPT_DIR/install-php-fpm.sh"
else
  apt-get install -y php-fpm php-cli php-mysql php-xml php-mbstring php-curl php-zip || true
fi

echo "==> Python 3 + venv + pip"
apt-get install -y python3 python3-venv python3-pip python3-dev

echo "==> Go toolchain (optional — panel runs prebuilt binaries; SDK helps local builds)"
apt-get install -y golang-go || true

echo "==> Runtime checks"
node -v 2>/dev/null || echo "Node missing"
npm -v 2>/dev/null || echo "npm missing"
php -v | head -1 || echo "PHP missing"
python3 --version || echo "Python missing"
go version 2>/dev/null || echo "Go SDK not installed (upload prebuilt binaries is OK)"
nginx -v 2>&1 || true
systemctl --version | head -1

echo ""
echo "Done. App types:"
echo "  STATIC  — upload built React SPA to public_html"
echo "  PHP     — PHP-FPM via nginx"
echo "  NODE    — startup file (e.g. server.js) + systemd (PORT/HOST/NODE_ENV)"
echo "  PYTHON  — startup file or start command + systemd (PORT/HOST env)"
echo "  GO      — upload compiled binary; startup file or start command + systemd"
echo ""
echo "Proxy apps use ports 12000-12999 on 127.0.0.1 only (do not open in UFW)."
echo "Application root is a folder under the site document root (e.g. api or .)."
