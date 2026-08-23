#!/usr/bin/env bash
# Enable nginx $host access logs + systemd timer for Security Manager visitors.
# Idempotent: skips apt-style work; does not rewind the ingest offset.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PANEL_ROOT="${1:-/opt/naviyra-panel}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

mkdir -p "$PANEL_ROOT/scripts" "$PANEL_ROOT/data" /etc/systemd/system /etc/nginx/conf.d

copy_file() {
  local src="$1" dest="$2" mode="$3"
  if [ ! -f "$src" ]; then
    return 0
  fi
  if [ -e "$dest" ] && [ "$src" -ef "$dest" ]; then
    chmod "$mode" "$dest" 2>/dev/null || true
    return 0
  fi
  install -m "$mode" "$src" "$dest"
}

# Always restore the websocket map — a previous visitor-log strip used to
# inject into the "http {}" comment and leave a dangling "}" .
MAP_SRC="$ROOT/scripts/nginx-websocket-map.conf"
if [ -f "$MAP_SRC" ]; then
  install -m 0644 "$MAP_SRC" /etc/nginx/conf.d/naviyra-websocket-map.conf
fi

python3 - <<'PY'
from pathlib import Path
import re
import subprocess

FMT_RE = re.compile(r"log_format\s+naviyra_visitors\b[\s\S]*?;")
ACCESS_RE = re.compile(r"[ \t]*access_log\s+\S+\s+naviyra_visitors\s*;[ \t]*\n?")
HTTP_OPEN_RE = re.compile(r"(?m)^(\s*)http\s*\{")

def strip_visitor_format(text: str) -> str:
    return ACCESS_RE.sub("", FMT_RE.sub("", text))

def patch_nginx_conf(path: Path) -> None:
    if not path.is_file():
        return
    orig = path.read_text(errors="replace")
    text = strip_visitor_format(orig)
    if HTTP_OPEN_RE.search(text) and not re.search(r"access_log\s+/var/log/nginx/access\.log", text):
        text = HTTP_OPEN_RE.sub(
            lambda m: m.group(0) + "\n    access_log /var/log/nginx/access.log;",
            text,
            count=1,
        )
    if text != orig:
        path.write_text(text)
        print("stripped visitor log_format from", path)

nginx_conf = Path("/etc/nginx/nginx.conf")
patch_nginx_conf(nginx_conf)

confd = Path("/etc/nginx/conf.d")
confd.mkdir(parents=True, exist_ok=True)

# Never rewrite conf.d snippets (websocket map, etc). Only strip the
# visitor format from site vhosts if a leftover copy was injected there.
sites = Path("/etc/nginx/sites-available")
if sites.is_dir():
    for path in sorted(sites.iterdir()):
        if not path.is_file():
            continue
        orig = path.read_text(errors="replace")
        text = FMT_RE.sub("", orig)
        if text != orig:
            path.write_text(text)
            print("stripped visitor log_format from", path)

body_full = (
    "log_format naviyra_visitors '$remote_addr - $remote_user [$time_local] \"$request\" '\n"
    "                      '$status $body_bytes_sent \"$http_referer\" \"$http_user_agent\" \"$host\"';\n"
    "access_log /var/log/nginx/naviyra-visitors.log naviyra_visitors;\n"
)
target = confd / "naviyra-visitors.conf"
target.write_text(body_full)

def nginx_err() -> tuple[bool, str]:
    import shutil
    if not shutil.which("nginx"):
        return True, "nginx not installed — skip nginx -t"
    r = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
    err = ((r.stderr or "") + (r.stdout or "")).strip()
    return r.returncode == 0, err

ok, err = nginx_err()
# Only drop our log_format if nginx reports THIS name is duplicated.
# Unrelated failures (corrupt websocket map, other syntax) must not strip
# the format — that produced "unknown log format naviyra_visitors".
if not ok and "duplicate" in err.lower() and "naviyra_visitors" in err:
    print("duplicate log_format naviyra_visitors — conf.d access_log only")
    target.write_text(
        "access_log /var/log/nginx/naviyra-visitors.log naviyra_visitors;\n"
    )
    ok, err = nginx_err()
if not ok:
    print(err)
    print("nginx -t failed after visitor-log install — continuing; timer will still be enabled")
else:
    print("nginx visitor log config ok")
PY

python3 - <<'PY'
from pathlib import Path
import os
line = "    access_log /var/log/nginx/naviyra-visitors.log naviyra_visitors;"
roots = [
    Path("/etc/nginx/sites-available"),
    Path("/etc/nginx/conf.d"),
]
seen = set()
for root in roots:
    if not root.is_dir():
        continue
    for path in sorted(root.iterdir()):
        if not path.is_file():
            continue
        try:
            st = path.stat()
            key = (st.st_dev, st.st_ino)
            if key in seen:
                continue
            seen.add(key)
        except OSError:
            continue
        if path.name in ("naviyra-visitors.conf", "naviyra-websocket-map.conf"):
            continue
        text = path.read_text(errors="replace")
        if "server" not in text or "{" not in text:
            continue
        parts = __import__("re").split(r"(server\s*\{)", text)
        out = [parts[0]]
        changed = False
        for i in range(1, len(parts), 2):
            header = parts[i]
            body = parts[i + 1] if i + 1 < len(parts) else ""
            has_log = __import__("re").search(r"(?m)^\s*access_log\s+", body) is not None
            if has_log and "naviyra-visitors.log" not in body:
                body = "\n" + line + body
                changed = True
            out.extend([header, body])
        if changed:
            path.write_text("".join(out))
            print("patched", path)
PY

touch /var/log/nginx/naviyra-visitors.log
chown www-data:adm /var/log/nginx/naviyra-visitors.log 2>/dev/null \
  || chown nginx:nginx /var/log/nginx/naviyra-visitors.log 2>/dev/null \
  || true
chmod 640 /var/log/nginx/naviyra-visitors.log 2>/dev/null || true

if command -v nginx >/dev/null 2>&1; then
  systemctl reload nginx || true
fi

ENV_FILE="$PANEL_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  if ! grep -q '^SECURITY_INGEST_KEY=' "$ENV_FILE"; then
    KEY=$(grep -E '^AGENT_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
    KEY="${KEY%\"}"
    KEY="${KEY#\"}"
    if [ -n "$KEY" ]; then
      echo "SECURITY_INGEST_KEY=$KEY" >> "$ENV_FILE"
    fi
  fi
fi

copy_file "$ROOT/scripts/visitor-ingest.sh" "$PANEL_ROOT/scripts/visitor-ingest.sh" 0755
copy_file "$ROOT/scripts/parse-nginx-visitors.mjs" "$PANEL_ROOT/scripts/parse-nginx-visitors.mjs" 0755
copy_file "$ROOT/scripts/nginx-naviyra-visitors.conf" "$PANEL_ROOT/scripts/nginx-naviyra-visitors.conf" 0644
sed -e "s|/opt/naviyra-panel|${PANEL_ROOT}|g" \
  "$ROOT/scripts/systemd/naviyra-visitor-ingest.service" \
  > /etc/systemd/system/naviyra-visitor-ingest.service
install -m 0644 "$ROOT/scripts/systemd/naviyra-visitor-ingest.timer" /etc/systemd/system/naviyra-visitor-ingest.timer

systemctl daemon-reload
systemctl enable --now naviyra-visitor-ingest.timer
systemctl start naviyra-visitor-ingest.service || true

echo "Visitor ingest enabled (every minute via OnCalendar=minutely)."
echo "  systemctl list-timers naviyra-visitor-ingest.timer"
echo "  journalctl -u naviyra-visitor-ingest.service -n 20"
