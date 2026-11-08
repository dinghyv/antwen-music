#!/usr/bin/env bash
# 服务器上更新 antwen music：拉代码、装依赖、构建、重启。数据（data/）和 .env 不受影响。
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
pnpm install --frozen-lockfile
pnpm build

if pm2 describe antwen-music >/dev/null 2>&1; then
  pm2 reload antwen-music
else
  pm2 start ecosystem.config.cjs
  pm2 save
fi
pm2 status antwen-music
