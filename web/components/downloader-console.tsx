"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  chooseDownloadDirectory,
  getDesktopDiagnostics,
  fallbackDesktopRuntime,
  fallbackDesktopSettings,
  getDesktopRuntimeStatus,
  getDesktopSettings,
  hasDesktopBridge,
  openDownloadDirectory,
  openLogsDirectory,
  openTaskFile,
  restartDesktopBackend,
  updateDesktopSettings,
  exportDesktopLogs,
} from "../lib/desktop";
import type { DesktopDiagnostics, DesktopRuntimeStatus, DesktopSettings } from "../types/desktop";

type TaskStatus =
  | "queued"
  | "probing"
  | "extracting_subtitle"
  | "transcribing"
  | "downloading_video"
  | "completed"
  | "failed"
  | "expired";

type TaskRecord = {
  task_id: string;
  source_url: string;
  platform: string | null;
  title: string | null;
  thumbnail_url: string | null;
  thumbnail_filename: string | null;
  duration_seconds: number | null;
  status: TaskStatus;
  progress: number;
  status_message: string;
  subtitle_source: "embedded" | "automatic" | "asr" | "none";
  subtitle_ready: boolean;
  video_ready: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

type SubtitleResponse = {
  task_id: string;
  source: TaskRecord["subtitle_source"];
  format: string;
  content: string;
};

const statusLabels: Record<TaskStatus, string> = {
  queued: "排队中",
  probing: "解析元数据",
  extracting_subtitle: "提取字幕",
  transcribing: "自动转写",
  downloading_video: "下载视频",
  completed: "已完成",
  failed: "任务失败",
  expired: "任务已过期",
};

function formatDuration(durationSeconds: number | null): string {
  if (!durationSeconds) {
    return "时长识别中";
  }
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = durationSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function DownloaderConsole() {
  const pageSize = 5;
  const [url, setUrl] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [taskPage, setTaskPage] = useState(1);
  const [subtitle, setSubtitle] = useState<SubtitleResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 2000);
  }
  const [runtime, setRuntime] = useState<DesktopRuntimeStatus>(fallbackDesktopRuntime);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>(fallbackDesktopSettings);
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [douyinLoginActive, setDouyinLoginActive] = useState(false);
  const [douyinLoginLoading, setDouyinLoginLoading] = useState(false);
  const [douyinCookieCount, setDouyinCookieCount] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; resolve: (value: boolean) => void } | null>(null);

  function showConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => setConfirmDialog({ message, resolve }));
  }

  function dismissConfirm(value: boolean) {
    confirmDialog?.resolve(value);
    setConfirmDialog(null);
  }

  const isTerminalState = task?.status === "completed" || task?.status === "failed" || task?.status === "expired";
  const runningInDesktop = runtime.isDesktop;

  const apiUrl = (pathname: string) => `${runtime.backendOrigin || ""}${pathname}`;

  useEffect(() => {
    let active = true;

    async function boot() {
      const [nextRuntime, nextSettings] = await Promise.all([getDesktopRuntimeStatus(), getDesktopSettings()]);
      const nextDiagnostics = await getDesktopDiagnostics();
      if (!active) {
        return;
      }
      setRuntime(nextRuntime);
      setDesktopSettings(nextSettings);
      setDiagnostics(nextDiagnostics);
    }

    boot().catch(() => {
      if (!active) {
        return;
      }
      setRuntime(fallbackDesktopRuntime);
      setDesktopSettings(fallbackDesktopSettings);
    });

    return () => {
      active = false;
    };
  }, []);

  async function refreshRecentTasks(limit = 200) {
    try {
      if (hasDesktopBridge()) {
        const tasks = (await window.desktopBridge!.listRecentTasks(limit)) as TaskRecord[];
        setRecentTasks(tasks);
        return;
      }

      const response = await fetch(apiUrl(`/api/tasks?limit=${limit}`), { cache: "no-store" });
      if (!response.ok) {
        throw new Error("最近任务读取失败");
      }
      const tasks: TaskRecord[] = await response.json();
      setRecentTasks(tasks);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "最近任务读取失败");
    }
  }

  async function selectTask(nextTask: TaskRecord) {
    setSelectedTaskId(nextTask.task_id);
    setTask(nextTask);
    setSubtitle(null);
    setToastMessage(null);
    setPlayerOpen(false);
  }

  useEffect(() => {
    refreshRecentTasks().catch(() => undefined);
    const timer = window.setInterval(() => {
      refreshRecentTasks().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [runtime.backendOrigin]);

  useEffect(() => {
    if (recentTasks.length === 0) {
      setTaskPage(1);
      return;
    }

    if (!selectedTaskId) {
      const latestTask = recentTasks[0];
      setSelectedTaskId(latestTask.task_id);
      setTask(latestTask);
      return;
    }

    const matchingTask = recentTasks.find((item) => item.task_id === selectedTaskId);
    if (matchingTask) {
      setTask((currentTask) =>
        currentTask?.task_id === matchingTask.task_id ? { ...currentTask, ...matchingTask } : matchingTask,
      );
    }
  }, [recentTasks, selectedTaskId]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(recentTasks.length / pageSize));
    if (taskPage > totalPages) {
      setTaskPage(totalPages);
    }
  }, [recentTasks.length, taskPage]);

  useEffect(() => {
    if (!task || isTerminalState) {
      return;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(apiUrl(`/api/tasks/${task.task_id}`), { cache: "no-store" });
      if (!response.ok) {
        setError("任务状态读取失败");
        return;
      }
      const payload: TaskRecord = await response.json();
      setTask(payload);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [isTerminalState, runtime.backendOrigin, task]);

  const subtitleAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!task?.subtitle_ready) {
      return;
    }

    subtitleAbortRef.current?.abort();
    const controller = new AbortController();
    subtitleAbortRef.current = controller;

    fetch(apiUrl(`/api/tasks/${task.task_id}/subtitle`), { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("字幕读取失败");
        }
        return response.json();
      })
      .then((payload: SubtitleResponse) => setSubtitle(payload))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") {
          setError(reason.message);
        }
      });
  }, [runtime.backendOrigin, task?.subtitle_ready, task?.task_id]);

  useEffect(() => {
    if (isTerminalState) {
      refreshRecentTasks().catch(() => undefined);
    }
    if (task?.status === "completed") {
      setUrl("");
    }
  }, [isTerminalState]);

  useEffect(() => {
    if (!settingsOpen && !playerOpen && !confirmDialog) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setPlayerOpen(false);
        dismissConfirm(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playerOpen, settingsOpen, confirmDialog]);

  const statusText = useMemo(() => {
    if (!task) {
      return "等待提交";
    }
    return statusLabels[task.status];
  }, [task]);

  const thumbnailSrc = useMemo(() => {
    if (!task?.thumbnail_filename) {
      return null;
    }
    return apiUrl(`/api/tasks/${task.task_id}/thumbnail`);
  }, [runtime.backendOrigin, task?.task_id, task?.thumbnail_filename]);

  const videoSrc = useMemo(() => {
    if (!task?.video_ready) {
      return null;
    }
    return apiUrl(`/api/tasks/${task.task_id}/files/video`);
  }, [runtime.backendOrigin, task?.task_id, task?.video_ready]);

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setTask(null);
    setSelectedTaskId(null);
    setSubtitle(null);
    setToastMessage(null);
    setPlayerOpen(false);

    try {
      let response = await fetch(apiUrl("/api/tasks"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (response.status === 409) {
        const { detail: dupTask } = await response.json();
        const confirmed = await showConfirm(
          `该链接已成功下载过：\n\n「${dupTask.title ?? "未命名任务"}」\n\n下载时间：${formatCreatedAt(dupTask.created_at)}\n\n是否仍然重新下载？`
        );
        if (!confirmed) {
          setSubmitting(false);
          return;
        }
        response = await fetch(apiUrl("/api/tasks?allow_duplicate=true"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "提交失败" }));
        throw new Error(payload.detail || "提交失败");
      }

      const payload: { task_id: string } = await response.json();
      const taskResponse = await fetch(apiUrl(`/api/tasks/${payload.task_id}`), { cache: "no-store" });
      if (!taskResponse.ok) {
        throw new Error("任务创建成功，但状态读取失败");
      }
      const nextTask: TaskRecord = await taskResponse.json();
      setSelectedTaskId(nextTask.task_id);
      setTask(nextTask);
      setPlayerOpen(false);
      refreshRecentTasks().catch(() => undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function copySubtitle() {
    if (!subtitle?.content) {
      return;
    }
    await navigator.clipboard.writeText(subtitle.content);
    showToast("字幕已复制");
  }

  function isDouyinCookieError(message: string | null | undefined): boolean {
    if (!message) {
      return false;
    }
    return (
      message.includes("douyin-downloader 未能读取视频详情") ||
      message.includes("请确认本机 Chrome 已登录抖音") ||
      message.includes("当前 cookies 可能仍然失效") ||
      message.includes("当前 cookies 已失效或不够新鲜")
    );
  }

  async function startDouyinLogin() {
    setDouyinLoginLoading(true);
    try {
      const response = await fetch(apiUrl("/api/douyin/cookies/login"), { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "启动失败" }));
        throw new Error(payload.detail || "启动失败");
      }
      setDouyinLoginActive(true);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "浏览器启动失败");
    } finally {
      setDouyinLoginLoading(false);
    }
  }

  async function exportDouyinCookies() {
    setDouyinLoginLoading(true);
    try {
      const response = await fetch(apiUrl("/api/douyin/cookies/export"), { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "导出失败" }));
        throw new Error(payload.detail || "导出失败");
      }
      const result: { cookie_count: number; key_cookies: string[]; file: string } = await response.json();
      setDouyinCookieCount(result.cookie_count);
      setDouyinLoginActive(false);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cookie 导出失败");
    } finally {
      setDouyinLoginLoading(false);
    }
  }

  async function cancelDouyinLogin() {
    setDouyinLoginLoading(true);
    try {
      await fetch(apiUrl("/api/douyin/cookies/cancel"), { method: "POST" });
    } catch {
      // ignore
    }
    setDouyinLoginActive(false);
    setDouyinLoginLoading(false);
  }

  async function chooseDirectory() {
    const nextSettings = await chooseDownloadDirectory();
    setDesktopSettings(nextSettings);
    setRuntime(await getDesktopRuntimeStatus());
    setDiagnostics(await getDesktopDiagnostics());
  }

  async function changeBrowser(browser: DesktopSettings["preferredBrowser"]) {
    const nextSettings = await updateDesktopSettings({ preferredBrowser: browser });
    setDesktopSettings(nextSettings);
    setRuntime(await getDesktopRuntimeStatus());
    setDiagnostics(await getDesktopDiagnostics());
  }

  async function changeBrowserProfile(profile: string) {
    const nextSettings = await updateDesktopSettings({ preferredBrowserProfile: profile });
    setDesktopSettings(nextSettings);
    setRuntime(await getDesktopRuntimeStatus());
    setDiagnostics(await getDesktopDiagnostics());
  }

  async function deleteTask(taskId: string) {
    try {
      const confirmed = await showConfirm("确定删除这条任务记录及其本地文件吗？");
      if (!confirmed) {
        return;
      }
      const response = await fetch(apiUrl(`/api/tasks/${taskId}`), { method: "DELETE" });
      if (!response.ok) {
        throw new Error("删除任务失败");
      }
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
        setTask(null);
        setSubtitle(null);
        setToastMessage(null);
        setPlayerOpen(false);
      }
      await refreshRecentTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除任务失败");
    }
  }

  async function cancelTask(taskId: string) {
    try {
      const confirmed = await showConfirm("确定要终止这个任务吗？");
      if (!confirmed) {
        return;
      }
      const response = await fetch(apiUrl(`/api/tasks/${taskId}/cancel`), { method: "POST" });
      if (!response.ok) {
        throw new Error("终止任务失败");
      }
      await refreshRecentTasks();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "终止任务失败");
    }
  }

  const totalPages = Math.max(1, Math.ceil(recentTasks.length / pageSize));
  const pagedTasks = useMemo(() => {
    const start = (taskPage - 1) * pageSize;
    return recentTasks.slice(start, start + pageSize);
  }, [recentTasks, taskPage]);

  function renderPrimaryVideoAction() {
    if (!task?.video_ready) {
      return null;
    }

    if (runningInDesktop) {
      return null;
    }

    return (
      <a className="tool-button ghost" href={apiUrl(`/api/tasks/${task.task_id}/files/video`)}>
        下载视频
      </a>
    );
  }

  function renderPrimarySubtitleAction() {
    if (!task?.subtitle_ready) {
      return null;
    }

    if (runningInDesktop) {
      return (
        <button className="tool-button ghost" type="button" onClick={() => openTaskFile(task.task_id, "subtitle-txt")}>
          打开字幕
        </button>
      );
    }

    return (
      <a className="tool-button ghost" href={apiUrl(`/api/tasks/${task.task_id}/files/subtitle.txt`)}>
        下载字幕
      </a>
    );
  }

  return (
    <main className="desktop-shell">
      {runningInDesktop && !runtime.backendHealthy && runtime.backendLaunchError ? (
        <section className="backend-error-panel">
          <div className="backend-error-content">
            <h2>本地服务启动失败</h2>
            <p className="backend-error-message">{runtime.backendLaunchError}</p>
            {runtime.missingResources.length > 0 ? (
              <ul className="backend-error-list">
                {runtime.missingResources.map((res, i) => (
                  <li key={i}>{res}</li>
                ))}
              </ul>
            ) : null}
            <div className="backend-error-actions">
              <button className="tool-button ghost" type="button" onClick={async () => {
                await restartDesktopBackend();
                setRuntime(await getDesktopRuntimeStatus());
              }}>
                重新启动
              </button>
              {runtime.logDir ? (
                <button className="tool-button ghost" type="button" onClick={() => openLogsDirectory()}>
                  打开日志目录
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      {settingsOpen ? (
        <div className="settings-modal-shell" aria-hidden={false} onClick={() => setSettingsOpen(false)}>
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <h2 id="settings-modal-title">下载目录与浏览器</h2>
                <p className="panel-copy">桌面版默认自动处理浏览器 cookies 与本地下载目录，高级调试项不会展示在主页面。</p>
              </div>
              <button className="icon-button modal-close-button" type="button" aria-label="关闭设置" title="关闭" onClick={() => setSettingsOpen(false)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path d="M7 7L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="settings-grid">
              <div className="setting-block">
                <label>下载目录</label>
                <div className="path-badge">{desktopSettings.downloadDirectory || "桌面版首次启动时选择目录"}</div>
              </div>
              <div className="settings-actions">
                <button className="tool-button ghost" type="button" onClick={chooseDirectory} disabled={!runningInDesktop}>
                  选择目录
                </button>
              </div>
            </div>

            <div className="settings-grid compact">
              <div className="setting-block">
                <label>浏览器来源</label>
                <select
                  value={desktopSettings.preferredBrowser}
                  onChange={(event) => changeBrowser(event.target.value as DesktopSettings["preferredBrowser"])}
                  disabled={!runningInDesktop}
                >
                  <option value="chrome">Chrome</option>
                  <option value="edge">Edge</option>
                  <option value="safari">Safari</option>
                </select>
              </div>
              <div className="setting-block">
                <label>浏览器 Profile</label>
                <select
                  value={desktopSettings.preferredBrowserProfile}
                  onChange={(event) => changeBrowserProfile(event.target.value)}
                  disabled={!runningInDesktop}
                >
                  {(diagnostics?.candidate_profiles?.length
                    ? diagnostics.candidate_profiles
                    : ["auto", "Default", "Profile 1"]).map((profile) => (
                    <option key={profile} value={profile}>
                      {profile}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="diagnostics-panel">
              <div className="diagnostics-row">
                <span>抖音 Cookie 数量</span>
                <strong>{diagnostics ? diagnostics.douyin_cookie_count : "--"}</strong>
              </div>
              <div className="diagnostics-row">
                <span>浏览器配置</span>
                <strong>{diagnostics?.selected_profile || desktopSettings.preferredBrowserProfile}</strong>
              </div>
              <div className="diagnostics-row">
                <span>Cookie 来源</span>
                <strong>{diagnostics?.cookie_read_method || "未检测到"}</strong>
              </div>
              <div className="diagnostics-row">
                <span>抖音下载工具</span>
                <strong>
                  {diagnostics?.douyin_helper_repo_exists && diagnostics?.douyin_helper_python_exists ? "已就绪" : "未安装"}
                </strong>
              </div>
              <div className="diagnostics-row">
                <span>FFmpeg</span>
                <strong>
                  {diagnostics?.ffmpeg_exists && diagnostics?.ffprobe_exists ? "已就绪" : "未安装"}
                </strong>
              </div>
              {diagnostics?.cookie_read_error ? <p className="diagnostics-error">{diagnostics.cookie_read_error}</p> : null}
            </div>

            <div className="settings-grid">
              <div className="setting-block">
                <label>抖音登录状态</label>
                <div className="path-badge">
                  {douyinCookieCount !== null
                    ? `已获取 ${douyinCookieCount} 个抖音 Cookie`
                    : douyinLoginActive
                      ? "等待登录中..."
                      : diagnostics && diagnostics.douyin_cookie_count > 0
                        ? `浏览器读取了 ${diagnostics.douyin_cookie_count} 个 Cookie`
                        : "未获取抖音 Cookie"}
                </div>
              </div>
              <div className="settings-actions">
                {douyinLoginActive ? (
                  <>
                    <button className="tool-button ghost" type="button" onClick={exportDouyinCookies} disabled={douyinLoginLoading}>
                      {douyinLoginLoading ? "导出中..." : "已完成登录"}
                    </button>
                    <button className="tool-button ghost" type="button" onClick={cancelDouyinLogin} disabled={douyinLoginLoading}>
                      取消
                    </button>
                  </>
                ) : (
                  <button className="tool-button ghost" type="button" onClick={startDouyinLogin} disabled={douyinLoginLoading}>
                    {douyinLoginLoading ? "启动中..." : "登录抖音"}
                  </button>
                )}
              </div>
            </div>
            {douyinLoginActive ? (
              <p className="panel-copy" style={{ padding: "0 12px 12px", color: "var(--info-color)" }}>
                已在你的默认浏览器中打开抖音。登录后回到本页面，点击「已完成登录」按钮导入 Cookie。
              </p>
            ) : null}
            {douyinCookieCount !== null ? (
              <p className="panel-copy" style={{ padding: "0 12px 12px", color: "var(--success-color)" }}>
                已保存 {douyinCookieCount} 个 Cookie，现在可以下载抖音视频了。
              </p>
            ) : null}

            <div className="settings-toolbar">
              {runningInDesktop ? (
                <>
                  <button className="tool-button ghost" type="button" onClick={openDownloadDirectory}>
                    打开目录
                  </button>
                  <button className="tool-button ghost" type="button" onClick={openLogsDirectory}>
                    打开日志
                  </button>
                  <button className="tool-button ghost" type="button" onClick={async () => {
                    const result = await exportDesktopLogs();
                    if (!result) return;
                    const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = result.filename;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast("日志已导出");
                  }}>
                    导出日志
                  </button>
                </>
              ) : (
                <span className="soft-note">网页预览模式</span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {playerOpen && videoSrc ? (
        <div className="settings-modal-shell" aria-hidden={false} onClick={() => setPlayerOpen(false)}>
          <div
            className="player-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <h2 id="player-modal-title">{task?.title ?? "视频预览"}</h2>
              </div>
              <button className="icon-button modal-close-button" type="button" aria-label="关闭播放器" title="关闭" onClick={() => setPlayerOpen(false)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path d="M7 7L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="player-shell">
              <video controls autoPlay playsInline src={videoSrc} />
            </div>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="settings-modal-shell" aria-hidden={false} onClick={() => dismissConfirm(false)}>
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="confirm-message">{confirmDialog.message}</p>
            <div className="confirm-actions">
              <button className="tool-button ghost" type="button" onClick={() => dismissConfirm(false)}>
                取消
              </button>
              <button className="tool-button primary" type="button" onClick={() => dismissConfirm(true)}>
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="workspace">
        <aside className="control-rail">
          <article className="tool-panel submission-panel">
            <div className="panel-heading">
              <div>
                <h2>输入链接并启动处理</h2>
              </div>
              <button className="icon-button" type="button" aria-label="打开设置" title="设置" onClick={() => setSettingsOpen(true)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M10.29 3.86L9.94 5.41C9.84 5.86 9.55 6.24 9.13 6.44C8.71 6.63 8.22 6.63 7.79 6.43L6.31 5.75L4.77 7.29L5.45 8.77C5.65 9.2 5.65 9.69 5.46 10.11C5.26 10.53 4.88 10.82 4.43 10.92L2.88 11.27V13.45L4.43 13.8C4.88 13.9 5.26 14.19 5.46 14.61C5.65 15.03 5.65 15.52 5.45 15.95L4.77 17.43L6.31 18.97L7.79 18.29C8.22 18.09 8.71 18.09 9.13 18.28C9.55 18.48 9.84 18.86 9.94 19.31L10.29 20.86H12.47L12.82 19.31C12.92 18.86 13.21 18.48 13.63 18.28C14.05 18.09 14.54 18.09 14.97 18.29L16.45 18.97L17.99 17.43L17.31 15.95C17.11 15.52 17.11 15.03 17.3 14.61C17.5 14.19 17.88 13.9 18.33 13.8L19.88 13.45V11.27L18.33 10.92C17.88 10.82 17.5 10.53 17.3 10.11C17.11 9.69 17.11 9.2 17.31 8.77L17.99 7.29L16.45 5.75L14.97 6.43C14.54 6.63 14.05 6.63 13.63 6.44C13.21 6.24 12.92 5.86 12.82 5.41L12.47 3.86H10.29Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="11.38" cy="12.36" r="3.1" fill="currentColor" />
                </svg>
              </button>
            </div>

            <form className="desktop-form" onSubmit={submitTask}>
              <textarea
                id="video-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="粘贴 B 站、抖音、YouTube 链接，或抖音 / B 站整段分享文案"
                required
              />
              <div className="form-actions">
                <button className="tool-button primary wide" type="submit" disabled={submitting || !url.trim() || (!!task && !isTerminalState)}>
                  {submitting ? "任务提交中..." : !url.trim() ? "请输入链接" : !!task && !isTerminalState ? "正在处理中..." : "开始处理"}
                </button>
                {task && !isTerminalState ? (
                  <button
                    className="tool-button ghost wide"
                    type="button"
                    onClick={() => cancelTask(task.task_id).catch(() => undefined)}
                  >
                    终止任务
                  </button>
                ) : null}
                {task?.status === "failed" ? (
                  <button
                    className="tool-button ghost wide"
                    type="button"
                    onClick={async () => {
                      const retryUrl = task.source_url;
                      setUrl(retryUrl);
                      setSubmitting(true);
                      setError(null);
                      setTask(null);
                      setSelectedTaskId(null);
                      setSubtitle(null);
                      setToastMessage(null);
                      setPlayerOpen(false);
                      try {
                        const response = await fetch(apiUrl("/api/tasks?allow_duplicate=true"), {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ url: retryUrl }),
                        });
                        if (!response.ok) {
                          const payload = await response.json().catch(() => ({ detail: "重试失败" }));
                          throw new Error(payload.detail || "重试失败");
                        }
                        const payload: { task_id: string } = await response.json();
                        const taskResponse = await fetch(apiUrl(`/api/tasks/${payload.task_id}`), { cache: "no-store" });
                        if (!taskResponse.ok) {
                          throw new Error("任务创建成功，但状态读取失败");
                        }
                        const nextTask: TaskRecord = await taskResponse.json();
                        setSelectedTaskId(nextTask.task_id);
                        setTask(nextTask);
                        refreshRecentTasks().catch(() => undefined);
                      } catch (reason) {
                        setError(reason instanceof Error ? reason.message : "重试失败");
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    disabled={submitting}
                  >
                    重试任务
                  </button>
                ) : null}
              </div>
            </form>
          </article>

          <article className="tool-panel status-panel">
            <div className="panel-heading">
              <div>
                <h2>{statusText}</h2>
              </div>
              {task ? <span className={`status-pill status-${task.status}`}>{task.progress.toFixed(1)}%</span> : null}
            </div>
            <div className="progress-stack">
              <div className="progress-track" aria-label="任务进度">
                <div className="progress-fill" style={{ width: `${task?.progress ?? 0}%` }} />
              </div>
              <p className="panel-copy">{task ? task.status_message : "等待新的下载任务。"}</p>
            </div>
            <dl className="facts-grid">
              <div>
                <dt>字幕</dt>
                <dd>{task?.subtitle_ready ? "已生成" : "处理中"}</dd>
              </div>
              <div>
                <dt>视频</dt>
                <dd>{task?.video_ready ? "已生成" : "处理中"}</dd>
              </div>
              <div>
                <dt>时长</dt>
                <dd>{formatDuration(task?.duration_seconds ?? null)}</dd>
              </div>
            </dl>
            {error ? (
              <div className="inline-banner error">
                <strong>错误</strong>
                <p>{error}</p>
              </div>
            ) : null}
            {isDouyinCookieError(error) || isDouyinCookieError(task?.error_message) ? (
              <div className="inline-banner info" style={{ marginTop: 8 }}>
                <p>需要先登录抖音获取 Cookie 才能下载。请在设置中点击「登录抖音」，或在此直接操作：</p>
                {douyinLoginActive ? (
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button className="tool-button ghost" type="button" onClick={exportDouyinCookies} disabled={douyinLoginLoading}>
                      {douyinLoginLoading ? "导出中..." : "已完成登录，导出 Cookie"}
                    </button>
                    <button className="tool-button ghost" type="button" onClick={cancelDouyinLogin} disabled={douyinLoginLoading}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button className="tool-button ghost" type="button" onClick={startDouyinLogin} disabled={douyinLoginLoading} style={{ marginTop: 6 }}>
                    {douyinLoginLoading ? "启动中..." : "打开浏览器登录抖音"}
                  </button>
                )}
                {douyinLoginActive ? (
                  <p style={{ marginTop: 6, color: "var(--info-color)", fontSize: "0.85rem" }}>
                    请在打开的浏览器中登录抖音，然后点击上方按钮导入 Cookie。
                  </p>
                ) : null}
                {douyinCookieCount !== null ? (
                  <p style={{ marginTop: 6, color: "var(--success-color)", fontSize: "0.85rem" }}>
                    已保存 {douyinCookieCount} 个 Cookie，请重新提交下载链接。
                  </p>
                ) : null}
              </div>
            ) : null}
          </article>
        </aside>

        <section className="result-stage">
          <article className="tool-panel current-result-panel">
            <div className="panel-heading">
              <div>
                <h2>{task?.title ?? "当前还没有结果"}</h2>
              </div>
              {task ? <span className={`status-pill status-${task.status}`}>{statusLabels[task.status]}</span> : null}
            </div>

            <div className="result-layout">
              <div className="media-preview">
                {thumbnailSrc ? (
                  <button
                    className={`thumbnail-button${task?.video_ready ? " thumbnail-button-playable" : ""}`}
                    type="button"
                    onClick={() => {
                      if (task?.video_ready) {
                        setPlayerOpen(true);
                      }
                    }}
                    disabled={!task?.video_ready}
                    aria-label={task?.video_ready ? "播放视频" : "等待生成封面"}
                  >
                    <img alt={task?.title ?? "thumbnail"} src={thumbnailSrc} />
                    {task?.video_ready ? (
                      <span className="play-overlay" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 6.8V17.2C8 17.82 8.68 18.21 9.23 17.89L17.66 13.09C18.22 12.77 18.22 11.97 17.66 11.65L9.23 6.11C8.68 5.79 8 6.18 8 6.8Z" />
                        </svg>
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <div className="thumbnail-shell">等待生成封面</div>
                )}
                <div className="result-actions">
                  {renderPrimaryVideoAction()}
                  {renderPrimarySubtitleAction()}
                  {task && runningInDesktop ? (
                    <button className="tool-button ghost" type="button" onClick={() => openTaskFile(task.task_id, "task-dir")}>
                      打开视频目录
                    </button>
                  ) : null}
                  {subtitle?.content ? (
                    <button className="tool-button ghost" type="button" onClick={copySubtitle}>
                      复制字幕
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="result-details">
                {task?.error_message ? (
                  <div className="inline-banner error">
                    <strong>下载失败</strong>
                    <p>{task.error_message}</p>
                  </div>
                ) : null}
                {isDouyinCookieError(task?.error_message) ? (
                  <div className="inline-banner info" style={{ marginTop: 8 }}>
                    <p>需要先登录抖音获取 Cookie。请打开设置面板，点击「登录抖音」按钮，登录完成后重新提交下载链接即可。</p>
                  </div>
                ) : null}

                <details key={task?.task_id} className="subtitle-preview" open>
                  <summary>字幕预览</summary>
                  {subtitle?.content ? (
                    <pre>{subtitle.content}</pre>
                  ) : (
                    <div className="subtitle-placeholder">暂无字幕</div>
                  )}
                </details>
              </div>
            </div>
          </article>

          <article className="tool-panel history-panel">
            <div className="panel-heading">
              <div>
                <h2>任务列表</h2>
              </div>
              <span className="soft-note">
                第 {taskPage} / {totalPages} 页
              </span>
            </div>

            <div className="history-list">
              {recentTasks.length === 0 ? (
                <div className="history-empty">还没有历史任务。提交第一个下载任务后，这里会显示最近记录。</div>
              ) : (
                pagedTasks.map((item) => (
                  <article
                    className={`history-item${selectedTaskId === item.task_id ? " history-item-selected" : ""}`}
                    key={item.task_id}
                    onClick={() => selectTask(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectTask(item).catch(() => undefined);
                      }
                    }}
                  >
                    {item.thumbnail_filename ? (
                      <img
                        className="history-thumbnail"
                        alt=""
                        src={apiUrl(`/api/tasks/${item.task_id}/thumbnail`)}
                      />
                    ) : (
                      <div className="history-thumbnail history-thumbnail-empty" />
                    )}
                    <div className="history-body">
                      <div className="history-header">
                        <h3>{item.title ?? "未命名任务"}</h3>
                        <span className={`status-pill status-${item.status}`}>{statusLabels[item.status]}</span>
                      </div>
                      <div className="history-info">
                        <span>时长 {formatDuration(item.duration_seconds)}</span>
                        <span>{formatCreatedAt(item.created_at)}</span>
                      </div>
                      <div className="history-actions">
                        {runningInDesktop ? (
                          <>
                            <button
                              className="mini-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openTaskFile(item.task_id, "task-dir").catch(() => undefined);
                              }}
                            >
                              打开目录
                            </button>
                            {item.subtitle_ready ? (
                              <button
                                className="mini-button"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openTaskFile(item.task_id, "subtitle-txt").catch(() => undefined);
                                }}
                              >
                                打开字幕
                              </button>
                            ) : null}
                            {item.video_ready ? (
                              <button
                                className="mini-button"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openTaskFile(item.task_id, "video").catch(() => undefined);
                                }}
                              >
                                打开视频
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <button
                            className="mini-button"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setTask(item);
                            }}
                          >
                            查看任务
                          </button>
                        )}
                        <button
                          className="mini-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigator.clipboard.writeText(item.source_url).then(() => showToast("链接已复制")).catch(() => undefined);
                          }}
                        >
                          复制链接
                        </button>
                        {item.status !== "completed" && item.status !== "failed" && item.status !== "expired" ? (
                          <button
                            className="mini-button"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              cancelTask(item.task_id).catch(() => undefined);
                            }}
                          >
                            终止
                          </button>
                        ) : null}
                        <button
                          className="mini-button mini-button-danger"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteTask(item.task_id).catch(() => undefined);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
            {recentTasks.length > 0 ? (
              <div className="history-pagination">
                <button className="mini-button" type="button" disabled={taskPage <= 1} onClick={() => setTaskPage((page) => Math.max(1, page - 1))}>
                  上一页
                </button>
                <div className="page-jump-group">
                  {Array.from({ length: totalPages }, (_, index) => {
                    const page = index + 1;
                    return (
                      <button
                        key={page}
                        className={`mini-button page-number-button${page === taskPage ? " page-number-button-active" : ""}`}
                        type="button"
                        onClick={() => setTaskPage(page)}
                      >
                        {page}
                      </button>
                    );
                  })}
                </div>
                <button
                  className="mini-button"
                  type="button"
                  disabled={taskPage >= totalPages}
                  onClick={() => setTaskPage((page) => Math.min(totalPages, page + 1))}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </article>
        </section>
      </section>
      {toastMessage ? <div className="toast" role="status">{toastMessage}</div> : null}
    </main>
  );
}
