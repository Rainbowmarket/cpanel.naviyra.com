#!/usr/bin/env bash
# Naviyra Panel — Linux / macOS stop script
set -euo pipefail
cd "$(dirname "$0")"
exec node launcher/stop.mjs
