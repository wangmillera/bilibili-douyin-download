#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
BROWSERS_DIR="$BACKEND_DIR/playwright-browsers"

echo "==> Installing Playwright Python package into backend .venv"
if [ -f "$BACKEND_DIR/.venv/bin/python" ]; then
    "$BACKEND_DIR/.venv/bin/python" -m pip install playwright --quiet
else
    echo "ERROR: backend .venv not found at $BACKEND_DIR/.venv"
    exit 1
fi

echo "==> Installing Chromium browser to $BROWSERS_DIR"
export PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_DIR"
"$BACKEND_DIR/.venv/bin/python" -m playwright install chromium

echo "==> Done. Chromium installed at $BROWSERS_DIR"
du -sh "$BROWSERS_DIR" 2>/dev/null || true
