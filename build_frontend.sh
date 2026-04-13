#!/usr/bin/env bash
# build_frontend.sh — Build the React frontend and bundle it into the Python package
#
# This copies web/dist/ into server/flow_llm/frontend/ so that
# `pip install flow-llm` ships a self-contained app with no separate frontend step.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_SRC="$ROOT_DIR/web/dist"
FRONTEND_DST="$ROOT_DIR/server/flow_llm/frontend"

echo "[Flow] Building frontend..."
cd "$ROOT_DIR/web"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "[Flow] Installing npm dependencies..."
  npm install --silent
fi

# Build
npm run build

# Copy into Python package
echo "[Flow] Bundling frontend into Python package..."
rm -rf "$FRONTEND_DST"
cp -r "$FRONTEND_SRC" "$FRONTEND_DST"

echo "[Flow] Frontend bundled to $FRONTEND_DST"