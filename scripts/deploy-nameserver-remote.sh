#!/usr/bin/env bash
# Deploy nameserver + panel DNS config on this host
set -euo pipefail
cd /opt/naviyra-panel

chmod +x scripts/install-bind.sh
./scripts/install-bind.sh 136.243.196.166 naviyra.uk

# Update .env keys (idempotent)
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/naviyra-panel/.env")
text = p.read_text() if p.exists() else ""
updates = {
    "DNS_NS1": "ns1.naviyra.uk",
    "DNS_NS2": "ns2.naviyra.uk",
    "SERVER_PUBLIC_IP": "136.243.196.166",
    "BIND_ZONES_DIR": "/etc/bind/zones",
    "BIND_NAMED_DIR": "/etc/bind/naviyra-zones.d",
    "BIND_INCLUDE_FILE": "/etc/bind/naviyra-zones.conf",
    "BIND_RELOAD_CMD": "rndc reload",
    "DEFAULT_SERVER_HOSTNAME": "server1.naviyra.uk",
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
p.write_text("\n".join(out) + "\n")
print("env updated")
PY

# Ensure systemd passes BIND env
cat > /etc/systemd/system/naviyra-panel.service <<'EOF'
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
Environment=PANEL_PORT=3100
Environment=AGENT_PORT=4100
Environment=AGENT_URL=http://127.0.0.1:4100
Environment=PORT=3100
Environment=DNS_NS1=ns1.naviyra.uk
Environment=DNS_NS2=ns2.naviyra.uk
Environment=SERVER_PUBLIC_IP=136.243.196.166
Environment=BIND_ZONES_DIR=/etc/bind/zones
Environment=BIND_NAMED_DIR=/etc/bind/naviyra-zones.d
Environment=BIND_INCLUDE_FILE=/etc/bind/naviyra-zones.conf
Environment=BIND_RELOAD_CMD=rndc reload
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
dig @127.0.0.1 ns1.naviyra.uk A +short
dig @127.0.0.1 naviyra.uk NS +short
echo DONE
