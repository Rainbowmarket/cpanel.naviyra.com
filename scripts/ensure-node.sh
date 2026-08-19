#!/usr/bin/env bash
# Ensure Node.js 20+ is available. Prefer nvm latest LTS; install it if missing.
# Sourced or executed by start.sh / start-admin.sh
set -euo pipefail

NODE_MAJOR_MIN=20
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

node_major() {
  local bin="${1:-node}"
  "$bin" -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0
}

# Prefer nvm latest LTS over distro Node (Ubuntu /usr/bin/node is often older).
try_nvm_lts() {
  if [ ! -f "$SCRIPT_DIR/panel-node.sh" ]; then
    return 1
  fi
  # shellcheck source=scripts/panel-node.sh
  . "$SCRIPT_DIR/panel-node.sh"
  if ! naviyra_nvm_dir >/dev/null; then
    return 1
  fi
  if naviyra_resolve_node && [ -x "${PANEL_NODE:-}" ]; then
    local major
    major="$(node_major "$PANEL_NODE")"
    if [ "${major:-0}" -ge "$NODE_MAJOR_MIN" ]; then
      hash -r 2>/dev/null || true
      echo "[Naviyra] Node.js ready via nvm: $($PANEL_NODE -v) ($PANEL_NODE)"
      return 0
    fi
  fi
  return 1
}

install_node_linux() {
  echo "[Naviyra] Node.js not found (or too old). Installing latest LTS with nvm…"
  if [ "$(id -u)" -ne 0 ]; then
    echo "[Naviyra] Root required to install Node.js. Re-run with: sudo $0"
    exit 1
  fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
}

install_node_macos() {
  echo "[Naviyra] Node.js not found (or too old). Installing via Homebrew…"
  if ! command -v brew >/dev/null 2>&1; then
    echo "[Naviyra] ERROR: Homebrew not found. Install Node from https://nodejs.org or install brew first."
    exit 1
  fi
  brew install node
}

ensure_node() {
  if try_nvm_lts; then
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node_major node)"
    if [ "${major:-0}" -ge "$NODE_MAJOR_MIN" ]; then
      echo "[Naviyra] Node.js ready: $(node -v) (npm $(npm -v))"
      return 0
    fi
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
  try_nvm_lts || true

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
