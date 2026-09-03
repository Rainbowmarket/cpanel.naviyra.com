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
# HTTP://IP:3100 cannot keep a Secure cookie — do not force COOKIE_SECURE=true
if grep -q '^COOKIE_SECURE=' .env; then
  sed -i 's|^COOKIE_SECURE=true|COOKIE_SECURE=false|' .env
else
  echo 'COOKIE_SECURE=false' >> .env
fi
grep -q '^AGENT_BIND_HOST=' .env || echo 'AGENT_BIND_HOST=127.0.0.1' >> .env
sed -i 's|^AGENT_BIND_HOST=.*|AGENT_BIND_HOST=127.0.0.1|' .env

# Docs example hpanel.yourdomain.com is not a real host.
# Live .env can contain DUPLICATE keys; Node/bash use the LAST assignment.
python3 - <<'PY'
from pathlib import Path
import re

p = Path(".env")
text = p.read_text() if p.exists() else ""

def is_placeholder(h):
    h = (h or "").lower()
    return (not h) or any(x in h for x in ("yourdomain.com", "example.com", "example.org")) or h == "localhost"

def host_only(v):
    v = (v or "").replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    return v[4:] if v.startswith("www.") else v

def strip_val(raw):
    return raw.strip().strip('"').strip("'")

