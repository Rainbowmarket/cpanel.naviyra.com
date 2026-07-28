#!/usr/bin/env bash
set -euo pipefail
echo "=== mail packages/services ==="
systemctl is-active postfix 2>/dev/null || echo "postfix: not active"
systemctl is-active dovecot 2>/dev/null || echo "dovecot: not active"
dpkg -l postfix dovecot-core 2>/dev/null | awk '/^ii/ {print}' || true
echo "=== listening mail ports ==="
ss -tlnp | grep -E ':25 |:465 |:587 |:110 |:143 |:993 |:995 ' || echo "none"
echo "=== DNS MX/A ==="
dig @127.0.0.1 kongunattugounder.com MX +short || true
dig @127.0.0.1 mail.kongunattugounder.com A +short || true
echo "=== agent mail.map ==="
cat /opt/naviyra-panel/data/agent-config/mail.map 2>/dev/null || echo "(empty/missing)"
echo "=== panel MailAccount rows ==="
python3 <<'PY'
import sqlite3
c = sqlite3.connect("/opt/naviyra-panel/data/naviyra.db")
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
mail_tables = [t for t in tables if "ail" in t or "mail" in t.lower() or "Mail" in t]
print("mail-related tables:", mail_tables)
for t in mail_tables:
    cols = [r[1] for r in c.execute(f"PRAGMA table_info({t})").fetchall()]
    rows = c.execute(f"SELECT * FROM {t} LIMIT 10").fetchall()
    print(t, "cols=", cols)
    print(" rows=", rows)
PY
