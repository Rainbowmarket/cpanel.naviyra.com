#!/usr/bin/env bash
# Install hourly host alert timer (CPU/RAM/disk/agent → admin email).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PANEL_ROOT="${1:-/opt/naviyra-panel}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

mkdir -p "$PANEL_ROOT/scripts" /etc/systemd/system

SRC_SCRIPT="$ROOT/scripts/check-host-alerts.sh"
DST_SCRIPT="$PANEL_ROOT/scripts/check-host-alerts.sh"
if [ "$(realpath "$SRC_SCRIPT" 2>/dev/null || echo "$SRC_SCRIPT")" != "$(realpath "$DST_SCRIPT" 2>/dev/null || echo "$DST_SCRIPT")" ]; then
  install -m 0755 "$SRC_SCRIPT" "$DST_SCRIPT"
else
  chmod 0755 "$DST_SCRIPT"
fi

install -m 0644 "$ROOT/scripts/systemd/naviyra-host-alerts.service" /etc/systemd/system/naviyra-host-alerts.service
install -m 0644 "$ROOT/scripts/systemd/naviyra-host-alerts.timer" /etc/systemd/system/naviyra-host-alerts.timer

systemctl daemon-reload
systemctl enable --now naviyra-host-alerts.timer
echo "Installed and enabled naviyra-host-alerts.timer"
echo "  systemctl list-timers naviyra-host-alerts.timer"
echo "  systemctl start naviyra-host-alerts.service   # run once now"
