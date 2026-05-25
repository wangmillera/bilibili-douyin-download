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

如果你要在本地开发时使用备用的浏览器抓取脚本，再额外安装：

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

## 抖音浏览器授权

抖音为实验支持平台。当前默认链路会优先读取你本机真实浏览器中的抖音 cookies，不再要求用户手工粘贴 cookies。

桌面版或本地模式下，先在你本机的 `Chrome` 中完成抖音登录，然后直接提交链接即可。后端会自动读取浏览器态，并写成 `douyin-downloader` 可用的临时 cookie 文件。

默认浏览器可通过环境变量切换：

```bash
DOUYIN_COOKIES_BROWSER=chrome
```

也可以改成 `edge` 或 `safari`。

如果你仍然需要调试备用的旧抓取流程，才使用下面这个脚本：

```bash
cd backend
source .venv/bin/activate
python scripts/fetch_douyin_cookies.py
```

脚本会打开一个独立的 Chromium，并在你登录后导出 `tmp/douyin.cookies.txt` 和 `tmp/douyin.cookies.json`。这条链路现在只作为备用调试工具，不是主授权方式。

也可以通过环境变量改路径：

```bash
DOUYIN_COOKIE_FILE=../tmp/douyin.cookies.txt
DOUYIN_COOKIES_BROWSER=chrome
```

抖音适配层也支持自定义 `douyin-downloader` 本地路径：

```bash
DOUYIN_DOWNLOADER_DIR=/private/tmp/douyin-downloader
DOUYIN_DOWNLOADER_PYTHON=/private/tmp/douyin-downloader/.venv/bin/python
```

## YouTube 本地 Cookie 抓取

YouTube 如果出现 “Sign in to confirm you're not a bot”，本地开发时也走同样的浏览器 cookie 抓取策略。

默认情况下，后端会先尝试直接读取你本机真实浏览器的 cookies：

- `chrome`（默认）
- 也可以通过环境变量切到 `edge`、`safari` 等 `yt-dlp` 支持的浏览器

```bash
cd backend
source .venv/bin/activate
python scripts/fetch_youtube_cookies.py
```

脚本会：

- 打开 Chromium
- 让你手动登录 YouTube
- 回到终端按回车后导出 cookies
- 写入 `tmp/youtube.cookies.txt`
- 同时写入调试用的 `tmp/youtube.cookies.json`

后端会在以下条件下自动读取这个文件：

- 请求链接属于 `youtube.com` / `youtu.be`
- 页面里没有手工粘贴 cookies

也可以通过环境变量改路径：

```bash
YOUTUBE_COOKIE_FILE=../tmp/youtube.cookies.txt
YOUTUBE_COOKIES_BROWSER=chrome
YOUTUBE_DOWNLOADER=yt-dlp
```

- `YOUTUBE_DOWNLOADER=yt-dlp` 为默认值
- 如果要切回实验性的旧下载器，可设为 `YOUTUBE_DOWNLOADER=youtube-dl`

## Docker Compose

```bash
docker-compose up --build
```

## 桌面版开发

### 目录

- `desktop/`：Electron 桌面壳
- `web/`：桌面版渲染层 UI
- `backend/`：内置本地下载引擎

### 本地开发启动

先确保后端虚拟环境和前端依赖已经安装，然后安装桌面壳依赖：

```bash
cd desktop
npm install
```

开发模式会自动拉起前端 dev server 和 Electron 窗口，后端由 Electron 主进程自动启动：

```bash
cd desktop
npm run dev:full
```

### 桌面版构建

先导出桌面前端静态资源：

```bash
cd desktop
npm run build:renderer
```

再按目标平台打包：

```bash
cd desktop
npm run dist:mac
npm run dist:win
```

### 桌面版运行约定

- 桌面版固定使用 `QUEUE_MODE=inline`
- YouTube 默认下载器固定为 `yt-dlp`
- 首次启动会要求选择下载目录
- 桌面版通过 Electron IPC 提供：
  - 下载目录选择
  - 打开下载目录
  - 打开任务文件
  - 最近任务列表

## 环境变量

### `backend/.env`

```bash
APP_ENV=development
QUEUE_MODE=redis
REDIS_URL=redis://localhost:6379/0
TASKS_DIR=../tmp/tasks
DOUYIN_COOKIE_FILE=../tmp/douyin.cookies.txt
YOUTUBE_COOKIE_FILE=../tmp/youtube.cookies.txt
YOUTUBE_COOKIES_BROWSER=chrome
YOUTUBE_DOWNLOADER=yt-dlp
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
- YouTube 命中机器人校验时会优先读取本地浏览器 cookies 文件
- 抖音为实验支持平台，当前优先走 `douyin-downloader`，并优先读取本机浏览器中的抖音登录态
- 第一版不支持登录态、会员、私密内容
- 默认不向普通用户展示 cookies 输入；本地调试可通过 `NEXT_PUBLIC_ENABLE_COOKIE_INPUT=true` 打开
- 第一版不支持批量下载、合集下载、主页抓取
- 模型首次转写时可能需要下载权重文件
