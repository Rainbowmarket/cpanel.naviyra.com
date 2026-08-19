#!/usr/bin/env bash
# Back-compat wrapper — prefer scripts/install-visitor-ingest.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PANEL_DIR="${PANEL_DIR:-/opt/naviyra-panel}"
exec bash "$DIR/install-visitor-ingest.sh" "$PANEL_DIR"
