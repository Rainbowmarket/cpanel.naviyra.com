#!/usr/bin/env bash
# Legacy wrapper — use ./stop.sh or npm run stop
set -euo pipefail
cd "$(dirname "$0")/.."
exec node launcher/stop.mjs
