from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from .config import settings
from .downloader import check_video_compatibility, download_thumbnail, download_video, probe_video, try_download_subtitles
from .douyin_adapter import download_douyin_video, is_douyin_url, probe_douyin_video
from .task_store import get_task_dir, update_task
from .transcription import transcribe_media

_cancel_events: dict[str, threading.Event] = {}


def cancel_task(task_id: str) -> bool:
    event = _cancel_events.get(task_id)
    if event is None:
        return False
    event.set()
    return True


def _is_cancelled(task_id: str) -> bool:
    return _cancel_events.get(task_id, threading.Event()).is_set()


def detect_platform(info: dict[str, Any]) -> str:
    extractor = info.get("extractor_key") or info.get("extractor") or "unknown"
    return str(extractor)


def process_task(task_id: str, url: str, cookies: str | None = None, download_subtitles: bool = True) -> None:
    task_dir = get_task_dir(task_id)
    cancel_event = threading.Event()
    _cancel_events[task_id] = cancel_event

    def set_progress(progress: float, status_message: str, **extra: object) -> None:
        update_task(
            task_id,
            progress=round(max(0, min(100, progress)), 1),
            status_message=status_message,
            **extra,
        )

    try:
        if _is_cancelled(task_id):
            raise CancelledError("任务已被用户终止")

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
        if download_subtitles:
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
        else:
            set_progress(25, "已跳过字幕下载", status="downloading_video")

        set_progress(55, "开始下载视频", status="downloading_video")
        if _is_cancelled(task_id):
            raise CancelledError("任务已被用户终止")

        video_path = (
            download_douyin_video(url, task_dir, progress_callback=set_progress, cookies=cookies)
            if uses_douyin_downloader
            else download_video(url, task_dir, progress_callback=set_progress, cookies=cookies)
        )

        subtitle_srt_path = task_dir / "subtitle.srt"
        subtitle_txt_path = task_dir / "subtitle.txt"

        if download_subtitles and not subtitles_found:
            set_progress(55, "开始语音转写", status="transcribing")
            if _is_cancelled(task_id):
                raise CancelledError("任务已被用户终止")
            transcribe_media(
                video_path,
                subtitle_srt_path,
                subtitle_txt_path,
                duration_seconds=duration,
                progress_callback=set_progress,
            )
            subtitle_source = "asr"

        needs_transcode = (
            video_path.exists() and not check_video_compatibility(video_path)
        )

        update_task(
            task_id,
            status="completed",
            progress=100,
            status_message="视频和字幕处理完成" if download_subtitles else "视频处理完成",
            subtitle_source=subtitle_source,
            subtitle_ready=subtitle_srt_path.exists() and subtitle_txt_path.exists(),
            video_ready=video_path.exists(),
            video_needs_transcode=needs_transcode,
            video_filename=video_path.name,
            subtitle_srt_filename=subtitle_srt_path.name if subtitle_srt_path.exists() else None,
            subtitle_txt_filename=subtitle_txt_path.name if subtitle_txt_path.exists() else None,
            error_code=None,
            error_message=None,
        )
    except CancelledError:
        update_task(
            task_id,
            status="failed",
            status_message="任务已被用户终止",
            error_code="CancelledError",
            error_message="任务已被用户终止",
        )
    except Exception as exc:
        update_task(
            task_id,
            status="failed",
            status_message="处理失败",
            error_code=exc.__class__.__name__,
            error_message=map_error_message(str(exc), cookies_supplied=bool(cookies and cookies.strip())),
        )
    finally:
        _cancel_events.pop(task_id, None)


class CancelledError(Exception):
    pass


def map_error_message(message: str, cookies_supplied: bool) -> str:
    lowered = message.lower()
    if "sign in to confirm you’re not a bot" in lowered or "sign in to confirm you're not a bot" in lowered:
        if cookies_supplied:
            return "YouTube 解析失败：当前 cookies 仍未通过机器人校验，请重新抓取浏览器中的最新 YouTube cookies。"
        return "YouTube 解析失败：当前视频需要登录态 cookies 才能通过机器人校验。请先在本地抓取 YouTube 浏览器 cookies。"
    if "requested format is not available" in lowered:
        return "YouTube 解析失败：当前账号拿到的可用视频格式不可直接下载。请更换视频，或稍后重试。"
    if "http error 403: forbidden" in lowered and (
        "fragment" in lowered
        or "m3u8" in lowered
        or "hls" in lowered
        or "giving up after" in lowered
        or "got error:" in lowered
    ):
        return "YouTube 解析成功，但当前仅返回受限的 HLS 视频流，分片下载被 YouTube 拒绝（403）。请更换视频，或稍后重试。"
    if "Unsupported Douyin URL" in message:
        return "抖音解析失败：当前链接不是 douyin-downloader 支持的标准视频地址或短链。"
    if "Failed to get Douyin video detail" in message:
        if cookies_supplied:
            return "抖音解析失败：douyin-downloader 未能读取视频详情，当前 cookies 可能仍然失效。"
        return "抖音解析失败：douyin-downloader 未能读取视频详情。请确认本机 Chrome 已登录抖音，并允许应用读取浏览器数据后重试。"
    if "Fresh cookies" in message or "cookies" in lowered and "douyin" in lowered:
        if cookies_supplied:
            return "抖音解析失败：当前 cookies 已失效或不够新鲜，请重新从浏览器复制最新 cookies 后再试。"
        return "抖音解析失败：当前视频需要本机浏览器中的新鲜登录态。请确认本机 Chrome 已登录抖音，并允许应用读取浏览器数据后重试。"
    return message
