#!/usr/bin/env bash
# Install Postfix + Dovecot virtual mailbox stack for Naviyra Panel
# Usage: sudo ./scripts/install-mail.sh [MAIL_HOSTNAME] [PUBLIC_IP]
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./scripts/install-mail.sh"
  exit 1
fi

MAIL_HOSTNAME="${1:-$(hostname -f 2>/dev/null || hostname)}"
PUBLIC_IP="${2:-${SERVER_PUBLIC_IP:-}}"
VMAIL_UID=5000
VMAIL_GID=5000

echo "==> Installing Postfix + Dovecot (${MAIL_HOSTNAME})"
export DEBIAN_FRONTEND=noninteractive
# Pre-seed postfix
echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
echo "postfix postfix/mailname string ${MAIL_HOSTNAME}" | debconf-set-selections

apt-get update -qq
apt-get install -y postfix dovecot-core dovecot-imapd dovecot-lmtpd dovecot-pop3d ca-certificates

# vmail system user
if ! getent group vmail >/dev/null; then
  groupadd -g "${VMAIL_GID}" vmail
fi
if ! id vmail >/dev/null 2>&1; then
  useradd -g vmail -u "${VMAIL_UID}" -d /var/mail/vhosts -M -s /usr/sbin/nologin vmail
fi
mkdir -p /var/mail/vhosts
chown -R vmail:vmail /var/mail/vhosts
chmod 755 /var/mail/vhosts

touch /etc/postfix/virtual_mailbox_domains
touch /etc/postfix/virtual_mailbox_maps
touch /etc/dovecot/users
chmod 640 /etc/dovecot/users
chown root:dovecot /etc/dovecot/users
postmap /etc/postfix/virtual_mailbox_domains
postmap /etc/postfix/virtual_mailbox_maps

# --- Postfix ---
postconf -e "myhostname = ${MAIL_HOSTNAME}"
postconf -e "mydomain = ${MAIL_HOSTNAME#*.}"
postconf -e "myorigin = \$mydomain"
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"
postconf -e "mydestination = localhost"
postconf -e "mynetworks = 127.0.0.0/8 [::1]/128"
postconf -e "home_mailbox = Maildir/"
postconf -e "virtual_mailbox_domains = hash:/etc/postfix/virtual_mailbox_domains"
postconf -e "virtual_mailbox_maps = hash:/etc/postfix/virtual_mailbox_maps"
postconf -e "virtual_mailbox_base = /var/mail/vhosts"
postconf -e "virtual_minimum_uid = 100"
postconf -e "virtual_uid_maps = static:${VMAIL_UID}"
postconf -e "virtual_gid_maps = static:${VMAIL_GID}"
postconf -e "virtual_transport = lmtp:unix:private/dovecot-lmtp"
postconf -e "smtpd_banner = \$myhostname ESMTP"
postconf -e "biff = no"
postconf -e "append_dot_mydomain = no"
postconf -e "smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, defer_unauth_destination"
postconf -e "smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination"
postconf -e "smtpd_sasl_type = dovecot"
postconf -e "smtpd_sasl_path = private/auth"
postconf -e "smtpd_sasl_auth_enable = yes"
postconf -e "smtpd_sasl_security_options = noanonymous"
postconf -e "smtpd_sasl_local_domain = \$myhostname"
postconf -e "smtpd_tls_cert_file = /etc/ssl/certs/ssl-cert-snakeoil.pem"
postconf -e "smtpd_tls_key_file = /etc/ssl/private/ssl-cert-snakeoil.key"
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtpd_tls_auth_only = yes"
postconf -e "message_size_limit = 26214400"

# submission + smtps
cat > /etc/postfix/master.cf <<'EOF'
smtp      inet  n       -       y       -       -       smtpd
pickup    unix  n       -       y       60      1       pickup
cleanup   unix  n       -       y       -       0       cleanup
qmgr      unix  n       -       n       300     1       qmgr
tlsmgr    unix  -       -       y       1000?   1       tlsmgr
rewrite   unix  -       -       y       -       -       trivial-rewrite
bounce    unix  -       -       y       -       0       bounce
defer     unix  -       -       y       -       0       bounce
trace     unix  -       -       y       -       0       bounce
verify    unix  -       -       y       -       1       verify
flush     unix  n       -       y       1000?   0       flush
proxymap  unix  -       -       n       -       -       proxymap
proxywrite unix -       -       n       -       1       proxymap
smtp      unix  -       -       y       -       -       smtp
relay     unix  -       -       y       -       -       smtp
showq     unix  n       -       y       -       -       showq
error     unix  -       -       y       -       -       error
retry     unix  -       -       y       -       -       error
discard   unix  -       -       y       -       -       discard
local     unix  -       -       n       -       -       local
virtual   unix  -       -       n       -       -       virtual
lmtp      unix  -       -       y       -       -       lmtp
anvil     unix  -       -       y       -       1       anvil
scache    unix  -       -       y       -       1       scache

submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_tls_auth_only=yes
  -o smtpd_reject_unlisted_recipient=no
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING

smtps     inet  n       -       y       -       -       smtpd
  -o syslog_name=postfix/smtps
  -o smtpd_tls_wrappermode=yes
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_reject_unlisted_recipient=no
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING
EOF

# Prefer Let's Encrypt cert for mail host if present
if [ -f "/etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem" ]; then
  postconf -e "smtpd_tls_cert_file = /etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem"
  postconf -e "smtpd_tls_key_file = /etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem"
fi

# --- Dovecot ---
cat > /etc/dovecot/dovecot.conf <<EOF
protocols = imap lmtp pop3
listen = *, ::
base_dir = /var/run/dovecot/
instance_name = dovecot
login_greeting = Naviyra ready.

!include conf.d/*.conf
EOF

cat > /etc/dovecot/conf.d/10-mail.conf <<EOF
mail_location = maildir:/var/mail/vhosts/%d/%n
mail_uid = ${VMAIL_UID}
mail_gid = ${VMAIL_GID}
first_valid_uid = ${VMAIL_UID}
last_valid_uid = ${VMAIL_UID}
mail_privileged_group = vmail
namespace inbox {
  inbox = yes
}
EOF

cat > /etc/dovecot/conf.d/10-auth.conf <<EOF
disable_plaintext_auth = yes
auth_mechanisms = plain login
!include auth-passwdfile.conf.ext
EOF

cat > /etc/dovecot/conf.d/auth-passwdfile.conf.ext <<EOF
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT username_format=%u /etc/dovecot/users
}
userdb {
  driver = passwd-file
  args = username_format=%u /etc/dovecot/users
}
EOF

cat > /etc/dovecot/conf.d/10-master.conf <<EOF
service imap-login {
  inet_listener imap {
    port = 143
  }
  inet_listener imaps {
    port = 993
    ssl = yes
  }
}
service pop3-login {
  inet_listener pop3 {
    port = 110
  }
  inet_listener pop3s {
    port = 995
    ssl = yes
  }
}
service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
  unix_listener auth-userdb {
    mode = 0600
    user = vmail
    group = vmail
  }
  user = dovecot
}
service auth-worker {
  user = vmail
}
EOF

cat > /etc/dovecot/conf.d/10-ssl.conf <<EOF
ssl = required
ssl_cert = </etc/ssl/certs/ssl-cert-snakeoil.pem
ssl_key = </etc/ssl/private/ssl-cert-snakeoil.key
ssl_min_protocol = TLSv1.2
EOF

if [ -f "/etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem" ]; then
  cat > /etc/dovecot/conf.d/10-ssl.conf <<EOF
ssl = required
ssl_cert = </etc/letsencrypt/live/${MAIL_HOSTNAME}/fullchain.pem
ssl_key = </etc/letsencrypt/live/${MAIL_HOSTNAME}/privkey.pem
ssl_min_protocol = TLSv1.2
EOF
fi

# Firewall
if command -v ufw >/dev/null 2>&1; then
  ufw allow 25/tcp || true
  ufw allow 465/tcp || true
  ufw allow 587/tcp || true
  ufw allow 143/tcp || true
  ufw allow 993/tcp || true
  ufw allow 110/tcp || true
  ufw allow 995/tcp || true
fi

systemctl enable postfix dovecot
systemctl restart postfix
systemctl restart dovecot

echo ""
echo "Mail stack installed."
echo "  SMTP  : 25 / 587 (submission) / 465 (SMTPS)"
echo "  IMAP  : 143 / 993"
echo "  Host  : ${MAIL_HOSTNAME}"
echo "  Store : /var/mail/vhosts"
echo ""
echo "Create mailboxes via Naviyra Panel (or agent create_mail_account)."
echo "Existing accounts need a password reset in the panel to unlock IMAP/SMTP."
echo ""
ss -tlnp | grep -E ':25 |:465 |:587 |:143 |:993 ' || true
