#!/usr/bin/env bash
# Install phpPgAdmin for Naviyra panel PostgreSQL browse (SSO via /_ppa/).
# Usage: sudo bash scripts/install-phppgadmin.sh
set -euo pipefail

PANEL_ROOT="${NAVIYRA_ROOT:-/opt/naviyra-panel}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PPA_DIR="${PHPPGADMIN_DIR:-$PANEL_ROOT/phppgadmin}"
# Maintained PHP 8 fork (upstream REL_7-14-7 dies with "Virtual Class -- cannot instantiate" on PHP 8+)
PPA_REPO="${PHPPGADMIN_REPO:-https://github.com/ReimuHakurei/phpPgAdmin}"
PPA_REF="${PHPPGADMIN_REF:-master}"
TOKEN_DIR="${PANEL_ROOT}/data/ppa-tokens"

# shellcheck source=lib/load-env.sh
if [ -f "$SCRIPT_DIR/lib/load-env.sh" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/lib/load-env.sh"
  load_naviyra_env || true
  PANEL_HOST="$(resolve_panel_host 2>/dev/null || true)"
  export PANEL_HOST
fi

echo "==> Ensuring PHP-FPM + pgsql extensions"
if [ -x "$SCRIPT_DIR/install-php-fpm.sh" ]; then
  bash "$SCRIPT_DIR/install-php-fpm.sh" || true
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y php-fpm php-cli php-pgsql php-mbstring php-xml php-curl php-zip || true
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

needs_reinstall=0
if [ ! -f "$PPA_DIR/index.php" ]; then
  needs_reinstall=1
elif grep -q "Virtual Class -- cannot instantiate" "$PPA_DIR/libraries/adodb/adodb.inc.php" 2>/dev/null \
  && ! grep -q "function __construct" "$PPA_DIR/libraries/adodb/drivers/adodb-postgres64.inc.php" 2>/dev/null; then
  echo "==> Existing phpPgAdmin is not PHP 8 compatible — reinstalling fork"
  needs_reinstall=1
elif [ ! -f "$PPA_DIR/.naviyra-ppa-fork" ]; then
  echo "==> Replacing upstream phpPgAdmin with PHP 8 fork"
  needs_reinstall=1
fi

if [ "$needs_reinstall" = "1" ]; then
  echo "==> Downloading phpPgAdmin from ${PPA_REPO} (${PPA_REF})"
  TMP="$(mktemp -d)"
  URL="${PPA_REPO}/archive/refs/heads/${PPA_REF}.tar.gz"
  if ! curl -fsSL "$URL" -o "$TMP/ppa.tgz"; then
    URL="${PPA_REPO}/archive/refs/tags/${PPA_REF}.tar.gz"
    curl -fsSL "$URL" -o "$TMP/ppa.tgz"
  fi
  tar -xzf "$TMP/ppa.tgz" -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -type d \( -name 'phpPgAdmin-*' -o -name 'phppgadmin-*' \) | head -1)"
  if [ -z "${SRC:-}" ]; then
    echo "phpPgAdmin download layout unexpected" >&2
    ls -la "$TMP" >&2
    exit 1
  fi
  rm -rf "$PPA_DIR"
  mv "$SRC" "$PPA_DIR"
  echo "${PPA_REPO}@${PPA_REF}" > "$PPA_DIR/.naviyra-ppa-fork"
  rm -rf "$TMP"
fi

# Hardening patches for PHP 8 (safe if already applied)
PG64="$PPA_DIR/libraries/adodb/drivers/adodb-postgres64.inc.php"
ADODB="$PPA_DIR/libraries/adodb/adodb.inc.php"
if [ -f "$PG64" ]; then
  # Old-style constructor → __construct
  if grep -q "function ADODB_postgres64(" "$PG64"; then
    sed -i 's/function ADODB_postgres64(/function __construct(/' "$PG64"
  fi
  # Ensure subclass has a real constructor (PHP 8 inherits virtual parent otherwise)
  if ! grep -q "function __construct" "$PG64"; then
    python3 - "$PG64" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text(encoding="utf-8", errors="replace")
