#!/usr/bin/env bash
# Install phpMyAdmin for Naviyra panel MySQL/MariaDB browse (SSO via /_pma/).
# Usage: sudo bash scripts/install-phpmyadmin.sh
set -euo pipefail

PANEL_ROOT="${NAVIYRA_ROOT:-/opt/naviyra-panel}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PMA_DIR="${PHPMYADMIN_DIR:-$PANEL_ROOT/phpmyadmin}"
PMA_VERSION="${PHPMYADMIN_VERSION:-5.2.2}"
TOKEN_DIR="${PANEL_ROOT}/data/pma-tokens"

# shellcheck source=lib/load-env.sh
if [ -f "$SCRIPT_DIR/lib/load-env.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/load-env.sh"
  load_naviyra_env || true
  PANEL_HOST="$(resolve_panel_host 2>/dev/null || true)"
  export PANEL_HOST
fi

echo "==> Ensuring PHP-FPM + MySQL extensions"
if [ -x "$SCRIPT_DIR/install-php-fpm.sh" ]; then
  bash "$SCRIPT_DIR/install-php-fpm.sh" || true
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y php-fpm php-cli php-mysql php-mbstring php-xml php-curl php-zip || true
fi

detect_php_sock() {
  if [ -n "${PHP_FPM_SOCKET:-}" ] && [ -S "${PHP_FPM_SOCKET}" ]; then
    echo "${PHP_FPM_SOCKET}"
    return
  fi
  local s
  for s in /run/php/php*-fpm.sock; do
    if [ -S "$s" ]; then
      echo "$s"
      return
    fi
  done
  echo "/run/php/php8.3-fpm.sock"
}

PHP_SOCK="$(detect_php_sock)"

mkdir -p "$PANEL_ROOT" "$TOKEN_DIR"
chmod 750 "$TOKEN_DIR"
chown root:www-data "$TOKEN_DIR" 2>/dev/null || chown root:nginx "$TOKEN_DIR" 2>/dev/null || true

if [ ! -f "$PMA_DIR/index.php" ]; then
  echo "==> Downloading phpMyAdmin ${PMA_VERSION}"
  TMP="$(mktemp -d)"
  ARCHIVE="phpMyAdmin-${PMA_VERSION}-all-languages.tar.gz"
  URL="https://files.phpmyadmin.net/phpMyAdmin/${PMA_VERSION}/${ARCHIVE}"
  curl -fsSL "$URL" -o "$TMP/$ARCHIVE"
  tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
  rm -rf "$PMA_DIR"
  mv "$TMP"/phpMyAdmin-"${PMA_VERSION}"-all-languages "$PMA_DIR"
  rm -rf "$TMP"
fi

# Blowfish secret (32 chars)
SECRET_FILE="$PMA_DIR/.naviyra-blowfish"
if [ ! -f "$SECRET_FILE" ]; then
  openssl rand -base64 32 | tr -d '\n/+=' | head -c 32 > "$SECRET_FILE"
  chmod 640 "$SECRET_FILE"
fi
BLOWFISH="$(cat "$SECRET_FILE")"

MYSQL_HOST="${CUSTOMER_MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${CUSTOMER_MYSQL_PORT:-3306}"
PANEL_HOST_NAME="${PANEL_HOST:-${PANEL_HOSTNAME:-}}"
PANEL_HOST_NAME="${PANEL_HOST_NAME%%/*}"
PANEL_HOST_NAME="${PANEL_HOST_NAME#https://}"
PANEL_HOST_NAME="${PANEL_HOST_NAME#http://}"
PANEL_HOST_NAME="${PANEL_HOST_NAME%%:*}"

# Absolute URI for cookies / redirects
if [ -n "$PANEL_HOST_NAME" ] && [[ ! "$PANEL_HOST_NAME" =~ yourdomain\.com ]]; then
  PMA_ABS="https://${PANEL_HOST_NAME}/_pma/"
else
  PMA_ABS="/_pma/"
fi

# Signon helper (token → PMA session)
install -d -m 755 "$PMA_DIR"
cat > "$PMA_DIR/signon.php" <<'PHPEOF'
<?php
/**
 * Naviyra phpMyAdmin signon — consume one-time token from panel.
 * Token files: {PANEL}/data/pma-tokens/{token}.json
 */
declare(strict_types=1);

function pma_fail_page(string $title, string $detail, int $code = 400): void {
    http_response_code($code);
    $panel = getenv('PANEL_PUBLIC_URL') ?: '';
    if ($panel === '') {
        $host = $_SERVER['HTTP_HOST'] ?? '';
        $panel = $host !== '' ? ('https://' . $host) : '';
    }
    $panel = rtrim($panel, '/');
    $href = $panel !== '' ? ($panel . '/dashboard/databases') : '/dashboard/databases';
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' . htmlspecialchars($title) . '</title>';
    echo '<style>body{font-family:system-ui,sans-serif;background:#0b1220;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}';
    echo '.box{max-width:28rem;padding:1.5rem;border:1px solid #1e293b;border-radius:12px;background:#020617}';
    echo 'a{color:#34d399}p{line-height:1.5;color:#94a3b8}</style></head><body><div class="box">';
    echo '<h1 style="font-size:1.1rem;margin:0 0 .75rem;color:#fff">' . htmlspecialchars($title) . '</h1>';
    echo '<p>' . htmlspecialchars($detail) . '</p>';
    echo '<p>Open <strong>Databases → Browse</strong> from the panel again. Do not bookmark this page — the link works only once for ~60 seconds.</p>';
    echo '<p>Wrong database password? Use <strong>Reset password</strong> on that database, then Browse again.</p>';
    echo '<p><a href="' . htmlspecialchars($href) . '">Back to Databases</a></p>';
    echo '</div></body></html>';
    exit;
}

$sessionName = 'naviyra_pma';
session_name($sessionName);
session_start();

$token = isset($_GET['token']) ? preg_replace('/[^a-f0-9]/', '', (string)$_GET['token']) : '';
if ($token === '' || strlen($token) < 32) {
    pma_fail_page(
        'phpMyAdmin sign-in link incomplete',
        'This page was opened without a valid one-time token (or the token was stripped from the URL). That usually means phpMyAdmin was opened directly, the link expired, or Browse was refreshed after the token was already used — not that the MySQL password was typed wrong here.'
    );
}

$candidates = [
    getenv('NAVIYRA_PMA_TOKEN_DIR') ?: '',
    dirname(__DIR__) . '/data/pma-tokens',
    '/opt/naviyra-panel/data/pma-tokens',
];
$tokenFile = null;
foreach ($candidates as $dir) {
    if ($dir === '') {
        continue;
    }
    $path = rtrim($dir, '/') . '/' . $token . '.json';
    if (is_readable($path)) {
        $tokenFile = $path;
        break;
    }
}

if ($tokenFile === null) {
    pma_fail_page(
        'Sign-in token expired or already used',
        'Each Browse click creates a single-use link that lasts about 60 seconds. Click Browse again from the panel.',
        403
    );
}

$raw = file_get_contents($tokenFile);
@unlink($tokenFile);
$data = json_decode($raw ?: '', true);
if (!is_array($data)) {
    pma_fail_page('Invalid sign-in token', 'The token file was unreadable. Click Browse again from the panel.', 403);
}

$exp = isset($data['exp']) ? (int)$data['exp'] : 0;
if ($exp < time()) {
    pma_fail_page('Sign-in token expired', 'Click Browse again from the panel (tokens last about 60 seconds).', 403);
}

$user = (string)($data['user'] ?? '');
$pass = (string)($data['password'] ?? '');
$host = (string)($data['host'] ?? '127.0.0.1');
$port = (int)($data['port'] ?? 3306);
$onlyDb = (string)($data['only_db'] ?? '');

if ($user === '' || $pass === '' || $onlyDb === '') {
    pma_fail_page('Incomplete credentials', 'Click Browse again from the panel.', 403);
}

$_SESSION['PMA_single_signon_user'] = $user;
$_SESSION['PMA_single_signon_password'] = $pass;
$_SESSION['PMA_single_signon_host'] = $host;
$_SESSION['PMA_single_signon_port'] = (string)$port;
$_SESSION['PMA_single_signon_cfgupdate'] = [
    'only_db' => $onlyDb,
    'verbose' => $onlyDb,
];

session_write_close();
header('Location: ./index.php');
exit;
PHPEOF

cat > "$PMA_DIR/config.inc.php" <<EOF
<?php
/**
 * Naviyra panel phpMyAdmin — signon auth only (no cookie login form).
 */
declare(strict_types=1);

\$cfg['blowfish_secret'] = '${BLOWFISH}';
\$cfg['PmaAbsoluteUri'] = '${PMA_ABS}';
\$cfg['DefaultLang'] = 'en';
\$cfg['ForceSSL'] = false;
\$cfg['LoginCookieValidity'] = 3600;
\$cfg['ExecTimeLimit'] = 300;
\$cfg['MemoryLimit'] = '256M';
\$cfg['UploadDir'] = '';
\$cfg['SaveDir'] = '';
\$cfg['TempDir'] = '${PMA_DIR}/tmp';

\$i = 0;
\$i++;
\$cfg['Servers'][\$i]['auth_type'] = 'signon';
\$cfg['Servers'][\$i]['SignonSession'] = 'naviyra_pma';
\$cfg['Servers'][\$i]['SignonURL'] = '${PMA_ABS}';
\$cfg['Servers'][\$i]['host'] = '${MYSQL_HOST}';
\$cfg['Servers'][\$i]['port'] = '${MYSQL_PORT}';
\$cfg['Servers'][\$i]['compress'] = false;
\$cfg['Servers'][\$i]['AllowNoPassword'] = false;
\$cfg['Servers'][\$i]['DisableIS'] = false;
EOF

mkdir -p "$PMA_DIR/tmp"
chmod 750 "$PMA_DIR/tmp"
chown -R www-data:www-data "$PMA_DIR" 2>/dev/null || chown -R nginx:nginx "$PMA_DIR" 2>/dev/null || true
# Keep token dir writable by panel (root/node) and readable by www-data
chmod 750 "$TOKEN_DIR"
chown root:www-data "$TOKEN_DIR" 2>/dev/null || true
chmod 640 "$PMA_DIR/config.inc.php" "$SECRET_FILE" 2>/dev/null || true

# Persist socket + paths in panel .env
ENV_FILE="$PANEL_ROOT/.env"
ensure_env() {
  local key="$1" val="$2"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}
if [ -f "$ENV_FILE" ]; then
  ensure_env "PHP_FPM_SOCKET" "$PHP_SOCK"
  ensure_env "PHPMYADMIN_DIR" "$PMA_DIR"
  ensure_env "PHPMYADMIN_URL_PATH" "/_pma"
  ensure_env "CUSTOMER_MYSQL_HOST" "$MYSQL_HOST"
  ensure_env "CUSTOMER_MYSQL_PORT" "$MYSQL_PORT"
fi

# Refresh panel nginx with /_pma/ if setup script exists
if [ -x "$SCRIPT_DIR/setup-panel-https.sh" ]; then
  echo "==> Updating panel nginx for /_pma/"
  bash "$SCRIPT_DIR/setup-panel-https.sh" || echo "setup-panel-https=warn (run later)"
fi

echo "phpMyAdmin ready at ${PMA_ABS}"
echo "  dir=${PMA_DIR}"
echo "  php_sock=${PHP_SOCK}"
echo "  tokens=${TOKEN_DIR}"
