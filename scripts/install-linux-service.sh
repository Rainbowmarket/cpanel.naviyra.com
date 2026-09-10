#!/usr/bin/env bash
# Install Naviyra Panel as a systemd service on Linux
#
#   sudo ./scripts/install-linux-service.sh /opt/naviyra-panel
#   sudo ./scripts/install-linux-service.sh /opt/naviyra-panel --unit-only
#
# --unit-only: write/enable the unit only (npx installer already copied files + built).
# NODE_BIN / NODE_BIN_DIR: optional, set by the npx installer so systemd uses the same Node.
set -euo pipefail

INSTALL_DIR="/opt/naviyra-panel"
UNIT_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --unit-only) UNIT_ONLY=true ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) INSTALL_DIR="$arg" ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./scripts/install-linux-service.sh"
  exit 1
fi

mkdir -p "$INSTALL_DIR"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$(cd "$INSTALL_DIR" && pwd)"
# shellcheck source=scripts/panel-node.sh
. "$(cd "$(dirname "$0")" && pwd)/panel-node.sh"
naviyra_resolve_node

if [ "$UNIT_ONLY" = false ]; then
  echo "Installing Naviyra Panel to ${DEST} (runs as root for full hosting control)..."
  if [ "$SRC" != "$DEST" ]; then
    rsync -a --exclude node_modules --exclude .next --exclude data \
      "$SRC/" "$DEST/"
  fi
  cd "$DEST"
  apt-get install -y build-essential python3 >/dev/null 2>&1 || true
  npm_config_ignore_scripts=false "$PANEL_NODE_DIR/npm" install
  npm_config_ignore_scripts=false npm_config_foreground_scripts=true \
    "$PANEL_NODE_DIR/npm" rebuild better-sqlite3 --foreground-scripts
  "$PANEL_NODE_DIR/npm" run build
  (cd agent && "$PANEL_NODE_DIR/npm" install)
else
  echo "Registering systemd unit for ${DEST}…"
  cd "$DEST"
fi

sed -e "s|/opt/naviyra-panel|${DEST}|g" \
    -e "s|__NODE_BIN_DIR__|${PANEL_NODE_DIR}|g" \
    -e "s|__NODE_BIN__|${PANEL_NODE}|g" \
  scripts/naviyra-panel.service > /etc/systemd/system/naviyra-panel.service

systemctl daemon-reload
systemctl enable naviyra-panel
systemctl restart naviyra-panel

if [ -f "$DEST/scripts/install-postgres.sh" ]; then
  echo "Ensuring PostgreSQL (skips apt if already installed)…"
  chmod +x "$DEST/scripts/install-postgres.sh"
  bash "$DEST/scripts/install-postgres.sh" "$DEST"
fi

if [ -f "$DEST/scripts/install-nginx.sh" ]; then
  echo "Ensuring nginx…"
  chmod +x "$DEST/scripts/install-nginx.sh"
  bash "$DEST/scripts/install-nginx.sh" || true
fi

if [ -f "$DEST/scripts/install-websocket-map.sh" ]; then
  echo "Installing nginx WebSocket map…"
  chmod +x "$DEST/scripts/install-websocket-map.sh"
  bash "$DEST/scripts/install-websocket-map.sh" "$DEST" || true
fi

if [ -f "$DEST/scripts/install-visitor-ingest.sh" ]; then
  echo "Enabling Security visitor ingest…"
  chmod +x "$DEST/scripts/install-visitor-ingest.sh"
  bash "$DEST/scripts/install-visitor-ingest.sh" "$DEST" || true
fi

echo ""
echo "Naviyra Panel installed and started."
echo "  Node: ${PANEL_NODE} ($($PANEL_NODE -v))"
echo "  systemctl status naviyra-panel"
PANEL_PORT_MSG="3100"
if [ -f "$DEST/.env" ]; then
  PANEL_PORT_MSG="$(grep -E '^PANEL_PORT=' "$DEST/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)"
  PANEL_PORT_MSG="${PANEL_PORT_MSG:-3100}"
fi
echo "  Open: http://YOUR_SERVER_IP:${PANEL_PORT_MSG}"
