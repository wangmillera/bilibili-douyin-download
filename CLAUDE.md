# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Local-first video downloader with three-tier architecture: FastAPI backend, Next.js frontend, Electron desktop shell. Supports Bilibili (stable), YouTube (stable via yt-dlp), and Douyin (experimental via external `douyin-downloader`).

## Development Commands

### Backend (FastAPI)
```bash
cd backend
source .venv/bin/activate

# Development (inline mode, no Redis/worker needed)
QUEUE_MODE=inline uvicorn app.main:app --reload --port 8000

# Production mode (requires Redis + separate worker)
uvicorn app.main:app --reload --port 8000
python worker.py  # in separate terminal
```

### Frontend (Next.js)
```bash
cd web
npm install
npm run dev           # http://localhost:3000
npm run build:desktop # for Electron static export
```

### Desktop (Electron)
```bash
cd desktop
npm install
npm run dev:full     # starts frontend dev server + Electron
npm run build:renderer && npm run dist:mac  # build macOS app
```

### Redis (for production queue mode)
```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

## Architecture

### Queue Modes
- **`redis`**: Production. Tasks go to Redis queue; separate worker process handles downloads.
- **`inline`**: Development/Desktop. Tasks run in daemon threads within API process; no Redis/worker needed.
- **`desktop`**: Electron-only. Shell spawns backend as child process with `QUEUE_MODE=inline` on port 18180.

### Task Storage
File-based JSON storage in `tmp/tasks/{task_id}/meta.json`. Each task directory contains:
- `meta.json`: Task status, metadata, filenames
- `video.mp4`: Downloaded video
- `subtitle.srt`, `subtitle.txt`: Subtitle files
- `thumbnail.{jpg,png,webp}`: Video thumbnail

Tasks expire after `TASK_TTL_SECONDS` (default 86400s).

### Platform Adapters
- **Bilibili**: Direct yt-dlp integration (`app/downloader.py`)
- **YouTube**: yt-dlp with browser cookie fallback for bot-protected videos
- **Douyin**: External `douyin-downloader` project via subprocess (`app/douyin_adapter.py`)

### Desktop Integration
Electron main process (`desktop/main.cjs`):
- Spawns backend via `desktop_entry.py` on port 18180
- Manages backend lifecycle (start/stop with app)
- Provides IPC handlers for download directory, recent tasks, opening files
- Settings stored in `userData/desktop-settings.json`

Backend in desktop mode uses:
- `QUEUE_MODE=inline` (no Redis)
- `APP_ENV=desktop` (affects CORS)
- Task directory under user's chosen download folder

### Cookie Handling
Priority order for platform cookies:
1. Browser extraction (via `browser-cookie3`) from Chrome/Edge/Safari
2. Manual cookie file (`DOUYIN_COOKIE_FILE`, `YOUTUBE_COOKIE_FILE`)
3. Fallback to no cookies (may fail on bot-protected content)

Browser selection via env vars: `DOUYIN_COOKIES_BROWSER=chrome`, `YOUTUBE_COOKIES_BROWSER=chrome`.

## Key Environment Variables

### Backend (`backend/.env`)
```
APP_ENV=development
QUEUE_MODE=redis              # or 'inline' for dev/desktop
REDIS_URL=redis://localhost:6379/0
TASKS_DIR=../tmp/tasks
TASK_TTL_SECONDS=86400
YTDLP_BIN=yt-dlp
FFMPEG_BIN=ffmpeg
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
MAX_VIDEO_DURATION_SECONDS=3600
```

### Frontend (`web/.env.local`)
```
BACKEND_ORIGIN=http://localhost:8000
NEXT_PUBLIC_ENABLE_COOKIE_INPUT=false
```

## External Dependencies
- **yt-dlp**: Video download (Bilibili, YouTube)
- **faster-whisper**: Audio transcription for subtitle generation
- **ffmpeg**: Video/audio processing
- **douyin-downloader**: External project for Douyin support (clone to `/private/tmp/douyin-downloader`)
