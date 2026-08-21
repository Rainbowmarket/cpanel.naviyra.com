#!/usr/bin/env bash
# Deploy nameserver + panel DNS config on this host
# Base domain / NS hosts come from .env (PANEL_HOSTNAME or DNS_NS*) — not hardcoded.
set -euo pipefail
cd /opt/naviyra-panel

# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"
require_base_domain

PUBLIC_IP="${SERVER_PUBLIC_IP:-$(curl -4 -fsS ifconfig.me 2>/dev/null || echo 127.0.0.1)}"
NS1="${DNS_NS1:-ns1.${BASE_DOMAIN}}"
NS2="${DNS_NS2:-ns2.${BASE_DOMAIN}}"
SERVER_HOST="${DEFAULT_SERVER_HOSTNAME:-server1.${BASE_DOMAIN}}"

chmod +x scripts/install-bind.sh
./scripts/install-bind.sh "$PUBLIC_IP" "$BASE_DOMAIN"

python3 - <<PY
from pathlib import Path
p = Path("/opt/naviyra-panel/.env")
text = p.read_text() if p.exists() else ""
updates = {
    "DNS_NS1": "${NS1}",
    "DNS_NS2": "${NS2}",
    "SERVER_PUBLIC_IP": "${PUBLIC_IP}",
    "BIND_ZONES_DIR": "/etc/bind/zones",
    "BIND_NAMED_DIR": "/etc/bind/naviyra-zones.d",
    "BIND_INCLUDE_FILE": "/etc/bind/naviyra-zones.conf",
    "BIND_RELOAD_CMD": '"rndc reload"',
    "DEFAULT_SERVER_HOSTNAME": "${SERVER_HOST}",
    "LETSENCRYPT_EMAIL": "${LETSENCRYPT_EMAIL:-admin@${BASE_DOMAIN}}",
}
lines = text.splitlines()
keys = set()
out = []
for line in lines:
    if not line.strip() or line.strip().startswith("#") or "=" not in line:
        out.append(line)
        continue
    k = line.split("=", 1)[0].strip()
    if k in updates:
        out.append(f"{k}={updates[k]}")
        keys.add(k)
    else:
        out.append(line)
for k, v in updates.items():
    if k not in keys:
        out.append(f"{k}={v}")
p.write_text("\\n".join(out) + "\\n")
print("env updated for", updates["PANEL_HOSTNAME"])
PY

cat > /etc/systemd/system/naviyra-panel.service <<EOF
[Unit]
Description=Naviyra Hosting Control Panel
After=network.target named.service
Wants=named.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/naviyra-panel
Environment=NODE_ENV=production
Environment=AGENT_DRY_RUN=false
Environment=NAVIYRA_NO_BROWSER=true
Environment=PANEL_PORT=${PANEL_PORT}
Environment=AGENT_PORT=${AGENT_PORT}
Environment=AGENT_URL=http://127.0.0.1:${AGENT_PORT}
Environment=PORT=${PANEL_PORT}
EnvironmentFile=-/opt/naviyra-panel/.env
ExecStart=/usr/bin/node launcher/index.mjs start --no-browser
ExecStop=/usr/bin/node launcher/stop.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl restart naviyra-panel
sleep 2
systemctl is-active named
systemctl is-active naviyra-panel
dig @127.0.0.1 "${NS1}" A +short
dig @127.0.0.1 "${BASE_DOMAIN}" NS +short
echo DONE
