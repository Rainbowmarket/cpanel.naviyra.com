#!/usr/bin/env bash
# Install hourly host alert timer (CPU/RAM/disk/agent → admin email)
# and minutely security alerts (new public ports + root SSH logins).
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

SRC_SEC="$ROOT/scripts/check-security-alerts.sh"
DST_SEC="$PANEL_ROOT/scripts/check-security-alerts.sh"
if [ "$(realpath "$SRC_SEC" 2>/dev/null || echo "$SRC_SEC")" != "$(realpath "$DST_SEC" 2>/dev/null || echo "$DST_SEC")" ]; then
  install -m 0755 "$SRC_SEC" "$DST_SEC"
else
  chmod 0755 "$DST_SEC"
fi
sed -i 's/\r$//' "$DST_SEC" 2>/dev/null || true
if [ "$PANEL_ROOT" != "/opt/naviyra-panel" ]; then
  sed -i "s|/opt/naviyra-panel|${PANEL_ROOT}|g" "$DST_SEC" 2>/dev/null || true
fi
install -m 0644 "$ROOT/scripts/systemd/naviyra-security-alerts.service" /etc/systemd/system/naviyra-security-alerts.service
install -m 0644 "$ROOT/scripts/systemd/naviyra-security-alerts.timer" /etc/systemd/system/naviyra-security-alerts.timer
sed -i "s|/opt/naviyra-panel|${PANEL_ROOT}|g" /etc/systemd/system/naviyra-security-alerts.service

systemctl daemon-reload
systemctl enable --now naviyra-host-alerts.timer
systemctl enable --now naviyra-security-alerts.timer
echo "Installed and enabled naviyra-host-alerts.timer and naviyra-security-alerts.timer"
echo "  systemctl list-timers naviyra-host-alerts.timer naviyra-security-alerts.timer"
echo "  systemctl start naviyra-host-alerts.service     # run host check once now"
echo "  systemctl start naviyra-security-alerts.service   # run security check once now"
