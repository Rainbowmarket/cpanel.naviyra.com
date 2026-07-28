#!/usr/bin/env bash
# Naviyra Panel — Linux / macOS start script
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=scripts/ensure-node.sh
source "./scripts/ensure-node.sh"
ensure_node

exec node launcher/index.mjs start "$@"
