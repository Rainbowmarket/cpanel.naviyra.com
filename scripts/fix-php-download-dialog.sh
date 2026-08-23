#!/usr/bin/env bash
# Fix browser "download" on sites where .php is served as static/octet-stream
set -euo pipefail

fix_site() {
  local conf="$1"
  local root="$2"
  local name="$3"

  mkdir -p "$root"

  # Prefer a real HTML index; remove empty stub index.php that triggers downloads
  if [[ ! -s "$root/index.html" ]]; then
    cat > "$root/index.html" <<EOF
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name}</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0">
  <h1 style="margin:0 0 .5rem">${name}</h1>
  <p style="color:#94a3b8">Hosted on Naviyra Panel. Upload your site files to replace this page.</p>
</body>
</html>
EOF
  fi

  if [[ -f "$root/index.php" && ! -s "$root/index.php" ]]; then
    rm -f "$root/index.php"
    echo "removed empty index.php in $root"
  fi

  [[ -f "$conf" ]] || return 0

  # Prefer html indexes
  sed -i 's/index index.html index.htm index.php;/index index.html index.htm;/' "$conf"
  sed -i 's/index index.php index.html index.htm;/index index.html index.htm;/' "$conf"

  # Block raw .php downloads when no PHP-FPM location exists
  if ! grep -q 'fastcgi_pass' "$conf" && ! grep -q 'location ~ \\.php\$' "$conf"; then
    python3 - <<PY
from pathlib import Path
p = Path("$conf")
text = p.read_text()
deny = """
    location ~ \\.php$ {
        return 404;
    }
"""
if "location ~ \\.php$" in text:
    print("php location already present:", p)
else:
    # insert before last closing brace of https server if possible
    idx = text.rfind("location / {")
    if idx == -1:
        print("no location / in", p)
    else:
        # find end of that location block and insert after it
        end = text.find("}", idx)
        if end != -1:
            text = text[: end + 1] + "\n" + deny + text[end + 1 :]
            p.write_text(text)
            print("added php deny to", p)
PY
  fi
}

# Args: hostname [hostname ...]  (nginx sites-available file names).
# If none, patch every customer vhost and read document root from each file.
SKIP_SITES='^(default|default-ssl|naviyra-panel|hpanel)$'

root_from_conf() {
  awk '/^[[:space:]]*root[[:space:]]+/ { gsub(/;/, "", $2); print $2; exit }' "$1"
}

patch_one() {
  local host="$1"
  local conf="/etc/nginx/sites-available/${host}"
  local root
  root="$(root_from_conf "$conf" 2>/dev/null || true)"
  if [[ -z "$root" ]]; then
    echo "skip ${host}: no nginx site or root"
    return 0
  fi
  fix_site "$conf" "$root" "$host"
}

if (($# > 0)); then
  for host in "$@"; do
    patch_one "$host"
  done
else
  for conf in /etc/nginx/sites-available/*; do
    [[ -f "$conf" ]] || continue
    name="$(basename "$conf")"
    [[ "$name" =~ $SKIP_SITES ]] && continue
    [[ "$name" == *.bak ]] && continue
    patch_one "$name"
  done
fi

nginx -t
systemctl reload nginx

echo "=== verify (pass hostnames as args to check specific sites) ==="
for host in "$@"; do
  echo "--- ${host} ---"
  curl -sI "https://${host}/" | head -n 10 || true
done