# Last assignment wins, but skip docs-example panel hosts when a real one exists.
raw_vals = {}
for m in re.finditer(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", text, re.M):
    raw_vals.setdefault(m.group(1), []).append(strip_val(m.group(2)))

def all_vals(key):
    return raw_vals.get(key, [])

def last_real_host(*keys):
    found = None
    for key in keys:
        for v in all_vals(key):
            h = host_only(v)
            if h and not is_placeholder(h):
                found = h
    return found or ""

def last_any(key):
    vals = all_vals(key)
    return vals[-1] if vals else ""

panel = last_real_host("PANEL_HOSTNAME", "PANEL_PUBLIC_URL")
if not panel:
    panel = host_only(last_any("PANEL_HOSTNAME") or last_any("PANEL_PUBLIC_URL"))

ns1 = host_only(last_real_host("DNS_NS1") or last_any("DNS_NS1"))
if ns1.startswith("ns1."):
    ns1 = ns1[4:]
elif ns1.startswith("ns2."):
    ns1 = ns1[4:]
server = host_only(last_real_host("DEFAULT_SERVER_HOSTNAME") or last_any("DEFAULT_SERVER_HOSTNAME"))
for prefix in ("s1.", "server1."):
    if server.startswith(prefix):
        server = server[len(prefix):]
        break
apex = ""
if ns1 and "." in ns1 and not is_placeholder(ns1):
    apex = ns1
elif server and "." in server and not is_placeholder(server):
    apex = server
if not apex:
    nginx = Path("/etc/nginx/sites-available")
    if nginx.is_dir():
        for f in nginx.iterdir():
            n = f.name.lower()
            if n.startswith("hpanel.") and not is_placeholder(n):
                rest = n.split(".", 1)[1]
                if "." in rest:
                    apex = rest
                    break

if is_placeholder(panel) or (apex and panel == apex) or (not panel and apex):
    if not apex:
        print(f"panel_host={panel or 'unset'}")
        raise SystemExit(0)
    panel = f"hpanel.{apex}"

# Drop duplicate keys; keep first occurrence, rewrite panel keys.
secondary = last_real_host("SECONDARY_SERVER_HOSTNAME") or last_any("SECONDARY_SERVER_HOSTNAME")
if (not secondary or is_placeholder(secondary)) and apex:
    secondary = f"s2.{apex}"
wanted = {
    "PANEL_HOSTNAME": panel,
    "PANEL_PUBLIC_URL": f"https://{panel}" if panel and not is_placeholder(panel) else "",
    "NEXT_PUBLIC_TERMINAL_WS_URL": (
        f"wss://{panel}/terminal-ws/terminal" if panel and not is_placeholder(panel) else ""
    ),
    "SECONDARY_SERVER_HOSTNAME": secondary if secondary and not is_placeholder(secondary) else "",
}
seen = set()
out = []
for line in text.splitlines():
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
    if not m:
        out.append(line)
        continue
    key = m.group(1)
    if key in seen:
        continue
    seen.add(key)
    if key in wanted and wanted[key]:
        out.append(f"{key}={wanted[key]}")
    else:
        out.append(line)
for key, value in wanted.items():
    if value and key not in seen:
        out.append(f"{key}={value}")
        seen.add(key)
p.write_text("\n".join(out).rstrip() + "\n")
print(f"panel_host={panel or 'unset'}")
PY

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
m3 = re.search(r"^TWO_FACTOR_ENC_KEY=(.*)$", text, re.M)
cur3 = (m3.group(1).strip().strip('"') if m3 else "")
weak_2fa = (
    not cur3
    or len(cur3) < 32
    or cur3.startswith("naviyra-local")
    or cur3 in {"change-me", "secret", "password"}
)
if weak_2fa:
    updates["TWO_FACTOR_ENC_KEY"] = secrets.token_hex(32)
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

echo "== node =="
# Non-interactive PATH is Ubuntu node 18. Prefer nvm (already on this host).
if [ -d "${NVM_DIR:-/root/.nvm}/versions/node" ]; then
  NODE_BIN_DIR="$(ls -d "${NVM_DIR:-/root/.nvm}"/versions/node/v*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "${NODE_BIN_DIR:-}" ] && [ -x "$NODE_BIN_DIR/node" ]; then
    export PATH="$NODE_BIN_DIR:$PATH"
  fi
fi
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  chmod +x scripts/ensure-node.sh scripts/panel-node.sh 2>/dev/null || true
  set +u
  # shellcheck disable=SC1091
  source scripts/ensure-node.sh
  ensure_node
  set -u
fi
echo "using_node=$(command -v node) $(node -v)"

echo "== npm install =="
# npm 11+ rejects file: path overrides ("Invalid comparator: file:…")
python3 - <<'PY'
import json
from pathlib import Path
p = Path("package.json")
data = json.loads(p.read_text())
ov = data.get("overrides") or {}
if isinstance(ov.get("zeptomatch"), str) and ov["zeptomatch"].startswith("file:"):
    del ov["zeptomatch"]
    data["overrides"] = ov
    p.write_text(json.dumps(data, indent=2) + "\n")
    print("stripped_zeptomatch_file_override=1")
PY
npm install
(cd agent && npm install)

# Prisma 7 @prisma/dev requires zeptomatch via CJS; ESM 2.x breaks generate on Node 20.
if [ -d scripts/zeptomatch-cjs ]; then
  ZM_DEST="node_modules/@prisma/dev/node_modules/zeptomatch"
  mkdir -p "$(dirname "$ZM_DEST")"
  rm -rf "$ZM_DEST"
  cp -a scripts/zeptomatch-cjs "$ZM_DEST"
fi

echo "== prisma =="
npx prisma generate
npx prisma db push

echo "== build =="
npm run build

echo "== app runtimes (Node/PHP/Python/Go) =="
chmod +x scripts/install-runtimes.sh scripts/ensure-node.sh 2>/dev/null || true
./scripts/install-runtimes.sh || true

echo "== backup worker units =="
chmod +x scripts/install-backup-worker.sh scripts/backup-worker.sh
./scripts/install-backup-worker.sh "$PANEL"
systemctl enable --now naviyra-backup.timer 2>/dev/null || \
  systemctl enable --now naviyra-backup.timer 2>/dev/null || true

echo "== expire auto-blocks timer =="
chmod +x scripts/install-expire-auto-blocks.sh scripts/expire-auto-blocks.sh
./scripts/install-expire-auto-blocks.sh "$PANEL"

echo "== host alerts timer =="
chmod +x scripts/install-host-alerts.sh scripts/check-host-alerts.sh
./scripts/install-host-alerts.sh "$PANEL"

echo "== visitor ingest (Security live visitors) =="
chmod +x scripts/install-visitor-ingest.sh scripts/visitor-ingest.sh scripts/enable-visitor-ingest.sh 2>/dev/null || true
./scripts/install-visitor-ingest.sh "$PANEL" || echo "install-visitor-ingest=warn"
systemctl enable --now naviyra-visitor-ingest.timer 2>/dev/null || true
systemctl start naviyra-visitor-ingest.service 2>/dev/null || true

echo "== phpMyAdmin (MySQL Browse SSO) =="
chmod +x scripts/install-phpmyadmin.sh 2>/dev/null || true
# Idempotent: only needed when MySQL/MariaDB is used; safe to run always if PHP available.
if command -v php >/dev/null 2>&1 || [ -S /run/php/php8.3-fpm.sock ] || [ -S /run/php/php8.2-fpm.sock ]; then
  ./scripts/install-phpmyadmin.sh || echo "install-phpmyadmin=warn"
elif [ -d "$PANEL/phpmyadmin" ]; then
  ./scripts/install-phpmyadmin.sh || echo "install-phpmyadmin=warn"
else
  echo "install-phpmyadmin=skip (PHP-FPM not installed yet; install MySQL plugin or run scripts/install-phpmyadmin.sh)"
fi

echo "== phpPgAdmin (PostgreSQL Browse SSO) =="
chmod +x scripts/install-phppgadmin.sh 2>/dev/null || true
if command -v php >/dev/null 2>&1 || [ -S /run/php/php8.3-fpm.sock ] || [ -S /run/php/php8.2-fpm.sock ]; then
  ./scripts/install-phppgadmin.sh || echo "install-phppgadmin=warn"
elif [ -d "$PANEL/phppgadmin" ]; then
  ./scripts/install-phppgadmin.sh || echo "install-phppgadmin=warn"
else
  echo "install-phppgadmin=skip (PHP-FPM not installed yet; run scripts/install-phppgadmin.sh after PHP)"
fi

echo "== mail.* webmail proxies =="
chmod +x scripts/refresh-mail-proxies.sh scripts/provision-panel-mail.sh
./scripts/refresh-mail-proxies.sh "$PANEL" || true

echo "== mail (Postfix + Dovecot) =="
chmod +x scripts/install-mail.sh 2>/dev/null || true
./scripts/install-mail.sh || echo "install-mail=warn"

echo "== FTP (vsftpd) =="
chmod +x scripts/install-ftp.sh 2>/dev/null || true
./scripts/install-ftp.sh || echo "install-ftp=warn"

echo "== BIND DNS =="
chmod +x scripts/install-bind.sh 2>/dev/null || true
set -a
# shellcheck disable=SC1091
source .env
set +a
BIND_APEX="${BASE_DOMAIN:-}"
if [ -z "$BIND_APEX" ] && [ -n "${PANEL_HOSTNAME:-}" ]; then
  BIND_APEX="$(python3 -c "h='${PANEL_HOSTNAME}'.split('://')[-1].split('/')[0].split(':')[0]; p=h.split('.'); print('.'.join(p[1:] if len(p)>=3 else p))" 2>/dev/null || true)"
fi
if [ -n "${SERVER_PUBLIC_IP:-}" ] && [ -n "$BIND_APEX" ]; then
  ./scripts/install-bind.sh "$SERVER_PUBLIC_IP" "$BIND_APEX" || echo "install-bind=warn"
else
  echo "install-bind=skip (need SERVER_PUBLIC_IP and PANEL_HOSTNAME in .env)"
fi

echo "== certbot (Let's Encrypt) =="
if ! command -v certbot >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq certbot || echo "install-certbot=warn"
fi
command -v certbot && certbot --version || echo "certbot=missing"

echo "== nginx SSL snippets (options-ssl-nginx.conf fallback) =="
chmod +x scripts/install-nginx-snippets.sh 2>/dev/null || true
./scripts/install-nginx-snippets.sh "$PANEL" || true
if [ ! -f /etc/letsencrypt/ssl-dhparams.pem ]; then
  for conf in /etc/nginx/sites-available/*; do
    [ -f "$conf" ] || continue
    sed -i '/ssl_dhparam /d' "$conf" || true
  done
fi
nginx -t && systemctl reload nginx || true

echo "== PostgreSQL (customer DBs) =="
chmod +x scripts/install-postgres.sh
./scripts/install-postgres.sh "$PANEL" || true

echo "== WebSocket proxy map + harden customer vhosts =="
chmod +x scripts/install-websocket-map.sh
./scripts/install-websocket-map.sh "$PANEL" || true
npx tsx --tsconfig tsconfig.json scripts/regen-proxy-websocket-vhosts.ts || echo "regen_proxy_ws=warn"

echo "== panel mail host from .env (PANEL_HOSTNAME / MAIL_*) =="
./scripts/provision-panel-mail.sh "$PANEL" || true

# Terminal WS include if panel nginx exists
if [ -f /etc/nginx/sites-available/naviyra.uk ] || [ -f /etc/nginx/sites-enabled/naviyra-uk ]; then
  true
fi

# After extract / before restart — raise panel nginx upload limit
if [ -f /etc/nginx/sites-enabled/naviyra.uk ] || [ -f /etc/nginx/sites-available/naviyra.uk ]; then
  for conf in /etc/nginx/sites-enabled/naviyra.uk /etc/nginx/sites-available/naviyra.uk; do
    [ -f "$conf" ] || continue
    sed -i 's/client_max_body_size [0-9]\+[MmKkGg]\?;/client_max_body_size 512M;/' "$conf" || true
    grep -q 'client_max_body_size' "$conf" || sed -i '/server_name /a\    client_max_body_size 512M;' "$conf" || true
  done
  nginx -t && systemctl reload nginx || true
fi

echo "== panel nginx vhost (PANEL_HOSTNAME) =="
chmod +x scripts/setup-panel-https.sh 2>/dev/null || true
./scripts/setup-panel-https.sh || echo "setup-panel-https=warn"

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
