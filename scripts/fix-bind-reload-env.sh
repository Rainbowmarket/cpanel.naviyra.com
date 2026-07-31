#!/usr/bin/env bash
# Fix BIND_RELOAD_CMD quoting for systemd EnvironmentFile (spaces need quotes).
set -euo pipefail
ENV_FILE="${1:-/opt/naviyra-panel/.env}"

python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text() if path.exists() else ""
lines = []
found = False
for line in text.splitlines():
    if line.startswith("BIND_RELOAD_CMD="):
        lines.append('BIND_RELOAD_CMD="rndc reload"')
        found = True
    else:
        lines.append(line)
if not found:
    lines.append('BIND_RELOAD_CMD="rndc reload"')
path.write_text("\n".join(lines) + "\n")
print(path, "updated")
PY

grep '^BIND_RELOAD_CMD=' "$ENV_FILE"
systemctl restart naviyra-panel
sleep 2
systemctl is-active naviyra-panel
rndc reload
echo "rndc reload ok"
