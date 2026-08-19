#!/usr/bin/env bash
# Install WebSocket map + harden existing reverse-proxy vhosts for Upgrade.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAP_SRC="$ROOT/scripts/nginx-websocket-map.conf"
MAP_DST="/etc/nginx/conf.d/naviyra-websocket-map.conf"

if [ ! -d /etc/nginx ]; then
  echo "install-websocket-map: nginx not installed — skip"
  exit 0
fi

mkdir -p /etc/nginx/conf.d
cp -f "$MAP_SRC" "$MAP_DST"
chmod 644 "$MAP_DST"
echo "install-websocket-map: wrote $MAP_DST"

PANEL_ROOT="${1:-$ROOT}"
if [ -f "$ROOT/scripts/install-nginx-snippets.sh" ]; then
  bash "$ROOT/scripts/install-nginx-snippets.sh" "$PANEL_ROOT" || true
fi

# Only touch this panel's vhost — leftover customer sites (e.g. mail.olddomain)
# stay untouched and are not printed.
PANEL_HOSTNAME=""
if [ -f "$PANEL_ROOT/.env" ]; then
  PANEL_HOSTNAME="$(grep -E '^PANEL_HOSTNAME=' "$PANEL_ROOT/.env" | head -1 | cut -d= -f2- || true)"
  PANEL_HOSTNAME="${PANEL_HOSTNAME%\"}"
  PANEL_HOSTNAME="${PANEL_HOSTNAME#\"}"
  PANEL_HOSTNAME="${PANEL_HOSTNAME%\'}"
  PANEL_HOSTNAME="${PANEL_HOSTNAME#\'}"
fi
export PANEL_HOSTNAME

python3 - <<'PY'
from pathlib import Path
import os
import re

panel = os.environ.get("PANEL_HOSTNAME", "").strip().lower().replace("www.", "", 1)
sites = Path("/etc/nginx/sites-available")
if not sites.is_dir():
    raise SystemExit(0)

def is_this_panel_vhost(name: str, text: str) -> bool:
    n = name.lower()
    if ".bak" in n or n.startswith("default"):
        return False
    if "# Naviyra Panel" in text or "naviyra-terminal-ws.conf" in text:
        return True
    if not panel:
        return False
    return n == panel or n == f"www.{panel}"

patched = 0
for conf in sorted(sites.iterdir()):
    if not conf.is_file():
        continue
    text = conf.read_text(encoding="utf-8", errors="replace")
    if not is_this_panel_vhost(conf.name, text):
        continue
    if "Upgrade $http_upgrade" not in text:
        continue

    new = text
    new = new.replace(
        'proxy_set_header Connection "upgrade";',
        "proxy_set_header Connection $connection_upgrade;",
    )
    new = new.replace(
        "proxy_set_header Connection 'upgrade';",
        "proxy_set_header Connection $connection_upgrade;",
    )

    if "Upgrade $http_upgrade" in new:
        new = re.sub(r"proxy_read_timeout\s+300s;", "proxy_read_timeout 3600s;", new)

    if (
        "Upgrade $http_upgrade" in new
        and "proxy_send_timeout" not in new
        and "proxy_read_timeout 3600s;" in new
    ):
        new = new.replace(
            "proxy_read_timeout 3600s;",
            "proxy_read_timeout 3600s;\n        proxy_send_timeout 3600s;",
            1,
        )

    if new != text:
        conf.write_text(new, encoding="utf-8")
        patched += 1
        print(f"install-websocket-map: patched panel vhost {conf.name}")

print(f"install-websocket-map: patched={patched}")
PY

if nginx -t; then
  systemctl reload nginx
  echo "install-websocket-map: nginx reloaded"
else
  echo "install-websocket-map: nginx -t FAILED — map file was still written; not reloading" >&2
  exit 0
fi
