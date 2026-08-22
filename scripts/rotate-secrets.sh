#!/usr/bin/env bash
# Rotate AGENT_API_KEY and SESSION_SECRET in .env; keep TWO_FACTOR_ENC_KEY unless --all.
# Usage: sudo bash scripts/rotate-secrets.sh [--all] [/path/to/panel]
set -euo pipefail

ALL=0
PANEL=""
for arg in "$@"; do
  if [[ "$arg" == "--all" ]]; then ALL=1
  else PANEL="$arg"
  fi
done
PANEL="${PANEL:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="$PANEL/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root so systemd units can be restarted." >&2
  exit 1
fi

backup="$ENV_FILE.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$ENV_FILE" "$backup"
echo "Backed up $ENV_FILE -> $backup"

new_agent=$(openssl rand -hex 32)
new_session=$(openssl rand -hex 32)
new_tfa=""
if [[ "$ALL" -eq 1 ]]; then
  new_tfa=$(openssl rand -hex 32)
fi

export ENV_FILE new_agent new_session new_tfa
python3 <<'PY'
import os, re
path = os.environ["ENV_FILE"]
text = open(path, encoding="utf-8").read()

def set_key(text, key, value):
    line = f"{key}={value}"
    if re.search(rf"^{re.escape(key)}=", text, re.M):
        return re.sub(rf"^{re.escape(key)}=.*$", line, text, count=1, flags=re.M)
    if text and not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"

text = set_key(text, "AGENT_API_KEY", os.environ["new_agent"])
text = set_key(text, "SESSION_SECRET", os.environ["new_session"])
if os.environ.get("new_tfa"):
    text = set_key(text, "TWO_FACTOR_ENC_KEY", os.environ["new_tfa"])
open(path, "w", encoding="utf-8").write(text)
print("Updated AGENT_API_KEY and SESSION_SECRET")
if os.environ.get("new_tfa"):
    print("Updated TWO_FACTOR_ENC_KEY — users must re-enroll 2FA")
PY

DB="$PANEL/data/naviyra.db"
if command -v sqlite3 >/dev/null && [[ -f "$DB" ]]; then
  sqlite3 "$DB" "UPDATE Server SET agentKey='$new_agent' WHERE agentUrl LIKE '%127.0.0.1%' OR agentUrl LIKE '%localhost%';" || true
  echo "Updated loopback Server.agentKey rows."
fi

echo
echo "Restart: systemctl restart naviyra-panel naviyra-agent"
echo "Everyone must sign in again."
if [[ "$ALL" -eq 1 ]]; then
  echo "2FA: users need to disable and set up 2FA again."
fi
