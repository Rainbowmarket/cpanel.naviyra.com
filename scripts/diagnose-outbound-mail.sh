#!/usr/bin/env bash
set -euo pipefail
EMAIL="${1:-info@kongunattugounder.com}"
TO="${2:-naveensubramani021@gmail.com}"

echo "=== postfix status ==="
systemctl is-active postfix
postconf myhostname inet_interfaces relayhost smtp_tls_security_level smtpd_relay_restrictions

echo "=== outbound port 25 test (to Gmail) ==="
timeout 8 bash -c 'echo >/dev/tcp/gmail-smtp-in.l.google.com/25' 2>/dev/null && echo "TCP 25 to Gmail: OK" || echo "TCP 25 to Gmail: BLOCKED/FAIL"

echo "=== sendmail test ==="
TMP=$(mktemp)
cat > "$TMP" <<EOF
From: ${EMAIL}
To: ${TO}
Subject: Naviyra outbound test $(date -u +%H:%M:%S)
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Outbound test from Naviyra mail stack at $(date -Is).
EOF
/usr/sbin/sendmail -t -i -f "$EMAIL" < "$TMP" && echo "sendmail accepted" || echo "sendmail FAILED"
rm -f "$TMP"

sleep 2
echo "=== mailq ==="
mailq || true

echo "=== recent logs ==="
journalctl -u postfix --no-pager -n 60 2>/dev/null | tail -60
grep -iE 'status=|relay=|to=<|reject|error|dsn=' /var/log/mail.log 2>/dev/null | tail -40 || true
grep -iE 'postfix.*(status=|relay=|to=<)' /var/log/syslog 2>/dev/null | tail -40 || true
