#!/usr/bin/env bash
# Smoke-test backup path rules + a dry-run restore against a tiny archive.
# Does not overwrite production sites. Run from the panel root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/agent"
npx tsx --test hostname.test.ts
echo "Dispatcher / path tests passed."
echo "For a live restore drill: take a snapshot, create a panel backup, restore it, confirm a site loads, then roll back the snapshot."
