#!/usr/bin/env bash
# Install / verify runtimes for Naviyra multi-app hosting (PHP, Python, Go binaries).
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo $0"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Ensuring nginx + systemd"
apt-get update -y
apt-get install -y nginx

echo "==> PHP-FPM"
if [[ -x "$(dirname "$0")/install-php-fpm.sh" ]]; then
  bash "$(dirname "$0")/install-php-fpm.sh"
else
  apt-get install -y php-fpm php-cli php-mysql php-xml php-mbstring php-curl php-zip || true
fi

echo "==> Python 3 + venv + pip"
apt-get install -y python3 python3-venv python3-pip python3-dev

echo "==> Go toolchain (optional — panel runs prebuilt binaries; SDK helps local builds)"
apt-get install -y golang-go || true

echo "==> Runtime checks"
php -v | head -1 || echo "PHP missing"
python3 --version || echo "Python missing"
go version 2>/dev/null || echo "Go SDK not installed (upload prebuilt binaries is OK)"
nginx -v 2>&1 || true
systemctl --version | head -1

echo ""
echo "Done. App types:"
echo "  STATIC  — upload built React SPA to public_html"
echo "  PHP     — PHP-FPM via nginx"
echo "  PYTHON  — start command + systemd (PORT/HOST env)"
echo "  GO      — upload compiled binary; start command + systemd"
echo ""
echo "Proxy apps use ports 12000-12999 on 127.0.0.1 only (do not open in UFW)."
