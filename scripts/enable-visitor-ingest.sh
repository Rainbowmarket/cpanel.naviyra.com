#!/usr/bin/env bash
# Enable host-aware nginx access logs + cron for Security Manager visitors.
set -euo pipefail

PANEL_DIR="${PANEL_DIR:-/opt/naviyra-panel}"
PANEL_PORT="${PANEL_PORT:-3100}"

python3 <<'PY'
from pathlib import Path
p = Path("/etc/nginx/nginx.conf")
text = p.read_text()
changed = False
if "log_format naviyra_visitors" not in text:
    snippet = r'''
	## Naviyra visitor ingest (includes $host)
	log_format naviyra_visitors '$remote_addr - $remote_user [$time_local] "$request" '
	                  '$status $body_bytes_sent "$http_referer" '
	                  '"$http_user_agent" "$host"';
'''
    idx = text.find("http {")
    if idx < 0:
        raise SystemExit("http block not found")
    nl = text.find("\n", idx)
    text = text[: nl + 1] + snippet + text[nl + 1 :]
    changed = True
    print("added log_format naviyra_visitors")
else:
    print("log_format already present")

if "access_log /var/log/nginx/access.log naviyra_visitors" not in text:
    if "access_log /var/log/nginx/access.log;" in text:
        text = text.replace(
            "access_log /var/log/nginx/access.log;",
            "access_log /var/log/nginx/access.log naviyra_visitors;",
            1,
        )
        changed = True
        print("updated access_log format")
    else:
        # insert after http {
        idx = text.find("http {")
        nl = text.find("\n", idx)
        text = text[: nl + 1] + "\taccess_log /var/log/nginx/access.log naviyra_visitors;\n" + text[nl + 1 :]
        changed = True
        print("inserted access_log with naviyra_visitors")
else:
    print("access_log already uses naviyra_visitors")

if changed:
    p.write_text(text)
PY

nginx -t
systemctl reload nginx

ENV_FILE="$PANEL_DIR/.env"
KEY=$(grep -E '^AGENT_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
KEY=${KEY:-naviyra-local-agent-key}
grep -q '^SECURITY_INGEST_KEY=' "$ENV_FILE" || echo "SECURITY_INGEST_KEY=$KEY" >> "$ENV_FILE"
grep -q '^PANEL_URL=' "$ENV_FILE" || echo "PANEL_URL=http://127.0.0.1:${PANEL_PORT}" >> "$ENV_FILE"
# Prefer existing SECURITY_INGEST_KEY if set
KEY=$(grep -E '^SECURITY_INGEST_KEY=' "$ENV_FILE" | cut -d= -f2-)

CRON_CMD="cd $PANEL_DIR && PANEL_URL=http://127.0.0.1:${PANEL_PORT} SECURITY_INGEST_KEY=$KEY /usr/bin/node scripts/parse-nginx-visitors.mjs /var/log/nginx/access.log >> /var/log/naviyra-visitor-ingest.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'parse-nginx-visitors.mjs' || true; echo "* * * * * $CRON_CMD" ) | crontab -

systemctl restart naviyra-panel
sleep 3

# Seed offset at EOF so we don't flood with old noise; then generate one test hit
python3 - <<'PY'
import json, os, pathlib
log = pathlib.Path("/var/log/nginx/access.log")
state = pathlib.Path("/opt/naviyra-panel/data/nginx-visitor-offset.json")
state.parent.mkdir(parents=True, exist_ok=True)
size = log.stat().st_size if log.exists() else 0
inode = log.stat().st_ino if log.exists() else None
state.write_text(json.dumps({"offset": size, "inode": inode}))
print("state offset", size)
PY

# Generate a test request that will be logged with host
curl -sI -H 'Host: test.kongunattugounder.com' http://127.0.0.1/ >/dev/null || true
curl -skI --resolve test.kongunattugounder.com:443:127.0.0.1 https://test.kongunattugounder.com/ >/dev/null || true
sleep 1
cd "$PANEL_DIR"
PANEL_URL="http://127.0.0.1:${PANEL_PORT}" SECURITY_INGEST_KEY="$KEY" \
  node scripts/parse-nginx-visitors.mjs /var/log/nginx/access.log || true

echo "Visitor ingest enabled."
crontab -l | grep parse-nginx-visitors || true
tail -n 5 /var/log/naviyra-visitor-ingest.log 2>/dev/null || true
