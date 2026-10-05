#!/usr/bin/env bash
# Naviyra Panel — Linux/macOS start with root (admin) permission
set -euo pipefail
cd "$(dirname "$0")"

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Requesting root permission (sudo)..."
  exec sudo "$0" "$@"
fi

# shellcheck source=scripts/ensure-node.sh
source "./scripts/ensure-node.sh"
ensure_node

exec node launcher/index.mjs start "$@"
