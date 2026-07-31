#!/usr/bin/env bash
# Install hourly auto-block expiry timer (source=auto → unblock after 48h).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PANEL_ROOT="${1:-/opt/naviyra-panel}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

mkdir -p "$PANEL_ROOT/scripts" /etc/systemd/system

SRC_SCRIPT="$ROOT/scripts/expire-auto-blocks.sh"
DST_SCRIPT="$PANEL_ROOT/scripts/expire-auto-blocks.sh"
if [ "$(realpath "$SRC_SCRIPT" 2>/dev/null || echo "$SRC_SCRIPT")" != "$(realpath "$DST_SCRIPT" 2>/dev/null || echo "$DST_SCRIPT")" ]; then
  install -m 0755 "$SRC_SCRIPT" "$DST_SCRIPT"
else
  chmod 0755 "$DST_SCRIPT"
fi

install -m 0644 "$ROOT/scripts/systemd/naviyra-expire-blocks.service" /etc/systemd/system/naviyra-expire-blocks.service
install -m 0644 "$ROOT/scripts/systemd/naviyra-expire-blocks.timer" /etc/systemd/system/naviyra-expire-blocks.timer

if [ -f "$PANEL_ROOT/.env" ] && ! grep -q '^AUTO_BLOCK_TTL_HOURS=' "$PANEL_ROOT/.env"; then
  echo 'AUTO_BLOCK_TTL_HOURS=48' >> "$PANEL_ROOT/.env"
fi

systemctl daemon-reload
systemctl enable --now naviyra-expire-blocks.timer
echo "Installed and enabled naviyra-expire-blocks.timer"
echo "  systemctl list-timers naviyra-expire-blocks.timer"
echo "  systemctl start naviyra-expire-blocks.service   # run once now"
