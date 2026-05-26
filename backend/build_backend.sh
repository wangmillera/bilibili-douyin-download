#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f ".venv/bin/python" ]; then
    echo "ERROR: .venv not found at $SCRIPT_DIR/.venv"
    echo "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

source .venv/bin/activate

if ! python -c "import PyInstaller" 2>/dev/null; then
    echo "==> Installing PyInstaller..."
    pip install pyinstaller
fi

echo "==> Building backend with PyInstaller..."

pyinstaller --onefile \
    --name bilibili-douyin-backend \
    --add-data "scripts:scripts" \
    --hidden-import=uvicorn \
    --hidden-import=uvicorn.logging \
    --hidden-import=uvicorn.loops \
    --hidden-import=uvicorn.loops.auto \
    --hidden-import=uvicorn.protocols \
    --hidden-import=uvicorn.protocols.http \
    --hidden-import=uvicorn.protocols.http.auto \
    --hidden-import=uvicorn.protocols.websockets \
    --hidden-import=uvicorn.protocols.websockets.auto \
    --hidden-import=uvicorn.lifespan \
    --hidden-import=uvicorn.lifespan.on \
    --hidden-import=yt_dlp \
    --hidden-import=yt_dlp.utils \
    --hidden-import=yt_dlp.extractor \
    --hidden-import=aiohttp \
    --hidden-import=aiofiles \
    --hidden-import=aiosqlite \
    --hidden-import=gmssl \
    --hidden-import=gmssl.func \
    --hidden-import=gmssl.sm3 \
    --hidden-import=gmssl.sm2 \
    --hidden-import=gmssl.sm4 \
    --hidden-import=pydantic \
    --hidden-import=fastapi \
    --hidden-import=redis \
    --hidden-import=rq \
    --hidden-import=requests \
    --hidden-import=opencc \
    --hidden-import=browser_cookie3 \
    --hidden-import=faster_whisper \
    --collect-data faster_whisper \
    --noupx \
    --noconfirm \
    run_backend.py

chmod +x dist/bilibili-douyin-backend

echo "==> Build complete: $SCRIPT_DIR/dist/bilibili-douyin-backend"
