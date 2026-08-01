#!/usr/bin/env bash
# Install and configure vsftpd for Naviyra panel FTP accounts.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-ftp: apt-get required" >&2
  exit 1
fi

apt-get update -qq
apt-get install -y -qq vsftpd

groupadd --system naviyra-ftp 2>/dev/null || true
mkdir -p /var/run/vsftpd/empty
touch /etc/vsftpd.user_list

# vsftpd rejects users whose shell is missing from /etc/shells
for shell in /usr/sbin/nologin /sbin/nologin /bin/false; do
  if [ -x "$shell" ] && ! grep -qxF "$shell" /etc/shells 2>/dev/null; then
    echo "$shell" >> /etc/shells
  fi
done

PASV_IP="${SERVER_PUBLIC_IP:-}"
if [ -z "$PASV_IP" ] && [ -f /opt/naviyra-panel/.env ]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  source /opt/naviyra-panel/.env
  set +a
  PASV_IP="${SERVER_PUBLIC_IP:-}"
fi

if [ -f /etc/vsftpd.conf ] && [ ! -f /etc/vsftpd.conf.naviyra.bak ]; then
  cp -a /etc/vsftpd.conf /etc/vsftpd.conf.naviyra.bak
fi

cat >/etc/vsftpd.conf <<EOF
listen=YES
listen_ipv6=NO
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES
xferlog_enable=YES
connect_from_port_20=YES
chroot_local_user=YES
allow_writeable_chroot=YES
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
userlist_enable=YES
userlist_file=/etc/vsftpd.user_list
userlist_deny=NO
pasv_enable=YES
pasv_min_port=40000
pasv_max_port=40100
$( [ -n "$PASV_IP" ] && echo "pasv_address=${PASV_IP}" )
ssl_enable=NO
EOF

systemctl enable --now vsftpd
systemctl restart vsftpd

if command -v ufw >/dev/null 2>&1; then
  ufw allow 21/tcp || true
  ufw allow 40000:40100/tcp || true
fi

echo "install-ftp: vsftpd active=$(systemctl is-active vsftpd) pasv=${PASV_IP:-unset}"
ss -lntp | grep ':21 ' || true
