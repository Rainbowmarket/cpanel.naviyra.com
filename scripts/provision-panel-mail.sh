#!/usr/bin/env bash
# Provision mail.{PANEL_HOSTNAME} from .env (any brand/domain — not hardcoded).
#
# Required / used env keys (from /opt/naviyra-panel/.env):
#   PANEL_HOSTNAME or PANEL_PUBLIC_URL
#   MAIL_HOSTNAME=mail.{domain}   (template)
#   SERVER_PUBLIC_IP
#   PANEL_PORT
#   LETSENCRYPT_EMAIL (optional)
#   MAIL_FROM         (optional — ensures system mailbox via agent)
#   AGENT_API_KEY / AGENT_PORT
#
# Public DNS must already point the mail host A record at SERVER_PUBLIC_IP
# (Cloudflare DNS-only, or ns1/ns2 BIND). Otherwise certbot is skipped with a warning.
set -euo pipefail

PANEL="${1:-/opt/naviyra-panel}"
ENV_FILE="$PANEL/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "panel_mail=skipped (no .env)"
  exit 0
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

resolve_panel_domain() {
  if [ -n "${PANEL_HOSTNAME:-}" ]; then
    echo "$PANEL_HOSTNAME" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*##; s#^www\.##'
    return
  fi
  if [ -n "${PANEL_PUBLIC_URL:-}" ]; then
    echo "$PANEL_PUBLIC_URL" | sed -E 's#^https?://##; s#/.*##; s#^www\.##' | tr '[:upper:]' '[:lower:]'
    return
  fi
  echo ""
}

PANEL_DOMAIN="$(resolve_panel_domain)"
if [ -z "$PANEL_DOMAIN" ]; then
  echo "panel_mail=skipped (set PANEL_HOSTNAME or PANEL_PUBLIC_URL in .env)"
  exit 0
fi

TEMPLATE="${MAIL_HOSTNAME:-mail.{domain}}"
MAIL_HOST="${TEMPLATE//\{domain\}/$PANEL_DOMAIN}"
PANEL_PORT="${PANEL_PORT:-3100}"
AGENT_PORT="${AGENT_PORT:-4100}"
EXPECTED_IP="${SERVER_PUBLIC_IP:-}"
LE_EMAIL="${LETSENCRYPT_EMAIL:-admin@${PANEL_DOMAIN}}"

echo "panel_mail domain=$PANEL_DOMAIN host=$MAIL_HOST"

mkdir -p /var/www/certbot

# Resolve public A for mail host
RESOLVED=""
if command -v dig >/dev/null 2>&1; then
  RESOLVED="$(dig +short A "$MAIL_HOST" @1.1.1.1 | head -n1 || true)"
elif command -v getent >/dev/null 2>&1; then
  RESOLVED="$(getent ahostsv4 "$MAIL_HOST" | awk '{print $1; exit}' || true)"
fi

if [ -z "$RESOLVED" ]; then
  echo "panel_mail=warn DNS for $MAIL_HOST does not resolve yet."
  echo "  Add A record: $MAIL_HOST → ${EXPECTED_IP:-YOUR_SERVER_IP} (DNS only if Cloudflare)."
  echo "  Re-run deploy (or this script) after DNS propagates."
  # Still write HTTP vhost so ACME works as soon as DNS points here
fi

if [ -n "$EXPECTED_IP" ] && [ -n "$RESOLVED" ] && [ "$RESOLVED" != "$EXPECTED_IP" ]; then
  echo "panel_mail=warn $MAIL_HOST resolves to $RESOLVED (expected $EXPECTED_IP)"
fi

write_http_vhost() {
  local host="$1"
  cat >"/etc/nginx/sites-available/$host" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
    client_max_body_size 64M;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF
  ln -sfn "/etc/nginx/sites-available/$host" "/etc/nginx/sites-enabled/$host"
}

if [ ! -d /etc/nginx ]; then
  echo "panel_mail=skipped (no nginx)"
  exit 0
fi

write_http_vhost "$MAIL_HOST"
nginx -t
systemctl reload nginx

CERT_DIR="/etc/letsencrypt/live/$MAIL_HOST"
if [ -n "$RESOLVED" ] && [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  if command -v certbot >/dev/null 2>&1; then
    certbot certonly --webroot -w /var/www/certbot -d "$MAIL_HOST" \
      --non-interactive --agree-tos --email "$LE_EMAIL" --expand \
      || echo "panel_mail=warn certbot failed for $MAIL_HOST"
  fi
elif [ -z "$RESOLVED" ]; then
  echo "panel_mail=skip_cert (no public DNS yet)"
fi

chmod +x "$PANEL/scripts/refresh-mail-proxies.sh"
bash "$PANEL/scripts/refresh-mail-proxies.sh" "$PANEL" || true

# Ensure MAIL_FROM mailbox exists at the MTA (optional)
if [ -n "${MAIL_FROM:-}" ] && [ -n "${AGENT_API_KEY:-}" ]; then
  PASS="Nv$(openssl rand -hex 6)"
  curl -sS -X POST "http://127.0.0.1:${AGENT_PORT}/execute" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${AGENT_API_KEY}" \
    -d "{\"action\":\"create_mail_account\",\"email\":\"${MAIL_FROM}\",\"password\":\"${PASS}\",\"quotaMb\":256}" \
    >/tmp/naviyra-mail-from-provision.json 2>/dev/null \
    && echo "panel_mail MAIL_FROM ensured: $MAIL_FROM" \
    || echo "panel_mail=warn could not ensure MAIL_FROM mailbox"
fi

echo "panel_mail=ok host=$MAIL_HOST resolved=${RESOLVED:-none}"
