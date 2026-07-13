#!/usr/bin/env bash
# Install Naviyra Panel as a systemd service on Linux
set -euo pipefail

INSTALL_DIR="${1:-/opt/naviyra-panel}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./scripts/install-linux-service.sh"
  exit 1
fi

echo "Installing Naviyra Panel to ${INSTALL_DIR} (runs as root for full hosting control)..."

mkdir -p "$INSTALL_DIR"
rsync -a --exclude node_modules --exclude .next --exclude data \
  "$(dirname "$0")/.." "$INSTALL_DIR/"

cd "$INSTALL_DIR"
npm install --omit=dev
npm run build
(cd agent && npm install --omit=dev)

sed "s|/opt/naviyra-panel|${INSTALL_DIR}|g" \
  scripts/naviyra-panel.service > /etc/systemd/system/naviyra-panel.service

systemctl daemon-reload
systemctl enable naviyra-panel
systemctl start naviyra-panel

echo ""
echo "Naviyra Panel installed and started."
echo "  systemctl status naviyra-panel"
echo "  Open: http://YOUR_SERVER_IP:3000"
