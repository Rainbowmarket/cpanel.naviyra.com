#!/usr/bin/env bash
# Remote deploy steps after /tmp/naviyra-panel.tgz is uploaded.
set -euo pipefail

PANEL=/opt/naviyra-panel
cd "$PANEL"

# Preserve live .env / data across extract
ENV_BAK=/tmp/naviyra-panel.env.bak
cp -a .env "$ENV_BAK" 2>/dev/null || true
mkdir -p /tmp/naviyra-data-bak
if [ -d data ]; then
  rsync -a data/ /tmp/naviyra-data-bak/ 2>/dev/null || cp -a data/. /tmp/naviyra-data-bak/ 2>/dev/null || true
fi

tar -xzf /tmp/naviyra-panel.tgz -C "$PANEL"

# Restore .env
if [ -f "$ENV_BAK" ]; then
  cp -a "$ENV_BAK" .env
fi

# Ensure production ports / agent
grep -q '^PANEL_PORT=' .env || echo 'PANEL_PORT=3100' >> .env
grep -q '^AGENT_PORT=' .env || echo 'AGENT_PORT=4100' >> .env
sed -i 's|^PANEL_PORT=.*|PANEL_PORT=3100|' .env
sed -i 's|^AGENT_PORT=.*|AGENT_PORT=4100|' .env
sed -i 's|^AGENT_URL=.*|AGENT_URL=http://127.0.0.1:4100|' .env
grep -q '^AGENT_URL=' .env || echo 'AGENT_URL=http://127.0.0.1:4100' >> .env
sed -i 's|^AGENT_DRY_RUN=.*|AGENT_DRY_RUN=false|' .env
grep -q '^AGENT_DRY_RUN=' .env || echo 'AGENT_DRY_RUN=false' >> .env
grep -q '^NAVIYRA_NO_BROWSER=' .env || echo 'NAVIYRA_NO_BROWSER=true' >> .env
grep -q '^COOKIE_SECURE=' .env || echo 'COOKIE_SECURE=true' >> .env
grep -q '^AGENT_BIND_HOST=' .env || echo 'AGENT_BIND_HOST=127.0.0.1' >> .env
sed -i 's|^AGENT_BIND_HOST=.*|AGENT_BIND_HOST=127.0.0.1|' .env

# Rotate weak published agent key / ensure SESSION_SECRET
python3 - <<'PY'
from pathlib import Path
import secrets, re
p = Path(".env")
text = p.read_text() if p.exists() else ""
updates = {}
m = re.search(r"^AGENT_API_KEY=(.*)$", text, re.M)
cur = (m.group(1).strip().strip('"') if m else "")
weak_agent = (
    not cur
    or cur == "naviyra-local-agent-key"
    or cur.startswith("naviyra-local")
    or len(cur) < 16
    or cur in {"change-me", "secret", "password"}
)
if weak_agent:
    updates["AGENT_API_KEY"] = secrets.token_hex(32)
m2 = re.search(r"^SESSION_SECRET=(.*)$", text, re.M)
cur2 = (m2.group(1).strip().strip('"') if m2 else "")
weak_session = (
    not cur2
    or len(cur2) < 24
    or cur2.startswith("naviyra-local")
    or cur2 in {"change-me", "secret", "password"}
)
if weak_session:
    updates["SESSION_SECRET"] = secrets.token_hex(32)
lines = text.splitlines()
seen = set()
out = []
for line in lines:
    if not line.strip() or line.strip().startswith("#") or "=" not in line:
        out.append(line); continue
    k = line.split("=", 1)[0].strip()
    if k in updates:
        out.append(f"{k}={updates[k]}"); seen.add(k)
    else:
        out.append(line)
for k, v in updates.items():
    if k not in seen:
        out.append(f"{k}={v}")
p.write_text("\n".join(out) + "\n")
print("secrets:", ", ".join(updates) if updates else "unchanged")
PY

# Keep Server.agentKey in SQLite aligned with live AGENT_API_KEY (file manager / agent calls)
python3 - <<'PY'
import re, sqlite3
from pathlib import Path
from datetime import datetime, timezone
env = Path(".env").read_text()
m = re.search(r"^AGENT_API_KEY=(.*)$", env, re.M)
key = (m.group(1).strip().strip('"') if m else "")
db = Path("data/naviyra.db")
if not key or not db.exists():
    print("server_agent_keys_synced=skipped")
    raise SystemExit(0)
