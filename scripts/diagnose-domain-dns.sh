#!/usr/bin/env bash
set -euo pipefail
echo "=== zones ==="
ls -la /etc/bind/zones/ /etc/bind/naviyra-zones.d/ || true
echo "=== include ==="
cat /etc/bind/naviyra-zones.conf || true
echo "=== dig local ==="
dig @127.0.0.1 kongunattugounder.com A +norecurse || true
echo "=== panel domains ==="
python3 - <<'PY'
import sqlite3
c = sqlite3.connect("/opt/naviyra-panel/data/naviyra.db")
try:
    print(c.execute("SELECT name FROM Domain").fetchall())
except Exception as e:
    print("err", e)
    print(c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall())
PY
echo "=== app dns zones ==="
ls -la /opt/naviyra-panel/data/dns/zones/ 2>/dev/null || echo none
