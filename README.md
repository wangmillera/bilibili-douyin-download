# Video Downloader MVP

本地优先的视频下载站，前端使用 `Next.js`，后端使用 `FastAPI + Redis + RQ`，下载和字幕处理依赖 `yt-dlp`、`ffmpeg` 和 `faster-whisper`。产品定位为 `B 站稳定支持，抖音实验支持`。当前抖音视频链路改为优先走 `douyin-downloader`。

## 功能

- 粘贴 B 站链接，或尝试抖音等实验支持链接
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

如果你要在本地开发时自动抓取抖音浏览器 cookies，再额外安装：

```bash
pip install playwright
python -m playwright install chromium
```

如果你要让后端直接调用 `douyin-downloader` 的抖音解析能力，需要先把该项目克隆到本机，并通过环境变量指向它：

```bash
git clone https://github.com/jiji262/douyin-downloader.git /private/tmp/douyin-downloader
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

如果本机暂时没有 `Redis` 或 `Docker Desktop`，开发期可以直接改用内联模式：

```bash
cd backend
source .venv/bin/activate
QUEUE_MODE=inline uvicorn app.main:app --reload --port 8000
```

这个模式会在 API 进程内直接异步处理任务，不需要额外启动 `Redis` 和 `worker`，但只适合本地开发。

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

## 抖音本地 Cookie 抓取

抖音为实验支持平台。开发期如果短链或标准视频链接提示需要 cookies，优先使用脚本抓取浏览器中的新鲜 cookies，而不是手工拼接整段字符串。

```bash
cd backend
source .venv/bin/activate
python scripts/fetch_douyin_cookies.py
```

脚本会：

- 打开 Chromium
- 让你手动登录抖音
- 回到终端按回车后导出 cookies
- 写入 `tmp/douyin.cookies.txt`
- 同时写入调试用的 `tmp/douyin.cookies.json`

后端会在以下条件下自动读取这个文件：

- 请求链接属于 `douyin.com` / `v.douyin.com` / `iesdouyin.com`
- 页面里没有手工粘贴 cookies

也可以通过环境变量改路径：

```bash
DOUYIN_COOKIE_FILE=../tmp/douyin.cookies.txt
```

抖音适配层也支持自定义 `douyin-downloader` 本地路径：

```bash
DOUYIN_DOWNLOADER_DIR=/private/tmp/douyin-downloader
DOUYIN_DOWNLOADER_PYTHON=/private/tmp/douyin-downloader/.venv/bin/python
```

## Docker Compose

```bash
docker-compose up --build
```

## 环境变量

### `backend/.env`

```bash
APP_ENV=development
QUEUE_MODE=redis
REDIS_URL=redis://localhost:6379/0
TASKS_DIR=../tmp/tasks
DOUYIN_COOKIE_FILE=../tmp/douyin.cookies.txt
DOUYIN_DOWNLOADER_DIR=/private/tmp/douyin-downloader
DOUYIN_DOWNLOADER_PYTHON=/private/tmp/douyin-downloader/.venv/bin/python
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
NEXT_PUBLIC_ENABLE_COOKIE_INPUT=false
```

## 限制

- B 站为稳定支持平台
- 抖音为实验支持平台，当前优先走 `douyin-downloader`
- 第一版不支持登录态、会员、私密内容
- 默认不向普通用户展示 cookies 输入；本地调试可通过 `NEXT_PUBLIC_ENABLE_COOKIE_INPUT=true` 打开
- 第一版不支持批量下载、合集下载、主页抓取
- 模型首次转写时可能需要下载权重文件
