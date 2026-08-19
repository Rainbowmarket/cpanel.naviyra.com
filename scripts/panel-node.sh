#!/usr/bin/env bash
# Resolve the Node binary Naviyra should run (nvm latest LTS preferred).
# Source from other scripts. Sets PANEL_NODE and PANEL_NODE_DIR.
#
# Optional input: NODE_BIN / NODE_BIN_DIR from the npx installer.

# sudo/npx sets this and nvm refuses to run.
unset npm_config_prefix 2>/dev/null || true
unset NPM_CONFIG_PREFIX 2>/dev/null || true

naviyra_nvm_dir() {
  if [ -n "${NVM_DIR:-}" ] && [ -s "${NVM_DIR}/nvm.sh" ]; then
    echo "$NVM_DIR"
    return 0
  fi
  local d
  for d in "${HOME}/.nvm" /root/.nvm; do
    if [ -s "${d}/nvm.sh" ]; then
      echo "$d"
      return 0
    fi
  done
  return 1
}

naviyra_resolve_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then
    PANEL_NODE="$NODE_BIN"
  else
    local nvm_dir=""
    nvm_dir="$(naviyra_nvm_dir || true)"
    if [ -n "$nvm_dir" ]; then
      export NVM_DIR="$nvm_dir"
      # shellcheck disable=SC1091
      . "$NVM_DIR/nvm.sh"
      nvm install --lts
      nvm use --lts
      PANEL_NODE="$(command -v node)"
    else
      PANEL_NODE="$(command -v node || true)"
    fi
  fi

  if [ -z "${PANEL_NODE:-}" ] || [ ! -x "$PANEL_NODE" ]; then
    echo "[naviyra] ERROR: Node.js not found. Install nvm and run: nvm install --lts" >&2
    return 1
  fi

  PANEL_NODE="$(readlink -f "$PANEL_NODE" 2>/dev/null || echo "$PANEL_NODE")"
  PANEL_NODE_DIR="${NODE_BIN_DIR:-$(dirname "$PANEL_NODE")}"
  export PATH="${PANEL_NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  echo "[naviyra] Panel Node $($PANEL_NODE -v) ($PANEL_NODE)"
}