needle = "class ADODB_postgres64 extends ADOConnection {"
inject = needle + "\n\tfunction __construct() {\n\t\t/* PHP 8: override ADOConnection virtual ctor */\n\t}\n"
if needle in text and "function __construct" not in text:
    text = text.replace(needle, inject, 1)
    p.write_text(text, encoding="utf-8")
    print("injected __construct into", p)
PY
  fi
fi
if [ -f "$ADODB" ] && grep -q "die('Virtual Class -- cannot instantiate')" "$ADODB"; then
  # Keep the guard commented so accidental parent instantiation does not white-screen
  sed -i "s/die('Virtual Class -- cannot instantiate');/\\/\\/ die('Virtual Class -- cannot instantiate');/" "$ADODB" || true
fi
if [ -f "$PPA_DIR/all_db.php" ] && grep -q "each (" "$PPA_DIR/all_db.php"; then
  sed -i 's/while (list ($key) = each ($data->codemap)) {/foreach ($data->codemap as $key => $value) {/' "$PPA_DIR/all_db.php" || true
fi

PG_HOST="${CUSTOMER_POSTGRES_HOST:-127.0.0.1}"
PG_PORT="${CUSTOMER_POSTGRES_PORT:-5432}"
PANEL_HOST_NAME="${PANEL_HOST:-${PANEL_HOSTNAME:-}}"
PANEL_HOST_NAME="${PANEL_HOST_NAME%%/*}"
PANEL_HOST_NAME="${PANEL_HOST_NAME#https://}"
PANEL_HOST_NAME="${PANEL_HOST_NAME#http://}"
PANEL_HOST_NAME="${PANEL_HOST_NAME%%:*}"

if [ -n "$PANEL_HOST_NAME" ] && [[ ! "$PANEL_HOST_NAME" =~ yourdomain\.com ]]; then
  PPA_ABS="https://${PANEL_HOST_NAME}/_ppa/"
else
  PPA_ABS="/_ppa/"
fi

# conf/config.inc.php — TCP localhost + allow DB role logins (SSO)
CONF_VER=19
if [ -f "$PPA_DIR/conf/config.inc.php-dist" ]; then
  DETECTED="$(grep -E "\\\$conf\['version'\]" "$PPA_DIR/conf/config.inc.php-dist" | head -1 | grep -oE '[0-9]+' | head -1 || true)"
  if [ -n "${DETECTED:-}" ]; then
    CONF_VER="$DETECTED"
  fi
fi

cat > "$PPA_DIR/conf/config.inc.php" <<EOF
<?php
/**
 * Naviyra panel phpPgAdmin — SSO via /_ppa/signon.php
 */
\$conf['servers'][0]['desc'] = 'PostgreSQL';
\$conf['servers'][0]['host'] = '${PG_HOST}';
\$conf['servers'][0]['port'] = ${PG_PORT};
\$conf['servers'][0]['sslmode'] = 'allow';
\$conf['servers'][0]['defaultdb'] = 'postgres';
\$conf['servers'][0]['pg_dump_path'] = '/usr/bin/pg_dump';
\$conf['servers'][0]['pg_dumpall_path'] = '/usr/bin/pg_dumpall';

\$conf['default_lang'] = 'english';
\$conf['autocomplete'] = 'default on';
\$conf['extra_login_security'] = false;
\$conf['owned_only'] = false;
\$conf['show_comments'] = true;
\$conf['show_advanced'] = false;
\$conf['show_system'] = false;
\$conf['min_password_length'] = 1;
\$conf['left_width'] = 200;
\$conf['theme'] = 'default';
\$conf['show_oids'] = false;
\$conf['max_rows'] = 100;
\$conf['max_row_count'] = 2000;
\$conf['max_chars'] = 50;
\$conf['ajax_refresh'] = 3;
\$conf['plugins'] = array();
\$conf['version'] = ${CONF_VER};
EOF

