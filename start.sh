#!/usr/bin/env bash
# Naviyra Panel — Linux / macOS start script
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed. Get it from https://nodejs.org"
  exit 1
fi

exec node launcher/index.mjs start "$@"
