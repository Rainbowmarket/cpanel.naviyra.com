#!/bin/bash
set -euo pipefail
cd /opt/naviyra-panel

python3 - <<'PY'
from pathlib import Path
lines = Path('.env').read_text().splitlines()
vals = {}
for line in lines:
    if '=' in line and not line.strip().startswith('#'):
        k, v = line.split('=', 1)
        vals[k.strip()] = v.strip().strip('"').strip("'")
agent = vals.get('AGENT_API_KEY') or 'naviyra-local-agent-key'
out = []
found = False
for line in lines:
    if line.startswith('SECURITY_INGEST_KEY='):
        out.append(f'SECURITY_INGEST_KEY={agent}')
        found = True
    else:
        out.append(line)
if not found:
    out.append(f'SECURITY_INGEST_KEY={agent}')
Path('.env').write_text('\n'.join(out) + '\n')
Path('/tmp/ingest.key').write_text(agent)
print('ingest key length', len(agent))
PY

KEY=$(cat /tmp/ingest.key)
rm -f /tmp/ingest.key

systemctl restart naviyra-panel
sleep 3

CRON_CMD="cd /opt/naviyra-panel && PANEL_URL=http://127.0.0.1:3100 SECURITY_INGEST_KEY=$KEY /usr/bin/node scripts/parse-nginx-visitors.mjs /var/log/nginx/access.log >> /var/log/naviyra-visitor-ingest.log 2>&1"
( crontab -l 2>/dev/null | grep -v parse-nginx-visitors || true; echo "* * * * * $CRON_CMD" ) | crontab -

curl -skI --resolve test.kongunattugounder.com:443:127.0.0.1 https://test.kongunattugounder.com/?visit=1 >/dev/null || true
curl -skI --resolve kongunattugounder.com:443:127.0.0.1 https://kongunattugounder.com/?visit=1 >/dev/null || true
sleep 1

PANEL_URL=http://127.0.0.1:3100 SECURITY_INGEST_KEY="$KEY" node scripts/parse-nginx-visitors.mjs /var/log/nginx/access.log

echo "--- visitor ingest log (tail) ---"
tail -n 20 /var/log/naviyra-visitor-ingest.log 2>/dev/null || true

echo "--- db files ---"
find /opt/naviyra-panel -name '*.db' 2>/dev/null | head -10

DB=$(find /opt/naviyra-panel -name 'naviyra.db' 2>/dev/null | head -1 || true)
if [ -n "$DB" ] && command -v sqlite3 >/dev/null; then
  echo "--- VisitorLog count ---"
  sqlite3 "$DB" "SELECT COUNT(*) FROM VisitorLog;" || true
  sqlite3 "$DB" "SELECT host, ip, path, createdAt FROM VisitorLog ORDER BY id DESC LIMIT 5;" || true
fi

echo "DONE"
