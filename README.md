# Video Downloader MVP

本地优先的视频下载站，前端使用 `Next.js`，后端使用 `FastAPI + Redis + RQ`，下载和字幕处理依赖 `yt-dlp`、`ffmpeg` 和 `faster-whisper`。

## 功能

- 粘贴抖音、B 站或其他 `yt-dlp` 兼容链接
- 异步解析任务状态
- 优先提取现成字幕
- 无现成字幕时自动转写
- 下载视频、`SRT` 字幕和纯文本字幕

## 本地启动

### 1. 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2. Worker

```bash
cd backend
source .venv/bin/activate
python worker.py
```

### 3. Redis

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

### 4. 前端

```bash
cd web
npm install
npm run dev
```

默认访问：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`

开发期通过 Next.js rewrite 将 `/api/*` 转发到后端，避免浏览器跨域问题。

## Docker Compose

```bash
docker-compose up --build
```

## 环境变量

### `backend/.env`

```bash
APP_ENV=development
REDIS_URL=redis://localhost:6379/0
TASKS_DIR=../tmp/tasks
TASK_TTL_SECONDS=86400
YTDLP_BIN=yt-dlp
FFMPEG_BIN=ffmpeg
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
MAX_VIDEO_DURATION_SECONDS=3600
```

### `web/.env.local`

```bash
BACKEND_ORIGIN=http://localhost:8000
```

## 限制

- 第一版不支持登录态、会员、私密内容
- 第一版不支持 cookies 上传
- 第一版不支持批量下载、合集下载、主页抓取
- 模型首次转写时可能需要下载权重文件
# video-yt-dlp