# Signon: consume one-time token and set phpPgAdmin session (PPA_ID)
cat > "$PPA_DIR/signon.php" <<'PHPEOF'
<?php
/**
 * Naviyra phpPgAdmin signon — consume one-time token from panel.
 * Token files: {PANEL}/data/ppa-tokens/{token}.json
 */
declare(strict_types=1);

session_name('PPA_ID');
session_start();

$token = isset($_GET['token']) ? preg_replace('/[^a-f0-9]/', '', (string)$_GET['token']) : '';
if ($token === '' || strlen($token) < 32) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Missing or invalid token';
    exit;
}

$candidates = [
    getenv('NAVIYRA_PPA_TOKEN_DIR') ?: '',
    dirname(__DIR__) . '/data/ppa-tokens',
    '/opt/naviyra-panel/data/ppa-tokens',
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
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Token expired or not found';
    exit;
}

$raw = file_get_contents($tokenFile);
@unlink($tokenFile);
$data = json_decode($raw ?: '', true);
if (!is_array($data)) {
    http_response_code(403);
    echo 'Invalid token payload';
    exit;
}

$exp = isset($data['exp']) ? (int)$data['exp'] : 0;
if ($exp < time()) {
    http_response_code(403);
    echo 'Token expired';
    exit;
}

$user = (string)($data['user'] ?? '');
$pass = (string)($data['password'] ?? '');
$host = (string)($data['host'] ?? '127.0.0.1');
$port = (int)($data['port'] ?? 5432);
$onlyDb = (string)($data['only_db'] ?? '');

if ($user === '' || $pass === '' || $onlyDb === '') {
    http_response_code(403);
    echo 'Incomplete credentials';
    exit;
}

// phpPgAdmin stores login under webdbLogin[serverId] (server index 0 in config)
$serverId = '0';
$_SESSION['webdbLogin'][$serverId] = [
    'desc' => 'PostgreSQL',
    'host' => $host,
    'port' => $port,
    'sslmode' => 'allow',
    'defaultdb' => $onlyDb,
    'pg_dump_path' => '/usr/bin/pg_dump',
    'pg_dumpall_path' => '/usr/bin/pg_dumpall',
    'username' => $user,
    'password' => $pass,
];

session_write_close();

$q = http_build_query([
    'server' => $serverId,
    'subject' => 'database',
    'database' => $onlyDb,
]);
header('Location: ./redirect.php?' . $q);
exit;
PHPEOF

mkdir -p "$PPA_DIR/temp" 2>/dev/null || true
chown -R www-data:www-data "$PPA_DIR" 2>/dev/null || chown -R nginx:nginx "$PPA_DIR" 2>/dev/null || true
chmod 640 "$PPA_DIR/conf/config.inc.php" 2>/dev/null || true
chmod 750 "$TOKEN_DIR"
chown root:www-data "$TOKEN_DIR" 2>/dev/null || true

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
  ensure_env "PHPPGADMIN_DIR" "$PPA_DIR"
  ensure_env "PHPPGADMIN_URL_PATH" "/_ppa"
  ensure_env "CUSTOMER_POSTGRES_HOST" "$PG_HOST"
  ensure_env "CUSTOMER_POSTGRES_PORT" "$PG_PORT"
fi

if [ -x "$SCRIPT_DIR/setup-panel-https.sh" ]; then
  echo "==> Updating panel nginx for /_ppa/"
  bash "$SCRIPT_DIR/setup-panel-https.sh" || echo "setup-panel-https=warn (run later)"
fi

echo "phpPgAdmin ready at ${PPA_ABS}"
echo "  dir=${PPA_DIR}"
echo "  php_sock=${PHP_SOCK}"
echo "  tokens=${TOKEN_DIR}"
