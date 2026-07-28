#!/usr/bin/env bash
# Ensure Node.js 20+ is available. Installs if missing, then refreshes PATH.
# Sourced or executed by start.sh / start-admin.sh
set -euo pipefail

NODE_MAJOR_MIN=20

node_major() {
  node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0
}

need_install() {
  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi
  local major
  major="$(node_major)"
  if [ "${major:-0}" -lt "$NODE_MAJOR_MIN" ]; then
    return 0
  fi
  return 1
}

install_node_linux() {
  echo "[Naviyra] Node.js not found (or too old). Installing Node.js ${NODE_MAJOR_MIN}.x..."
  if [ "$(id -u)" -ne 0 ]; then
    echo "[Naviyra] Root required to install Node.js. Re-run with: sudo $0"
    exit 1
  fi
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR_MIN}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs npm
  else
    echo "[Naviyra] ERROR: Unsupported Linux package manager. Install Node.js ${NODE_MAJOR_MIN}+ from https://nodejs.org"
    exit 1
  fi
}

install_node_macos() {
  echo "[Naviyra] Node.js not found (or too old). Installing via Homebrew..."
  if ! command -v brew >/dev/null 2>&1; then
    echo "[Naviyra] ERROR: Homebrew not found. Install Node from https://nodejs.org or install brew first."
    exit 1
  fi
  brew install node@${NODE_MAJOR_MIN} || brew install node
}

ensure_node() {
  if ! need_install; then
    return 0
  fi

  case "$(uname -s)" in
    Linux*) install_node_linux ;;
    Darwin*) install_node_macos ;;
    *)
      echo "[Naviyra] ERROR: Cannot auto-install Node on this OS. Get it from https://nodejs.org"
      exit 1
      ;;
  esac

  hash -r 2>/dev/null || true
  export PATH="/usr/local/bin:/usr/bin:$PATH"

  if ! command -v node >/dev/null 2>&1; then
    echo "[Naviyra] ERROR: Node.js install finished but 'node' is still not in PATH."
    exit 1
  fi

  echo "[Naviyra] Node.js ready: $(node -v) (npm $(npm -v))"
}

# Allow: bash scripts/ensure-node.sh
if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
  ensure_node
fi
