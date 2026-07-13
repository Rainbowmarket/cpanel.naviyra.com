#!/usr/bin/env bash
# Naviyra Panel — Linux/macOS start with root (admin) permission
set -euo pipefail
cd "$(dirname "$0")"

if [ "$EUID" -ne 0 ]; then
  echo "Requesting root permission (sudo)..."
  exec sudo AGENT_DRY_RUN=false "$0" "$@"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed. Get it from https://nodejs.org"
  exit 1
fi

export AGENT_DRY_RUN=false
exec node launcher/index.mjs start "$@"
