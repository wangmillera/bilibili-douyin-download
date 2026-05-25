"use client";

import { useEffect, useMemo, useState } from "react";

import {
  chooseDownloadDirectory,
  fallbackDesktopRuntime,
  fallbackDesktopSettings,
  getDesktopRuntimeStatus,
  getDesktopSettings,
  hasDesktopBridge,
  openDownloadDirectory,
  openTaskFile,
  updateDesktopSettings,
} from "../lib/desktop";
import type { DesktopRuntimeStatus, DesktopSettings } from "../types/desktop";

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
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DownloaderConsole() {
  const [url, setUrl] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);
  const [subtitle, setSubtitle] = useState<SubtitleResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [runtime, setRuntime] = useState<DesktopRuntimeStatus>(fallbackDesktopRuntime);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>(fallbackDesktopSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isTerminalState = task?.status === "completed" || task?.status === "failed" || task?.status === "expired";
  const runningInDesktop = runtime.isDesktop;

  const apiUrl = (pathname: string) => `${runtime.backendOrigin || ""}${pathname}`;

  useEffect(() => {
    let active = true;

    async function boot() {
      const [nextRuntime, nextSettings] = await Promise.all([getDesktopRuntimeStatus(), getDesktopSettings()]);
      if (!active) {
        return;
      }
      setRuntime(nextRuntime);
      setDesktopSettings(nextSettings);
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

  async function refreshRecentTasks(limit = desktopSettings.recentTasksLimit || 8) {
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

  useEffect(() => {
    refreshRecentTasks().catch(() => undefined);
    const timer = window.setInterval(() => {
      refreshRecentTasks().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [desktopSettings.recentTasksLimit, runtime.backendOrigin]);

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

  useEffect(() => {
    if (!task?.subtitle_ready) {
      return;
    }

    fetch(apiUrl(`/api/tasks/${task.task_id}/subtitle`), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("字幕读取失败");
        }
        return response.json();
      })
      .then((payload: SubtitleResponse) => setSubtitle(payload))
      .catch((reason: Error) => {
        setError(reason.message);
      });
  }, [runtime.backendOrigin, task?.subtitle_ready, task?.task_id]);

  useEffect(() => {
    if (isTerminalState) {
      refreshRecentTasks().catch(() => undefined);
    }
  }, [isTerminalState]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settingsOpen]);

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

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setTask(null);
    setSubtitle(null);
    setCopied(false);

    try {
      const response = await fetch(apiUrl("/api/tasks"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

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
      setTask(nextTask);
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
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function chooseDirectory() {
    const nextSettings = await chooseDownloadDirectory();
    setDesktopSettings(nextSettings);
    setRuntime(await getDesktopRuntimeStatus());
  }

  async function changeBrowser(browser: DesktopSettings["preferredBrowser"]) {
    const nextSettings = await updateDesktopSettings({ preferredBrowser: browser });
    setDesktopSettings(nextSettings);
    setRuntime(await getDesktopRuntimeStatus());
  }

  function renderPrimaryVideoAction() {
    if (!task?.video_ready) {
      return (
        <button className="tool-button ghost" type="button" disabled>
          视频处理中
        </button>
      );
    }

    if (runningInDesktop) {
      return (
        <button className="tool-button primary" type="button" onClick={() => openTaskFile(task.task_id, "video")}>
          打开视频
        </button>
      );
    }

    return (
      <a className="tool-button primary" href={apiUrl(`/api/tasks/${task.task_id}/files/video`)}>
        下载视频
      </a>
    );
  }

  function renderPrimarySubtitleAction() {
    if (!task?.subtitle_ready) {
      return (
        <button className="tool-button ghost" type="button" disabled>
          字幕处理中
        </button>
      );
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
              <button className="tool-button ghost" type="button" onClick={() => setSettingsOpen(false)}>
                关闭
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
                <label>最近任务</label>
                <div className="path-badge">{desktopSettings.recentTasksLimit} 条</div>
              </div>
            </div>

            <div className="settings-toolbar">
              {runningInDesktop ? (
                <button className="tool-button ghost" type="button" onClick={openDownloadDirectory}>
                  打开目录
                </button>
              ) : (
                <span className="soft-note">网页预览模式</span>
              )}
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
                <span aria-hidden="true">⚙</span>
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
                <button className="tool-button primary wide" type="submit" disabled={submitting}>
                  {submitting ? "任务提交中..." : "开始处理"}
                </button>
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
                <dt>平台</dt>
                <dd>{task?.platform ?? "未开始"}</dd>
              </div>
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
                {thumbnailSrc ? <img alt={task?.title ?? "thumbnail"} src={thumbnailSrc} /> : <div className="thumbnail-shell">等待生成封面</div>}
                <div className="result-actions">
                  {renderPrimaryVideoAction()}
                  {renderPrimarySubtitleAction()}
                  {task && runningInDesktop ? (
                    <button className="tool-button ghost" type="button" onClick={() => openTaskFile(task.task_id, "task-dir")}>
                      打开任务目录
                    </button>
                  ) : null}
                  {subtitle?.content ? (
                    <button className="tool-button ghost" type="button" onClick={copySubtitle}>
                      {copied ? "已复制字幕" : "复制字幕"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="result-details">
                <div className="fact-strip">
                  <span>{task?.platform ?? "未识别平台"}</span>
                  <span>{formatDuration(task?.duration_seconds ?? null)}</span>
                  <span>
                    {task?.subtitle_source === "embedded"
                      ? "现成字幕"
                      : task?.subtitle_source === "automatic"
                        ? "自动字幕"
                        : task?.subtitle_source === "asr"
                          ? "语音转写"
                          : "等待字幕"}
                  </span>
                </div>

                {task?.error_message ? (
                  <div className="inline-banner error">
                    <strong>下载失败</strong>
                    <p>{task.error_message}</p>
                  </div>
                ) : null}

                <details className="subtitle-preview" open={Boolean(subtitle?.content)}>
                  <summary>字幕预览</summary>
                  <pre>{subtitle?.content ?? "当前任务完成后会在这里展示字幕预览。"}</pre>
                </details>
              </div>
            </div>
          </article>

          <article className="tool-panel history-panel">
            <div className="panel-heading">
              <div>
                <h2>最近任务</h2>
              </div>
              <span className="soft-note">{recentTasks.length} 条记录</span>
            </div>

            <div className="history-list">
              {recentTasks.length === 0 ? (
                <div className="history-empty">还没有历史任务。提交第一个下载任务后，这里会显示最近记录。</div>
              ) : (
                recentTasks.map((item) => (
                  <article className="history-item" key={item.task_id}>
                    <div className="history-meta">
                      <div>
                        <h3>{item.title ?? "未命名任务"}</h3>
                        <p>
                          {item.platform ?? "未知平台"} · {formatCreatedAt(item.created_at)}
                        </p>
                      </div>
                      <span className={`status-pill status-${item.status}`}>{statusLabels[item.status]}</span>
                    </div>
                    <div className="history-actions">
                      {runningInDesktop ? (
                        <>
                          <button className="mini-button" type="button" onClick={() => openTaskFile(item.task_id, "task-dir")}>
                            打开目录
                          </button>
                          {item.subtitle_ready ? (
                            <button className="mini-button" type="button" onClick={() => openTaskFile(item.task_id, "subtitle-txt")}>
                              打开字幕
                            </button>
                          ) : null}
                          {item.video_ready ? (
                            <button className="mini-button" type="button" onClick={() => openTaskFile(item.task_id, "video")}>
                              打开视频
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <button className="mini-button" type="button" onClick={() => setTask(item)}>
                          查看任务
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
