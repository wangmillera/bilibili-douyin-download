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

构建顺序：**前端静态导出必须先于 electron-builder 打包**（`web/out/` 作为 extraResources 打入 app）。

```bash
cd web
npm run build:desktop        # Next.js 静态导出 → web/out/

cd ../desktop
npm run dist:mac             # 构建后端二进制 + electron-builder → DMG
```

`dist:mac` 内部执行：
1. `build_backend.sh` — PyInstaller 将 FastAPI 后端打包为单文件二进制 `bilibili-douyin-backend`（约 75MB）
2. `electron-builder --mac dmg` — 将 Electron 壳 + 前端静态资源 + 后端二进制 + douyin-downloader 打包为 DMG

打包产物在 `desktop/dist/B站抖音下载器-0.1.0-arm64.dmg`。

**Windows 打包**：

```bash
cd desktop
npm run dist:win
```

### 打包注意事项

**PyInstaller 隐藏导入**：`gmssl` 的子模块（`gmssl.func`、`gmssl.sm3`、`gmssl.sm2`、`gmssl.sm4`）不会被自动检测，漏掉任何一个会导致抖音 ABogus 签名在打包后静默失败（import 被 try/except 吞掉），表现为 `Empty 200 response (anti-bot)` 错误。必须在 `build_backend.sh` 和 `.spec` 文件中都显式声明。

**打包 vs 开发模式**：`desktop/main.cjs` 通过 `app.isPackaged` 区分行为：
- 开发模式：检查 `python3`、`desktop_entry.py`、`app/` 是否存在；使用 `python3 desktop_entry.py` 启动后端
- 打包模式：检查 `bilibili-douyin-backend` 二进制和 `web/index.html` 是否存在；直接 spawn 二进制

**启动超时**：PyInstaller 单文件二进制首次启动时会自解压到临时目录，可能耗时较久。打包模式下 `waitForBackend()` 超时为 60 秒（开发模式 20 秒）。如果超时后进程仍在运行，后续重启调用不会杀掉正在启动的进程，避免竞态循环。

**`douyin_adapter.py` 冻结模式**：通过 `getattr(sys, 'frozen', False)` 检测是否在 PyInstaller 环境中运行。冻结模式下使用 `sys.executable --helper` 调用子进程，而非 `python3 scripts/helper.py`。

**VSCode 终端问题**：VSCode 集成终端可能设置 `ELECTRON_RUN_AS_NODE=1`，导致 Electron 无法正常启动（报错 `Cannot read properties of undefined (reading 'handle')`）。开发时需先 `unset ELECTRON_RUN_AS_NODE` 或从外部终端启动。

**entitlements**：macOS 打包需要 `desktop/entitlements.mac.plist`，启用 `com.apple.security.cs.allow-unsigned-executable-memory` 等权限，否则 PyInstaller 二进制可能被 Hardened Runtime 阻止。

**douyin-downloader 目录**：打包时 `vendor/douyin-downloader/` 作为 extraResources 打入 app，排除 `.git/`、`.venv/`、`__pycache__/`、`*.pyc`。桌面版通过 `DOUYIN_DOWNLOADER_DIR` 环境变量指向该目录。

### 桌面版运行约定

- 桌面版固定使用 `QUEUE_MODE=inline`，后端运行在 `127.0.0.1:18180`
- 窗口先展示 loading 页面，后端就绪后自动切换到主界面；若启动失败显示错误面板并可重试
- 首次启动弹出目录选择对话框；后续启动直接使用已选目录
- YouTube / 抖音 Cookie 优先从本机 Chrome 浏览器读取，配置文件存储在 `userData` 目录
- 通过 Electron IPC 提供：下载目录选择、打开下载目录/日志目录、打开任务文件、导出诊断日志
- 用户设置在 `~/Library/Application Support/bilibili-douyin-downloader-desktop/desktop-settings.json`

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
