#!/usr/bin/env bash
# Legacy wrapper — use ./start.sh or npm run app
set -euo pipefail
cd "$(dirname "$0")/.."
exec node launcher/index.mjs start "$@"
