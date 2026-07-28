#!/usr/bin/env bash
# Install mail stack + deploy agent mail module + provision existing accounts (locked until password reset)
set -euo pipefail

PANEL=/opt/naviyra-panel
MAIL_HOST="${1:-mail.kongunattugounder.com}"
PUBLIC_IP="${2:-136.243.196.166}"

sed -i 's/\r$//' "$PANEL/scripts/install-mail.sh"
chmod +x "$PANEL/scripts/install-mail.sh"
"$PANEL/scripts/install-mail.sh" "$MAIL_HOST" "$PUBLIC_IP"

# Provision every MailAccount email as a locked mailbox (user must reset password in panel)
python3 <<'PY'
import sqlite3, subprocess, os
c = sqlite3.connect("/opt/naviyra-panel/data/naviyra.db")
emails = [r[0] for r in c.execute("SELECT email FROM MailAccount").fetchall()]
print("accounts:", emails)
for email in emails:
    domain = email.split("@", 1)[1]
    local = email.split("@", 1)[0]
    home = f"/var/mail/vhosts/{domain}/{local}"
    os.makedirs(f"{home}/cur", exist_ok=True)
    os.makedirs(f"{home}/new", exist_ok=True)
    os.makedirs(f"{home}/tmp", exist_ok=True)
    subprocess.check_call(["chown", "-R", "5000:5000", home])
    subprocess.check_call(["chmod", "-R", "700", home])

# domains file
domains = sorted({e.split("@", 1)[1] for e in emails})
with open("/etc/postfix/virtual_mailbox_domains", "w") as f:
    for d in domains:
        f.write(f"{d} OK\n")
subprocess.check_call(["postmap", "/etc/postfix/virtual_mailbox_domains"])

with open("/etc/postfix/virtual_mailbox_maps", "w") as f:
    for e in emails:
        domain, local = e.split("@", 1)[1], e.split("@", 1)[0]
        f.write(f"{e} {domain}/{local}/\n")
subprocess.check_call(["postmap", "/etc/postfix/virtual_mailbox_maps"])

# locked dovecot users (*) until password reset
with open("/etc/dovecot/users", "w") as f:
    for e in emails:
        domain, local = e.split("@", 1)[1], e.split("@", 1)[0]
        home = f"/var/mail/vhosts/{domain}/{local}"
        f.write(f"{e}:*:5000:5000::{home}::\n")
os.chmod("/etc/dovecot/users", 0o640)
subprocess.check_call(["chown", "root:dovecot", "/etc/dovecot/users"])
print("provisioned", len(emails), "mailboxes (locked)")
PY

systemctl restart postfix dovecot
systemctl restart naviyra-panel

echo "=== status ==="
systemctl is-active postfix dovecot
ss -tlnp | grep -E ':25 |:465 |:587 |:143 |:993 ' || true
echo "=== users ==="
cat /etc/dovecot/users || true
echo "=== maps ==="
postmap -q kongunattugounder.com hash:/etc/postfix/virtual_mailbox_domains || true
postmap -q info@kongunattugounder.com hash:/etc/postfix/virtual_mailbox_maps || true
echo DONE
echo ""
echo "IMPORTANT: In Naviyra Panel → Mail, reset the password for info@kongunattugounder.com"
echo "so IMAP/SMTP login works (accounts are locked until reset)."
