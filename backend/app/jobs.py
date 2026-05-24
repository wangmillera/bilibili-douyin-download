from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import settings
from .downloader import download_thumbnail, download_video, probe_video, try_download_subtitles
from .douyin_adapter import download_douyin_video, is_douyin_url, probe_douyin_video
from .task_store import get_task_dir, update_task
from .transcription import transcribe_media


def detect_platform(info: dict[str, Any]) -> str:
    extractor = info.get("extractor_key") or info.get("extractor") or "unknown"
    return str(extractor)


def process_task(task_id: str, url: str, cookies: str | None = None) -> None:
    task_dir = get_task_dir(task_id)
    def set_progress(progress: float, status_message: str, **extra: object) -> None:
        update_task(
            task_id,
            progress=round(max(0, min(100, progress)), 1),
            status_message=status_message,
            **extra,
        )

    try:
        set_progress(5, "正在解析视频信息", status="probing")
        uses_douyin_downloader = is_douyin_url(url)
        info = (
            probe_douyin_video(url, task_dir, cookies)
            if uses_douyin_downloader
            else probe_video(url, cookies, task_dir)
        )
        duration = int(info.get("duration") or 0) or None
        if duration and duration > settings.max_video_duration_seconds:
            raise ValueError(f"Video duration exceeds {settings.max_video_duration_seconds} seconds")

        thumbnail_filename = None
        thumbnail_url = info.get("thumbnail")
        if thumbnail_url:
            try:
                thumbnail_path = download_thumbnail(str(thumbnail_url), task_dir)
                thumbnail_filename = thumbnail_path.name if thumbnail_path else None
            except Exception:
                thumbnail_filename = None

        set_progress(
            18,
            "视频信息解析完成",
            title=info.get("title"),
            platform=detect_platform(info),
            thumbnail_url=info.get("thumbnail"),
            thumbnail_filename=thumbnail_filename,
            duration_seconds=duration,
        )

        subtitles_found = False
        subtitle_source = "none"
        if uses_douyin_downloader:
            set_progress(25, "抖音链路已切换到 douyin-downloader，跳过现成字幕提取", status="extracting_subtitle")
            set_progress(45, "准备自动转写抖音视频")
        else:
            set_progress(25, "正在提取现成字幕", status="extracting_subtitle")
            subtitles_found, subtitle_source = try_download_subtitles(url, task_dir, cookies)
            if subtitles_found:
                set_progress(45, "现成字幕提取完成")
            else:
                set_progress(45, "未找到现成字幕，准备自动转写")

        set_progress(55, "开始下载视频", status="downloading_video")
        video_path = (
            download_douyin_video(url, task_dir, progress_callback=set_progress, cookies=cookies)
            if uses_douyin_downloader
            else download_video(url, task_dir, progress_callback=set_progress, cookies=cookies)
        )

        subtitle_srt_path = task_dir / "subtitle.srt"
        subtitle_txt_path = task_dir / "subtitle.txt"

        if not subtitles_found:
            set_progress(55, "开始语音转写", status="transcribing")
            transcribe_media(
                video_path,
                subtitle_srt_path,
                subtitle_txt_path,
                duration_seconds=duration,
                progress_callback=set_progress,
            )
            subtitle_source = "asr"

        update_task(
            task_id,
            status="completed",
            progress=100,
            status_message="视频和字幕处理完成",
            subtitle_source=subtitle_source,
            subtitle_ready=subtitle_srt_path.exists() and subtitle_txt_path.exists(),
            video_ready=video_path.exists(),
            video_filename=video_path.name,
            subtitle_srt_filename=subtitle_srt_path.name if subtitle_srt_path.exists() else None,
            subtitle_txt_filename=subtitle_txt_path.name if subtitle_txt_path.exists() else None,
            error_code=None,
            error_message=None,
        )
    except Exception as exc:
        update_task(
            task_id,
            status="failed",
            status_message="处理失败",
            error_code=exc.__class__.__name__,
            error_message=map_error_message(str(exc), cookies_supplied=bool(cookies and cookies.strip())),
        )


def map_error_message(message: str, cookies_supplied: bool) -> str:
    if "Unsupported Douyin URL" in message:
        return "抖音解析失败：当前链接不是 douyin-downloader 支持的标准视频地址或短链。"
    if "Failed to get Douyin video detail" in message:
        if cookies_supplied:
            return "抖音解析失败：douyin-downloader 未能读取视频详情，当前 cookies 可能仍然失效。"
        return "抖音解析失败：douyin-downloader 未能读取视频详情，可能仍然需要新鲜 cookies。"
    if "Fresh cookies" in message or "cookies" in message.lower() and "douyin" in message.lower():
        if cookies_supplied:
            return "抖音解析失败：当前 cookies 已失效或不够新鲜，请重新从浏览器复制最新 cookies 后再试。"
        return "抖音解析失败：该视频需要新鲜 cookies。请在页面下方粘贴浏览器中的临时 cookies 后重试。"
    return message
