#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> pm2 stop all"
pm2 stop all

echo "==> pm2 delete all"
pm2 delete all
