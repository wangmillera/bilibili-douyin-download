from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import settings
from .downloader import download_video, probe_video, try_download_subtitles
from .task_store import get_task_dir, update_task
from .transcription import transcribe_media


def detect_platform(info: dict[str, Any]) -> str:
    extractor = info.get("extractor_key") or info.get("extractor") or "unknown"
    return str(extractor)


def process_task(task_id: str, url: str) -> None:
    task_dir = get_task_dir(task_id)
    try:
        update_task(task_id, status="probing")
        info = probe_video(url)
        duration = int(info.get("duration") or 0) or None
        if duration and duration > settings.max_video_duration_seconds:
            raise ValueError(f"Video duration exceeds {settings.max_video_duration_seconds} seconds")

        update_task(
            task_id,
            platform=detect_platform(info),
            title=info.get("title"),
            thumbnail_url=info.get("thumbnail"),
            duration_seconds=duration,
        )

        update_task(task_id, status="extracting_subtitle")
        subtitles_found, subtitle_source = try_download_subtitles(url, task_dir)

        update_task(task_id, status="downloading_video")
        video_path = download_video(url, task_dir)

        subtitle_srt_path = task_dir / "subtitle.srt"
        subtitle_txt_path = task_dir / "subtitle.txt"

        if not subtitles_found:
            update_task(task_id, status="transcribing")
            transcribe_media(video_path, subtitle_srt_path, subtitle_txt_path)
            subtitle_source = "asr"

        update_task(
            task_id,
            status="completed",
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
            error_code=exc.__class__.__name__,
            error_message=str(exc),
        )
