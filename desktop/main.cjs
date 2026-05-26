const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DESKTOP_BACKEND_PORT = Number(process.env.DESKTOP_BACKEND_PORT || 18180);
const DESKTOP_BACKEND_HOST = process.env.DESKTOP_BACKEND_HOST || "127.0.0.1";
const DESKTOP_BACKEND_ORIGIN = `http://${DESKTOP_BACKEND_HOST}:${DESKTOP_BACKEND_PORT}`;
const DEFAULT_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:3000";
const DEFAULT_RECENT_TASKS_LIMIT = 8;

let mainWindow = null;
let backendProcess = null;
let backendHealthy = false;
let backendLaunchError = null;
let backendProcessExited = false;

function settingsPath() {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function loadSettings() {
  const defaults = {
    downloadDirectory: "",
    preferredBrowser: "chrome",
    preferredBrowserProfile: "auto",
    developerMode: false,
    recentTasksLimit: DEFAULT_RECENT_TASKS_LIMIT,
  };

  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveSettings(nextSettings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(nextSettings, null, 2), "utf8");
  return nextSettings;
}

async function ensureDownloadDirectory(currentSettings) {
  if (currentSettings.downloadDirectory) {
    fs.mkdirSync(currentSettings.downloadDirectory, { recursive: true });
    return currentSettings;
  }

  const fallbackDirectory = path.join(app.getPath("downloads"), "B站抖音下载器");
  const result = await dialog.showOpenDialog({
    title: "选择下载目录",
    buttonLabel: "使用该目录",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: fallbackDirectory,
  });

  const chosenDirectory = result.canceled ? fallbackDirectory : result.filePaths[0];
  fs.mkdirSync(chosenDirectory, { recursive: true });
  return saveSettings({ ...currentSettings, downloadDirectory: chosenDirectory });
}

function backendRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "backend") : path.join(__dirname, "..", "backend");
}

function douyinDownloaderRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "douyin-downloader") : path.join(__dirname, "..", "vendor", "douyin-downloader");
}

function douyinDownloaderPython() {
  return resolvePythonExecutable();
}

