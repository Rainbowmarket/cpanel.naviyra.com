#!/usr/bin/env bash
# Install Backup Worker script + systemd units (timer managed from panel UI too).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PANEL_ROOT="${1:-/opt/naviyra-panel}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

mkdir -p "$PANEL_ROOT/scripts" /var/backups/naviyra /etc/systemd/system

if [ "$(realpath "$ROOT/scripts/backup-worker.sh")" != "$(realpath "$PANEL_ROOT/scripts/backup-worker.sh" 2>/dev/null || true)" ]; then
  install -m 0755 "$ROOT/scripts/backup-worker.sh" "$PANEL_ROOT/scripts/backup-worker.sh"
else
  chmod 0755 "$PANEL_ROOT/scripts/backup-worker.sh"
fi
install -m 0644 "$ROOT/scripts/systemd/naviyra-backup.service" /etc/systemd/system/naviyra-backup.service
install -m 0644 "$ROOT/scripts/systemd/naviyra-backup.timer" /etc/systemd/system/naviyra-backup.timer

# Ensure BACKUP_WORKER_TOKEN exists (reuse AGENT_API_KEY if unset)
if [ -f "$PANEL_ROOT/.env" ] && ! grep -q '^BACKUP_WORKER_TOKEN=' "$PANEL_ROOT/.env"; then
  KEY=$(grep -E '^AGENT_API_KEY=' "$PANEL_ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)
  KEY="${KEY:-naviyra-local-agent-key}"
  echo "BACKUP_WORKER_TOKEN=${KEY}" >> "$PANEL_ROOT/.env"
fi

systemctl daemon-reload
echo "Installed. Enable from Admin → Backups in the panel, or:"
echo "  systemctl enable --now naviyra-backup.timer"
echo "  systemctl list-timers naviyra-backup.timer"
echo "  systemctl start naviyra-backup.service   # run once now"