con = sqlite3.connect(db)
now = datetime.now(timezone.utc).isoformat()
# Drop unused Server rows so agentKey UNIQUE does not block sync
orphans = con.execute(
    """
    DELETE FROM Server
    WHERE id NOT IN (SELECT DISTINCT serverId FROM Domain WHERE serverId IS NOT NULL)
    """
).rowcount
# Prefer the server that already owns domains (oldest if several)
row = con.execute(
    """
    SELECT s.id FROM Server s
    JOIN Domain d ON d.serverId = s.id
    GROUP BY s.id
    ORDER BY MIN(s.createdAt) ASC
    LIMIT 1
    """
).fetchone()
if not row:
    row = con.execute("SELECT id FROM Server ORDER BY createdAt ASC LIMIT 1").fetchone()
updated = 0
if row:
    primary = row[0]
    # Temporarily clear other keys so UNIQUE allows assigning env key to primary
    others = con.execute("SELECT id FROM Server WHERE id != ?", (primary,)).fetchall()
    for (oid,) in others:
        placeholder = f"unused-{oid}"
        con.execute(
            "UPDATE Server SET agentKey=?, updatedAt=? WHERE id=?",
            (placeholder, now, oid),
        )
    updated = con.execute(
        "UPDATE Server SET agentKey=?, updatedAt=? WHERE id=?",
        (key, now, primary),
    ).rowcount
    # Point every domain at the primary server
    moved = con.execute(
        "UPDATE Domain SET serverId=? WHERE serverId != ?",
        (primary, primary),
    ).rowcount
else:
    moved = 0
con.commit()
con.close()
print(f"server_agent_keys_synced={updated} orphans_deleted={orphans} domains_moved={moved}")
PY

# BIND reload must be quoted for systemd EnvironmentFile
if grep -q '^BIND_RELOAD_CMD=' .env; then
  sed -i 's|^BIND_RELOAD_CMD=.*|BIND_RELOAD_CMD="rndc reload"|' .env
else
  echo 'BIND_RELOAD_CMD="rndc reload"' >> .env
fi
grep -q '^BIND_ZONES_DIR=' .env || echo 'BIND_ZONES_DIR=/etc/bind/zones' >> .env
grep -q '^BIND_NAMED_DIR=' .env || echo 'BIND_NAMED_DIR=/etc/bind/naviyra-zones.d' >> .env
grep -q '^BIND_INCLUDE_FILE=' .env || echo 'BIND_INCLUDE_FILE=/etc/bind/naviyra-zones.conf' >> .env

# Restore data if extract wiped it
if [ -d /tmp/naviyra-data-bak ] && [ "$(ls -A /tmp/naviyra-data-bak 2>/dev/null || true)" ]; then
  mkdir -p data
  rsync -a /tmp/naviyra-data-bak/ data/ || true
fi

echo "== npm install =="
npm install
(cd agent && npm install)

echo "== prisma =="
npx prisma generate
npx prisma db push

echo "== build =="
npm run build

echo "== backup worker units =="
chmod +x scripts/install-backup-worker.sh scripts/backup-worker.sh
./scripts/install-backup-worker.sh "$PANEL"

echo "== expire auto-blocks timer =="
chmod +x scripts/install-expire-auto-blocks.sh scripts/expire-auto-blocks.sh
./scripts/install-expire-auto-blocks.sh "$PANEL"

echo "== mail.* webmail proxies =="
chmod +x scripts/refresh-mail-proxies.sh scripts/provision-panel-mail.sh
./scripts/refresh-mail-proxies.sh "$PANEL" || true

echo "== panel mail host from .env (PANEL_HOSTNAME / MAIL_*) =="
./scripts/provision-panel-mail.sh "$PANEL" || true

# Terminal WS include if panel nginx exists
if [ -f /etc/nginx/sites-available/naviyra.uk ] || [ -f /etc/nginx/sites-enabled/naviyra-uk ]; then
  true
fi

systemctl daemon-reload
systemctl restart naviyra-panel
sleep 4
systemctl is-active naviyra-panel
curl -s -o /dev/null -w "panel_http=%{http_code}\n" http://127.0.0.1:3100/ || true

echo "== ensure panel mail host + MAIL_FROM in DB =="
set -a
# shellcheck disable=SC1091
source .env
set +a
npx tsx --tsconfig tsconfig.json scripts/ensure-panel-mail.ts || echo "ensure_panel_mail=warn"

echo "DEPLOY_OK"