function resolveFfmpegBinary() {
  const candidates = [
    path.join(process.resourcesPath, "bin", "ffmpeg"),
    path.join(__dirname, "..", "bin", "ffmpeg"),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function resolveFfprobeBinary() {
  const candidates = [
    path.join(process.resourcesPath, "bin", "ffprobe"),
    path.join(__dirname, "..", "bin", "ffprobe"),
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/usr/bin/ffprobe",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
}

function resolvePythonExecutable() {
  const root = backendRoot();
  const candidates = [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === "win32" ? "python" : "python3";
}

function checkCriticalResources() {
  const root = backendRoot();
  const missing = [];

  const checks = [
    { label: "Python 可执行文件", path: resolvePythonExecutable() },
    { label: "入口文件 desktop_entry.py", path: path.join(root, "desktop_entry.py") },
    { label: "后端应用 app/", path: path.join(root, "app") },
    { label: "前端页面 web/index.html", path: path.join(process.resourcesPath, "web", "index.html") },
  ];

  for (const check of checks) {
    if (!fs.existsSync(check.path)) {
      missing.push(`${check.label} (${check.path})`);
    }
  }

  return missing;
}

function backendEnv(currentSettings) {
  const userDataPath = app.getPath("userData");
  const logsDir = path.join(userDataPath, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const ffmpegBin = resolveFfmpegBinary();
  const ffprobeBin = resolveFfprobeBinary();
  const ffmpegDir = path.dirname(ffmpegBin);
  return {
    ...process.env,
    PATH: `${ffmpegDir}${path.delimiter}${process.env.PATH || ""}`,
    APP_ENV: "desktop",
    QUEUE_MODE: "inline",
    DESKTOP_BACKEND_HOST,
    DESKTOP_BACKEND_PORT: String(DESKTOP_BACKEND_PORT),
    TASKS_DIR: path.join(currentSettings.downloadDirectory, "tasks"),
    APP_LOG_DIR: logsDir,
    DOUYIN_COOKIE_FILE: path.join(userDataPath, "douyin.cookies.txt"),
    DOUYIN_COOKIES_BROWSER: currentSettings.preferredBrowser || "chrome",
    DOUYIN_COOKIES_PROFILE: currentSettings.preferredBrowserProfile || "auto",
    DOUYIN_DOWNLOADER_DIR: douyinDownloaderRoot(),
    DOUYIN_DOWNLOADER_PYTHON: douyinDownloaderPython(),
    YOUTUBE_COOKIE_FILE: path.join(userDataPath, "youtube.cookies.txt"),
    YOUTUBE_COOKIES_BROWSER: currentSettings.preferredBrowser || "chrome",
    YOUTUBE_COOKIES_PROFILE: currentSettings.preferredBrowserProfile || "auto",
    YOUTUBE_DOWNLOADER: "yt-dlp",
    FFMPEG_BIN: ffmpegBin,
    FFPROBE_BIN: ffprobeBin,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackend() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${DESKTOP_BACKEND_ORIGIN}/health`);
      if (response.ok) {
        backendHealthy = true;
        backendLaunchError = null;
        return true;
      }
    } catch {
      // keep polling
    }
    await delay(500);
  }
  backendHealthy = false;
  return false;
}

async function startBackend(currentSettings) {
  await stopBackend();

  backendLaunchError = null;
  backendProcessExited = false;

  const root = backendRoot();
  const logsDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  const missing = checkCriticalResources();
  if (missing.length > 0) {
    backendLaunchError = `启动失败，缺少关键资源：\n${missing.join("\n")}`;
    return;
  }

  const entryFile = path.join(root, "desktop_entry.py");
  const stdoutLog = fs.openSync(path.join(logsDir, "desktop-backend.stdout.log"), "a");
  const stderrLog = fs.openSync(path.join(logsDir, "desktop-backend.stderr.log"), "a");
  const pythonBin = resolvePythonExecutable();

  backendProcess = spawn(pythonBin, [entryFile], {
    cwd: root,
    env: backendEnv(currentSettings),
    stdio: ["ignore", stdoutLog, stderrLog],
    windowsHide: true,
  });

  backendProcess.once("exit", (code, signal) => {
    backendHealthy = false;
    backendProcessExited = true;
    backendProcess = null;
    if (code !== 0 && code !== null) {
      backendLaunchError = `Python 进程异常退出 (code=${code})`;
    }
  });

  backendProcess.once("error", (err) => {
    backendHealthy = false;
    backendProcessExited = true;
    backendProcess = null;
    backendLaunchError = `Python 进程启动失败：${err.message}`;
  });

  const started = await waitForBackend();
  if (!started && !backendLaunchError) {
    if (backendProcessExited) {
      backendLaunchError = "后端启动后立即退出，请检查日志";
    } else {
      backendLaunchError = `后端在 20 秒内未响应（端口 ${DESKTOP_BACKEND_PORT}）`;
    }
  }
}

async function stopBackend() {
  if (!backendProcess) {
    return;
  }
  backendProcess.kill();
  backendProcess = null;
  backendHealthy = false;
  await delay(250);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#ebedf0",
    title: "B站抖音下载器",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(process.resourcesPath, "web", "index.html"));
  } else {
    mainWindow.loadURL(DEFAULT_RENDERER_URL);
  }
}

function safeReadTaskMeta(taskId) {
  const currentSettings = loadSettings();
  const taskMetaPath = path.join(currentSettings.downloadDirectory, "tasks", taskId, "meta.json");
  if (!fs.existsSync(taskMetaPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(taskMetaPath, "utf8"));
  } catch {
    return null;
  }
}

async function restartBackendIfNeeded(changes) {
  if ("downloadDirectory" in changes || "preferredBrowser" in changes || "preferredBrowserProfile" in changes) {
    await startBackend(loadSettings());
  }
}

ipcMain.handle("desktop:get-settings", async () => loadSettings());

ipcMain.handle("desktop:update-settings", async (_event, changes) => {
  const currentSettings = loadSettings();
  const nextSettings = saveSettings({ ...currentSettings, ...changes });
  await restartBackendIfNeeded(changes);
  return nextSettings;
});

ipcMain.handle("desktop:choose-download-directory", async () => {
  const currentSettings = loadSettings();
  const result = await dialog.showOpenDialog({
    title: "选择下载目录",
    buttonLabel: "使用该目录",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: currentSettings.downloadDirectory || path.join(app.getPath("downloads"), "B站抖音下载器"),
  });

  if (result.canceled || !result.filePaths[0]) {
    return currentSettings;
  }

  const nextSettings = saveSettings({ ...currentSettings, downloadDirectory: result.filePaths[0] });
  await startBackend(nextSettings);
  return nextSettings;
});

ipcMain.handle("desktop:open-download-directory", async () => {
  const currentSettings = loadSettings();
  return shell.openPath(currentSettings.downloadDirectory);
});

ipcMain.handle("desktop:open-logs-directory", async () => {
  const logsDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  return shell.openPath(logsDir);
});

ipcMain.handle("desktop:export-logs", async () => {
  const logsDir = path.join(app.getPath("userData"), "logs");
  const lines = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  lines.push("=== B站抖音下载器 诊断日志 ===");
  lines.push(`导出时间: ${new Date().toLocaleString()}`);
  lines.push(`平台: ${process.platform} ${process.arch}`);
  lines.push(`Electron: ${process.versions.electron}`);
  lines.push(`后端端口: ${DESKTOP_BACKEND_PORT}`);
  lines.push(`后端健康: ${backendHealthy}`);
  lines.push(`启动错误: ${backendLaunchError || "无"}`);
  lines.push(`进程已退出: ${backendProcessExited}`);
  lines.push("");

  const missing = checkCriticalResources();
  if (missing.length > 0) {
    lines.push("=== 缺失资源 ===");
    for (const res of missing) {
      lines.push(`  - ${res}`);
    }
    lines.push("");
  }

  lines.push("=== 环境信息 ===");
  const env = backendEnv(loadSettings());
  lines.push(`FFMPEG_BIN: ${env.FFMPEG_BIN}`);
  lines.push(`FFPROBE_BIN: ${env.FFPROBE_BIN}`);
  lines.push(`TASKS_DIR: ${env.TASKS_DIR}`);
  lines.push(`APP_ENV: ${env.APP_ENV}`);
  lines.push(`QUEUE_MODE: ${env.QUEUE_MODE}`);
  lines.push("");

  const stdoutPath = path.join(logsDir, "desktop-backend.stdout.log");
  const stderrPath = path.join(logsDir, "desktop-backend.stderr.log");

  if (fs.existsSync(stderrPath)) {
    lines.push("=== 后端错误日志 (stderr, 最近 200 行) ===");
    try {
      const content = fs.readFileSync(stderrPath, "utf8");
      const tail = content.trim().split("\n").slice(-200).join("\n");
      lines.push(tail || "(空)");
    } catch {
      lines.push("(读取失败)");
    }
    lines.push("");
  }

  if (fs.existsSync(stdoutPath)) {
    lines.push("=== 后端输出日志 (stdout, 最近 100 行) ===");
    try {
      const content = fs.readFileSync(stdoutPath, "utf8");
      const tail = content.trim().split("\n").slice(-100).join("\n");
      lines.push(tail || "(空)");
    } catch {
      lines.push("(读取失败)");
    }
    lines.push("");
  }

  return { content: lines.join("\n"), filename: `downloader-log-${timestamp}.txt` };
});

ipcMain.handle("desktop:open-task-file", async (_event, payload) => {
  const task = safeReadTaskMeta(payload.taskId);
  if (!task) {
    return "Task not found";
  }

  const taskDir = path.join(loadSettings().downloadDirectory, "tasks", payload.taskId);
  let targetPath = taskDir;

  if (payload.kind === "video" && task.video_filename) {
    targetPath = path.join(taskDir, task.video_filename);
  } else if (payload.kind === "subtitle-srt" && task.subtitle_srt_filename) {
    targetPath = path.join(taskDir, task.subtitle_srt_filename);
  } else if (payload.kind === "subtitle-txt" && task.subtitle_txt_filename) {
    targetPath = path.join(taskDir, task.subtitle_txt_filename);
  }

  return shell.openPath(targetPath);
});

ipcMain.handle("desktop:get-runtime-status", async () => ({
  isDesktop: true,
  backendOrigin: DESKTOP_BACKEND_ORIGIN,
  backendHealthy,
  backendLaunchError,
  backendProcessExited,
  backendPort: DESKTOP_BACKEND_PORT,
  logDir: path.join(app.getPath("userData"), "logs"),
  missingResources: checkCriticalResources(),
  platform: process.platform,
}));

ipcMain.handle("desktop:list-recent-tasks", async (_event, limit = DEFAULT_RECENT_TASKS_LIMIT) => {
  try {
    const response = await fetch(`${DESKTOP_BACKEND_ORIGIN}/api/tasks?limit=${limit}`);
    if (!response.ok) {
      return [];
    }
    return response.json();
  } catch {
    return [];
  }
});

ipcMain.handle("desktop:get-diagnostics", async () => {
  try {
    const response = await fetch(`${DESKTOP_BACKEND_ORIGIN}/api/desktop/diagnostics`);
    if (!response.ok) {
      return null;
    }
    return response.json();
  } catch {
    return null;
  }
});

ipcMain.handle("desktop:restart-backend", async () => {
  await startBackend(loadSettings());
  return backendHealthy;
});

app.whenReady().then(async () => {
  const preparedSettings = await ensureDownloadDirectory(loadSettings());
  await startBackend(preparedSettings);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    await stopBackend();
    app.quit();
  }
});

app.on("before-quit", async () => {
  await stopBackend();
});
