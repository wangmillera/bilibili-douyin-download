from __future__ import annotations

import json
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

from .config import settings
from .downloader import resolve_cookie_header, transcode_video_for_playback


def is_douyin_url(url: str) -> bool:
    hostname = urlparse(url).hostname or ""
    return any(
        hostname == domain or hostname.endswith(f".{domain}")
        for domain in ("douyin.com", "iesdouyin.com")
    )


def probe_douyin_video(url: str, task_dir: Path, cookies: str | None = None) -> dict:
    cookie_header = resolve_cookie_header(url, cookies)
    payload = _run_helper("probe", url, task_dir, cookie_header)
    return {
        "id": payload["aweme_id"],
        "title": payload["title"],
        "duration": payload.get("duration_seconds"),
        "thumbnail": payload.get("thumbnail_url"),
        "extractor_key": "DouyinDownloader",
        "video_url": payload["video_url"],
        "video_headers": payload.get("video_headers") or {},
    }


def download_douyin_video(
    url: str,
    task_dir: Path,
    progress_callback=None,
    cookies: str | None = None,
) -> Path:
    info = probe_douyin_video(url, task_dir, cookies)

    if progress_callback:
        progress_callback(60, "开始下载抖音视频")

    source_path = task_dir / "source-video.mp4"
    with requests.get(info["video_url"], headers=info.get("video_headers") or {}, stream=True, timeout=120) as response:
        response.raise_for_status()
        total = int(response.headers.get("content-length") or 0)
        downloaded = 0
        with source_path.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if not chunk:
                    continue
                handle.write(chunk)
                downloaded += len(chunk)
                if progress_callback and total > 0:
                    fraction = max(0.0, min(1.0, downloaded / total))
                    progress_callback(60 + fraction * 25, f"抖音视频下载中 {fraction * 100:.1f}%")

    normalized = task_dir / "video.mp4"
    transcode_video_for_playback(source_path, normalized, progress_callback=progress_callback)
    return normalized


def normalize_douyin_url(url: str) -> str:
    parsed = urlparse(url)
    if "/video/" in parsed.path:
        return url

    query = parse_qs(parsed.query)
    modal_id = (query.get("modal_id") or [None])[0]
    if modal_id and str(modal_id).isdigit():
        return f"https://www.douyin.com/video/{modal_id}"
    return url


def _run_helper(action: str, url: str, task_dir: Path, cookie_header: str | None) -> dict:
    repo_dir = settings.douyin_downloader_dir
    helper_python = settings.douyin_downloader_python
    if not repo_dir.exists():
        raise FileNotFoundError(
            f"douyin-downloader not found: {repo_dir}. Set DOUYIN_DOWNLOADER_DIR to the cloned project path."
        )
    if not Path(helper_python).exists():
        raise FileNotFoundError(
            f"douyin-downloader python not found: {helper_python}. Set DOUYIN_DOWNLOADER_PYTHON to the downloader virtualenv python."
        )

    cookie_path = task_dir / "douyin-helper.cookies.txt"
    if cookie_header:
        cookie_path.write_text(cookie_header + "\n", encoding="utf-8")
    else:
        cookie_path.write_text("", encoding="utf-8")

    helper_script = Path(__file__).resolve().parents[1] / "scripts" / "douyin_downloader_helper.py"
    command = [
        helper_python,
        str(helper_script),
        "--action",
        action,
        "--repo-dir",
        str(repo_dir),
        "--url",
        normalize_douyin_url(url),
        "--cookie-file",
        str(cookie_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "douyin-downloader helper failed"
        raise RuntimeError(message)

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid douyin-downloader helper output: {result.stdout}") from exc
