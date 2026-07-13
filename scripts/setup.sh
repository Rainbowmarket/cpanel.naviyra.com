#!/usr/bin/env bash
# Naviyra Panel - Linux/macOS one-time setup (optional — launcher does this on first start)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Naviyra Panel Setup ==="

[ -f .env ] || cp .env.example .env

npm install
(cd agent && npm install)

npx prisma generate
npx prisma db push
npm run db:seed

echo ""
echo "Setup complete. Start with: ./start.sh  or  npm run app"
