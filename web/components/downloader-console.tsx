"use client";

import { useEffect, useMemo, useState } from "react";

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

export function DownloaderConsole() {
  const enableCookieInput = process.env.NEXT_PUBLIC_ENABLE_COOKIE_INPUT === "true";
  const [url, setUrl] = useState("");
  const [cookies, setCookies] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [subtitle, setSubtitle] = useState<SubtitleResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isTerminalState = task?.status === "completed" || task?.status === "failed" || task?.status === "expired";

  useEffect(() => {
    if (!task || isTerminalState) {
      return;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/tasks/${task.task_id}`, { cache: "no-store" });
      if (!response.ok) {
        setError("任务状态读取失败");
        return;
      }
      const payload: TaskRecord = await response.json();
      setTask(payload);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [isTerminalState, task]);

  useEffect(() => {
    if (!task?.subtitle_ready) {
      return;
    }

    fetch(`/api/tasks/${task.task_id}/subtitle`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("字幕读取失败");
        }
        return response.json();
      })
      .then((payload: SubtitleResponse) => {
        setSubtitle(payload);
      })
      .catch((reason: Error) => {
        setError(reason.message);
      });
  }, [task?.subtitle_ready, task?.task_id]);

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
    return `/api/tasks/${task.task_id}/thumbnail`;
  }, [task?.task_id, task?.thumbnail_filename]);

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setTask(null);
    setSubtitle(null);
    setCopied(false);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, cookies }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "提交失败" }));
        throw new Error(payload.detail || "提交失败");
      }

      const payload: { task_id: string } = await response.json();
      const taskResponse = await fetch(`/api/tasks/${payload.task_id}`, { cache: "no-store" });
      if (!taskResponse.ok) {
        throw new Error("任务创建成功，但状态读取失败");
      }
      const nextTask: TaskRecord = await taskResponse.json();
      setTask(nextTask);
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

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">LOCAL-FIRST VIDEO TOOLCHAIN</p>
        <h1>Flux Caption Foundry</h1>
        <p className="lede">
          面向 B 站稳定支持、抖音实验支持的视频处理工作台。一个链接，完成解析、字幕提取、自动转写和文件导出。
        </p>
      </section>

      <section className="panel">
        <form className="submit-form" onSubmit={submitTask}>
          <label htmlFor="video-url">视频链接</label>
          <textarea
            id="video-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="可直接粘贴纯链接，或抖音/B站整段分享文案，系统会自动提取其中的链接"
            required
          />
          {enableCookieInput ? (
            <>
              <label htmlFor="video-cookies">临时 Cookies（可选）</label>
              <textarea
                id="video-cookies"
                value={cookies}
                onChange={(event) => setCookies(event.target.value)}
                placeholder="可直接粘贴浏览器里复制出来的整段 cookie 字符串，不要求是 cookies.txt"
              />
              <p className="field-hint">
                B 站通常不需要。抖音如果解析失败，可以在这里粘贴新鲜 cookies 重试。这里只会保留可识别的 key=value 项传给后端解析器。
              </p>
            </>
          ) : null}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "提交中..." : "开始处理"}
          </button>
        </form>

        <div className="status-column">
          <article className="status-card">
            <span className="card-label">任务状态</span>
            <strong>{statusText}</strong>
            {task ? (
              <>
                <div className="progress-track" aria-label="任务进度">
                  <div className="progress-fill" style={{ width: `${task.progress}%` }} />
                </div>
                <p className="progress-copy">{task.progress.toFixed(1)}% · {task.status_message}</p>
              </>
            ) : null}
            <p>
              {task
                ? `平台：${task.platform ?? "识别中"} / 字幕：${task.subtitle_ready ? "可用" : "处理中"} / 视频：${
                    task.video_ready ? "可用" : "处理中"
                  }`
                : "提交后将进入异步处理队列。"}
            </p>
          </article>

          <article className="status-card">
            <span className="card-label">当前限制</span>
            <ul>
              <li>B 站为稳定支持平台</li>
              <li>抖音为实验支持平台，成功率不保证</li>
              <li>仅支持公开可访问内容</li>
              <li>超长视频会被任务策略拒绝</li>
            </ul>
          </article>
        </div>
      </section>

      {error ? (
        <section className="message error">
          <strong>错误</strong>
          <p>{error}</p>
        </section>
      ) : null}

      {task ? (
        <section className="results-grid">
          <article className="result-card media-card">
            <div className="card-header">
              <span className="card-label">视频概览</span>
              <span className={`pill pill-${task.status}`}>{statusLabels[task.status]}</span>
            </div>
            <h2>{task.title ?? "正在解析标题"}</h2>
            <p className="meta">
              {task.platform ?? "未知平台"} · {task.duration_seconds ? `${task.duration_seconds}s` : "时长识别中"}
            </p>
            {thumbnailSrc ? <img alt={task.title ?? "thumbnail"} src={thumbnailSrc} /> : <div className="thumbnail-skeleton" />}
            {task.error_message ? <p className="inline-error">{task.error_message}</p> : null}
            <div className="action-row">
              <a
                className={`secondary-button ${task.video_ready ? "" : "disabled"}`}
                href={task.video_ready ? `/api/tasks/${task.task_id}/files/video` : undefined}
              >
                下载视频
              </a>
            </div>
          </article>

          <article className="result-card subtitle-card">
            <div className="card-header">
              <span className="card-label">字幕工作区</span>
              <span className="meta">
                {task.subtitle_source === "embedded"
                  ? "现成字幕"
                  : task.subtitle_source === "automatic"
                    ? "自动字幕"
                    : task.subtitle_source === "asr"
                      ? "语音转写"
                      : "等待生成"}
              </span>
            </div>
            <h2>字幕预览</h2>
            <pre>{subtitle?.content ?? "字幕生成后会显示在这里。"}</pre>
            <div className="action-row">
              <button
                className="secondary-button subtitle-copy-button"
                type="button"
                onClick={copySubtitle}
                disabled={!subtitle?.content}
              >
                {copied ? "已复制" : "复制字幕"}
              </button>
              <a
                className={`secondary-button ${task.subtitle_ready ? "" : "disabled"}`}
                href={task.subtitle_ready ? `/api/tasks/${task.task_id}/files/subtitle.srt` : undefined}
              >
                下载 SRT
              </a>
              <a
                className={`secondary-button ${task.subtitle_ready ? "" : "disabled"}`}
                href={task.subtitle_ready ? `/api/tasks/${task.task_id}/files/subtitle.txt` : undefined}
              >
                下载 TXT
              </a>
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
