from __future__ import annotations

from pathlib import Path

from yt_dlp import YoutubeDL

from .config import settings
from .subtitles import LANGUAGE_PREFERENCES, convert_subtitle_to_srt, find_first_match, write_txt_from_srt


def probe_video(url: str) -> dict:
    with YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
        return ydl.extract_info(url, download=False)


def subtitle_opts(task_dir: Path) -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": LANGUAGE_PREFERENCES,
        "subtitlesformat": "srt/vtt/best",
        "outtmpl": str(task_dir / "subtitle.%(ext)s"),
    }


def try_download_subtitles(url: str, task_dir: Path) -> tuple[bool, str]:
    with YoutubeDL(subtitle_opts(task_dir)) as ydl:
        ydl.download([url])

    srt_path = normalize_srt_path(task_dir)
    if srt_path:
        write_txt_from_srt(srt_path, task_dir / "subtitle.txt")
        return True, "embedded"

    source = find_first_match(task_dir, (".vtt", ".ass", ".srv3", ".ttml"))
    if source:
        normalized = task_dir / "subtitle.srt"
        convert_subtitle_to_srt(source, normalized)
        write_txt_from_srt(normalized, task_dir / "subtitle.txt")
        return True, "automatic"
    return False, "none"


def download_video(url: str, task_dir: Path) -> Path:
    outtmpl = str(task_dir / "video.%(ext)s")
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": outtmpl,
    }
    with YoutubeDL(opts) as ydl:
        ydl.download([url])

    for extension in (".mp4", ".mkv", ".webm", ".mov"):
        path = task_dir / f"video{extension}"
        if path.exists():
            return path
    raise FileNotFoundError("Video file was not created")


def normalize_srt_path(task_dir: Path) -> Path | None:
    direct = task_dir / "subtitle.srt"
    if direct.exists():
        return direct

    matches = sorted(path for path in task_dir.iterdir() if path.suffix.lower() == ".srt")
    if not matches:
        return None

    chosen = matches[0]
    normalized = task_dir / "subtitle.srt"
    if chosen != normalized:
        chosen.replace(normalized)
    return normalized
