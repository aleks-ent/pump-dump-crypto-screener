#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> git pull"
git pull

echo "==> pnpm install"
pnpm install

echo "==> pnpm build"
pnpm build

echo "==> pm2 start ecosystem.config.cjs"
if pm2 describe pump-monitor &>/dev/null; then
  pm2 restart ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
fi

echo "==> pm2 monit"
pm2 monit
