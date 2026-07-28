#!/usr/bin/env bash
set -euo pipefail
DOMAIN=kongunattugounder.com
MAILHOST=mail.kongunattugounder.com
IP=136.243.196.166

echo "=== DNS (local BIND) ==="
dig @127.0.0.1 "$DOMAIN" MX +short
dig @127.0.0.1 "$MAILHOST" A +short

echo "=== DNS (Google 8.8.8.8) ==="
dig @8.8.8.8 "$DOMAIN" MX +short
dig @8.8.8.8 "$MAILHOST" A +short

echo "=== Postfix/Dovecot status ==="
systemctl is-active postfix dovecot
postconf myhostname virtual_mailbox_domains virtual_mailbox_maps virtual_transport inet_interfaces mynetworks smtpd_recipient_restrictions

echo "=== maps ==="
postmap -q "$DOMAIN" hash:/etc/postfix/virtual_mailbox_domains || echo "domain NOT in maps"
postmap -q "info@$DOMAIN" hash:/etc/postfix/virtual_mailbox_maps || echo "mailbox NOT in maps"
cat /etc/postfix/virtual_mailbox_domains
cat /etc/postfix/virtual_mailbox_maps
cat /etc/dovecot/users

echo "=== listening ==="
ss -tlnp | grep -E ':25 |:465 |:587 '

echo "=== ufw ==="
ufw status | grep -E '25|465|587' || true

echo "=== local SMTP probe to info@ ==="
printf 'EHLO test.local\r\nMAIL FROM:<probe@example.com>\r\nRCPT TO:<info@%s>\r\nQUIT\r\n' "$DOMAIN" | timeout 8 nc -v 127.0.0.1 25 || true

echo "=== recent mail logs ==="
journalctl -u postfix -u dovecot --no-pager -n 80 2>/dev/null || tail -80 /var/log/mail.log 2>/dev/null || tail -80 /var/log/syslog | grep -iE 'postfix|dovecot|smtp' || true

echo "=== queue ==="
mailq || true

echo "=== maildir ==="
ls -la /var/mail/vhosts/$DOMAIN/info/new /var/mail/vhosts/$DOMAIN/info/cur 2>/dev/null || true
find /var/mail/vhosts/$DOMAIN/info -type f 2>/dev/null | head
