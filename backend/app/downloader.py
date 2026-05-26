from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse
import mimetypes
import os
import json
import shutil
import subprocess

import requests
try:
    import youtube_dl as legacy_youtube_dl
except ImportError:
    legacy_youtube_dl = None
from yt_dlp import YoutubeDL
from yt_dlp.cookies import extract_cookies_from_browser

try:
    import browser_cookie3
except ImportError:  # pragma: no cover - optional dependency in some setups
    browser_cookie3 = None

from .config import settings
from .subtitles import (
    LANGUAGE_PREFERENCES,
    convert_subtitle_to_srt,
    find_first_match,
    normalize_srt_to_simplified,
    write_txt_from_srt,
)

SITE_COOKIE_CONFIG = {
    "douyin": {
        "domains": [
            ".douyin.com",
            "www.douyin.com",
            "v.douyin.com",
            "live.douyin.com",
            ".iesdouyin.com",
        ],
        "referer": "https://www.douyin.com/",
        "cookie_file": lambda: settings.douyin_cookie_file,
        "browser": lambda: settings.douyin_cookies_browser,
        "profile": lambda: settings.douyin_cookies_profile,
    },
    "youtube": {
        "domains": [
            ".youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "music.youtube.com",
            ".google.com",
            ".googlevideo.com",
            "youtu.be",
        ],
        "referer": "https://www.youtube.com/",
        "cookie_file": lambda: settings.youtube_cookie_file,
        "browser": lambda: settings.youtube_cookies_browser,
        "profile": lambda: settings.youtube_cookies_profile,
    },
}


def get_desktop_diagnostics() -> dict[str, object]:
    browser_name = get_site_browser_name("douyin")
    explicit_profile = get_site_browser_profile("douyin")
    candidate_profiles = browser_profile_candidates(browser_name, explicit_profile)
    ffmpeg_path = Path(settings.ffmpeg_bin)
    ffprobe_path = Path(os.getenv("FFPROBE_BIN", "ffprobe"))

    diagnostics: dict[str, object] = {
        "chrome_detected": browser_name.lower() == "chrome",
        "candidate_profiles": [profile or "auto" for profile in candidate_profiles],
        "selected_profile": explicit_profile,
        "douyin_cookie_count": 0,
        "cookie_read_method": None,
        "cookie_read_error": None,
        "douyin_helper_repo_exists": settings.douyin_downloader_dir.exists(),
        "douyin_helper_python_exists": helper_python_available(settings.douyin_downloader_python),
        "ffmpeg_exists": ffmpeg_path.exists() if ffmpeg_path.is_absolute() else shutil.which(settings.ffmpeg_bin) is not None,
        "ffprobe_exists": ffprobe_path.exists() if ffprobe_path.is_absolute() else shutil.which(str(ffprobe_path)) is not None,
    }

    try:
        jar, method, profile = load_browser_cookie_jar(browser_name, "douyin", with_diagnostics=True)
        if jar is not None:
            count = sum(1 for cookie in jar if any(cookie_domain_matches(cookie.domain, domain) for domain in get_site_domains("douyin")))
            diagnostics["douyin_cookie_count"] = count
            diagnostics["cookie_read_method"] = method
            diagnostics["selected_profile"] = profile or explicit_profile
        elif method:
            diagnostics["cookie_read_error"] = method
    except Exception as exc:  # pragma: no cover - diagnostic fallback
        diagnostics["cookie_read_error"] = str(exc)

    return diagnostics


def probe_video(url: str, cookies: str | None = None, task_dir: Path | None = None) -> dict:
    with YoutubeDL(base_opts(url, cookies, task_dir)) as ydl:
        return ydl.extract_info(url, download=False)


def base_opts(url: str, cookies: str | None = None, task_dir: Path | None = None) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }
    cookie_header = resolve_cookie_header(url, cookies)
    cookie_file = resolve_cookie_file(url, task_dir, cookies)
    if cookie_file:
        opts["cookiefile"] = str(cookie_file)
    if is_youtube_url(url):
        opts["extractor_args"] = {
            "youtube": {
                "player_client": ["web_creator", "web_safari", "web"],
                "player_skip": ["webpage", "configs"],
            }
        }
    if cookie_header:
        site_key = detect_site_key(url)
        referer = SITE_COOKIE_CONFIG.get(site_key or "", {}).get("referer", url)
        opts["http_headers"] = {
            "Cookie": cookie_header,
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
        }
    return opts


def subtitle_opts(task_dir: Path, cookies: str | None = None) -> dict:
    return {
        **base_opts("", cookies, task_dir),
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": LANGUAGE_PREFERENCES,
        "subtitlesformat": "srt/vtt/best",
        "outtmpl": str(task_dir / "subtitle.%(ext)s"),
    }


def try_download_subtitles(url: str, task_dir: Path, cookies: str | None = None) -> tuple[bool, str]:
    opts = subtitle_opts(task_dir, cookies)
    opts.update(base_opts(url, cookies, task_dir))
    with YoutubeDL(opts) as ydl:
        ydl.download([url])

    srt_path = normalize_srt_path(task_dir)
    if srt_path:
        normalize_srt_to_simplified(srt_path)
        write_txt_from_srt(srt_path, task_dir / "subtitle.txt")
        return True, "embedded"

    source = find_first_match(task_dir, (".vtt", ".ass", ".srv3", ".ttml"))
    if source:
        normalized = task_dir / "subtitle.srt"
        convert_subtitle_to_srt(source, normalized)
        normalize_srt_to_simplified(normalized)
        write_txt_from_srt(normalized, task_dir / "subtitle.txt")
        return True, "automatic"
    return False, "none"


def download_video(url: str, task_dir: Path, progress_callback=None, cookies: str | None = None) -> Path:
    if is_youtube_url(url) and settings.youtube_downloader.lower() == "youtube-dl":
        return download_youtube_video_with_legacy_downloader(
            url,
            task_dir,
            progress_callback=progress_callback,
            cookies=cookies,
        )

    outtmpl = str(task_dir / "source-video.%(ext)s")

    def hook(event: dict) -> None:
        if not progress_callback:
            return
        if event.get("status") != "downloading":
            if event.get("status") == "finished":
                progress_callback(90, "视频下载完成，准备转码兼容格式")
            return
        total = event.get("total_bytes") or event.get("total_bytes_estimate") or 0
        downloaded = event.get("downloaded_bytes") or 0
        if total:
            fraction = max(0.0, min(1.0, downloaded / total))
            progress_callback(50 + fraction * 35, f"视频下载中 {fraction * 100:.1f}%")
        else:
            progress_callback(60, "视频下载中")

    format_selector = (
        "best"
        if is_youtube_url(url)
        else "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[vcodec^=h264]+bestaudio/best[ext=mp4]/best"
    )

    opts = {
        **base_opts(url, cookies, task_dir),
        "format": format_selector,
        "merge_output_format": "mp4",
        "outtmpl": outtmpl,
        "progress_hooks": [hook],
    }
    if is_youtube_url(url):
        opts.update(
            {
                "retries": 1,
                "fragment_retries": 1,
                "skip_unavailable_fragments": False,
                "abort_on_unavailable_fragments": True,
            }
        )
    with YoutubeDL(opts) as ydl:
        ydl.download([url])

    for extension in (".mp4", ".mkv", ".webm", ".mov"):
        path = task_dir / f"source-video{extension}"
        if path.exists():
            normalized = task_dir / "video.mp4"
            transcode_video_for_playback(path, normalized, progress_callback=progress_callback)
            return normalized
    raise FileNotFoundError("Video file was not created")


def download_youtube_video_with_legacy_downloader(
    url: str,
    task_dir: Path,
    progress_callback=None,
    cookies: str | None = None,
) -> Path:
    if legacy_youtube_dl is None:
        raise RuntimeError("youtube_dl is not installed; set YOUTUBE_DOWNLOADER=yt-dlp or install youtube_dl")
    outtmpl = str(task_dir / "source-video.%(ext)s")

    def hook(event: dict) -> None:
        if not progress_callback:
            return
        if event.get("status") != "downloading":
            if event.get("status") == "finished":
                progress_callback(90, "YouTube 视频下载完成，准备转码兼容格式")
            return
        total = event.get("total_bytes") or event.get("total_bytes_estimate") or 0
        downloaded = event.get("downloaded_bytes") or 0
        if total:
            fraction = max(0.0, min(1.0, downloaded / total))
            progress_callback(50 + fraction * 35, f"YouTube 视频下载中 {fraction * 100:.1f}%")
        else:
            progress_callback(60, "YouTube 视频下载中")

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": "best",
        "outtmpl": outtmpl,
        "progress_hooks": [hook],
    }

    cookie_file = resolve_cookie_file(url, task_dir, cookies)
    if cookie_file:
        opts["cookiefile"] = str(cookie_file)

    with legacy_youtube_dl.YoutubeDL(opts) as ydl:
        ydl.download([url])

    for extension in (".mp4", ".mkv", ".webm", ".mov"):
        path = task_dir / f"source-video{extension}"
        if path.exists():
            normalized = task_dir / "video.mp4"
            transcode_video_for_playback(path, normalized, progress_callback=progress_callback)
            return normalized
    raise FileNotFoundError("Video file was not created")


def _probe_video(path: Path) -> dict | None:
    """Return ffprobe stream info dict or None on failure."""
    result = subprocess.run(
        [
            settings.ffprobe_bin,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def _is_compatible_mp4(probe: dict) -> bool:
    """Check whether the probed video is already H.264 + AAC in MP4 with yuv420p."""
    fmt = probe.get("format", {})
    if fmt.get("format_name", "").split(",")[0] != "mp4":
        return False

    video_ok = False
    audio_ok = False
    for stream in probe.get("streams", []):
        codec = stream.get("codec_name", "")
        if stream["codec_type"] == "video":
            if codec == "h264" and stream.get("pix_fmt") in ("yuv420p", None):
                video_ok = True
        elif stream["codec_type"] == "audio":
            if codec == "aac":
                audio_ok = True
    return video_ok and audio_ok


def transcode_video_for_playback(source_path: Path, target_path: Path, progress_callback=None) -> None:
    probe = _probe_video(source_path)
    if probe and _is_compatible_mp4(probe):
        if progress_callback:
            progress_callback(95, "视频格式已兼容，跳过转码")
        if source_path != target_path:
            shutil.copy2(source_path, target_path)
        return

    if progress_callback:
        progress_callback(92, "正在转码为兼容播放格式")

    subprocess.run(
        [
            settings.ffmpeg_bin,
            "-y",
            "-i",
            str(source_path),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(target_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    if progress_callback:
        progress_callback(98, "兼容播放格式已生成")


def download_thumbnail(thumbnail_url: str, task_dir: Path) -> Path | None:
    response = requests.get(
        thumbnail_url,
        timeout=20,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": thumbnail_url,
        },
    )
    response.raise_for_status()

    path = urlparse(thumbnail_url).path
    suffix = Path(path).suffix.lower()
    if not suffix:
        suffix = mimetypes.guess_extension(response.headers.get("content-type", "").split(";")[0].strip()) or ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"

    target = task_dir / f"thumbnail{suffix}"
    target.write_bytes(response.content)
    return target


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


def sanitize_cookie_header(raw_cookie: str | None) -> str | None:
    if not raw_cookie:
        return None

    cleaned = raw_cookie.strip().strip("'").strip('"')
    if not cleaned:
        return None

    pairs: list[str] = []
    for part in cleaned.split(";"):
        segment = part.strip()
        if not segment or "=" not in segment:
            continue
        key, value = segment.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or not value:
            continue
        pairs.append(f"{key}={value}")

    return "; ".join(pairs) if pairs else None


def resolve_cookie_header(url: str, raw_cookie: str | None) -> str | None:
    cookie_header = sanitize_cookie_header(raw_cookie)
    if cookie_header:
        return cookie_header

    site_key = detect_site_key(url)
    if not site_key:
        return None

    if site_key == "douyin":
        browser_cookie_header = export_browser_cookie_header(get_site_browser_name(site_key), site_key)
        if browser_cookie_header:
            return browser_cookie_header
    elif site_key == "youtube":
        # Prefer the real local browser cookies through yt-dlp's browser integration.
        # Only fall back to a text file when such a file already exists.
        if not settings.youtube_cookie_file.exists():
            return None

    cookie_file = SITE_COOKIE_CONFIG[site_key]["cookie_file"]()
    if not cookie_file.exists():
        return None

    return sanitize_cookie_header(cookie_file.read_text(encoding="utf-8"))


def resolve_cookie_file(url: str, task_dir: Path | None, raw_cookie: str | None) -> Path | None:
    if not task_dir:
        return None

    cookie_header = sanitize_cookie_header(raw_cookie)
    if cookie_header:
        return write_cookie_file(task_dir, url, cookie_header)

    site_key = detect_site_key(url)
    if not site_key:
        return None

    if site_key == "douyin":
        browser_cookie_file = export_browser_cookie_file(task_dir, get_site_browser_name(site_key), site_key)
        if browser_cookie_file:
            return browser_cookie_file
        configured_cookie_file = SITE_COOKIE_CONFIG[site_key]["cookie_file"]()
        if configured_cookie_file.exists():
            return configured_cookie_file
        return None

    configured_cookie_file = SITE_COOKIE_CONFIG[site_key]["cookie_file"]()
    if configured_cookie_file.exists():
        return configured_cookie_file

    if site_key == "youtube":
        return export_browser_cookie_file(task_dir, get_site_browser_name(site_key), site_key)

    return None


def is_douyin_url(url: str) -> bool:
    hostname = urlparse(url).hostname or ""
    return any(
        hostname == domain or hostname.endswith(f".{domain}")
        for domain in ("douyin.com", "iesdouyin.com")
    )


def is_youtube_url(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return any(
        hostname == domain or hostname.endswith(f".{domain}")
        for domain in ("youtube.com", "youtu.be", "googlevideo.com")
    )


def detect_site_key(url: str) -> str | None:
    if is_douyin_url(url):
        return "douyin"
    if is_youtube_url(url):
        return "youtube"
    return None


def write_cookie_file(task_dir: Path, url: str, cookie_header: str) -> Path:
    cookie_file = task_dir / "cookies.txt"
    site_key = detect_site_key(url)
    domains = SITE_COOKIE_CONFIG.get(site_key or "", {}).get("domains") or []
    lines = ["# Netscape HTTP Cookie File"]
    for pair in cookie_header.split(";"):
        segment = pair.strip()
        if "=" not in segment:
            continue
        key, value = segment.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or not value:
            continue
        for domain in domains:
            lines.append("\t".join([domain, "TRUE", "/", "FALSE", "0", key, value]))
    cookie_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return cookie_file


def export_browser_cookie_file(task_dir: Path, browser_name: str, site_key: str) -> Path | None:
    jar = load_browser_cookie_jar(browser_name, site_key)
    if jar is None:
        return None

    lines = build_netscape_cookie_lines(jar, site_key)
    if len(lines) <= 1:
        return None

    task_dir.mkdir(parents=True, exist_ok=True)
    target = task_dir / f"{site_key}.browser.cookies.txt"
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return target


def export_browser_cookie_header(browser_name: str, site_key: str) -> str | None:
    jar = load_browser_cookie_jar(browser_name, site_key)
    if jar is None:
        return None

    domains = get_site_domains(site_key)
    pairs: list[str] = []

    for cookie in jar:
        if not cookie.name or not cookie.value:
            continue
        if not any(cookie_domain_matches(cookie.domain, domain) for domain in domains):
            continue
        pairs.append(f"{cookie.name}={cookie.value}")

    return "; ".join(pairs) if pairs else None


def load_browser_cookie_jar(browser_name: str, site_key: str | None = None, with_diagnostics: bool = False):
    domains = get_site_domains(site_key) if site_key else []
    explicit_profile = get_site_browser_profile(site_key) if site_key else "auto"
    last_error: str | None = None

    for profile in browser_profile_candidates(browser_name, explicit_profile):
        try:
            kwargs = {"profile": profile} if profile else {}
            jar = extract_cookies_from_browser(browser_name, **kwargs)
            if jar_has_matching_domains(jar, domains):
                return (jar, "yt_dlp", profile) if with_diagnostics else jar
        except Exception as exc:
            last_error = str(exc)
            continue

    if browser_cookie3 is None:
        if with_diagnostics:
            return None, None, explicit_profile
        return None

    loader = getattr(browser_cookie3, browser_name.lower(), None)
    if loader is None:
        if with_diagnostics:
            return None, None, explicit_profile
        return None

    try:
        if domains:
            for domain in domains:
                try:
                    jar = loader(domain_name=domain.lstrip("."))
                    if jar_has_matching_domains(jar, domains):
                        return (jar, "browser_cookie3", explicit_profile) if with_diagnostics else jar
                except TypeError:
                    jar = loader()
                    if jar_has_matching_domains(jar, domains):
                        return (jar, "browser_cookie3", explicit_profile) if with_diagnostics else jar
                except Exception as exc:
                    last_error = str(exc)
                    continue
        jar = loader()
        if jar_has_matching_domains(jar, domains) or not domains:
            return (jar, "browser_cookie3", explicit_profile) if with_diagnostics else jar
        if with_diagnostics:
            return None, None, explicit_profile
        return None
    except Exception as exc:
        last_error = str(exc)
        if with_diagnostics:
            return None, last_error, explicit_profile
        return None


def browser_profile_candidates(browser_name: str, explicit_profile: str = "auto") -> list[str | None]:
    if explicit_profile and explicit_profile != "auto":
        return [explicit_profile]

    candidates: list[str | None] = [None]
    browser = browser_name.lower()
    if browser != "chrome":
        return candidates

    chrome_root = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
    if not chrome_root.exists():
        return candidates

    ordered_names = ["Default"]
    ordered_names.extend(
        sorted(
            child.name
            for child in chrome_root.iterdir()
            if child.is_dir() and child.name.startswith("Profile ")
        )
    )

    for name in ordered_names:
        if name not in candidates:
            candidates.append(name)
    return candidates


def helper_python_available(python_path: str) -> bool:
    candidate = Path(python_path)
    if candidate.is_absolute():
        return candidate.exists()
    return shutil.which(python_path) is not None


def jar_has_matching_domains(jar, domains: list[str]) -> bool:
    if not domains:
        return True
    for cookie in jar:
        if any(cookie_domain_matches(cookie.domain, domain) for domain in domains):
            return True
    return False


def build_netscape_cookie_lines(jar, site_key: str) -> list[str]:
    domains = get_site_domains(site_key)
    lines = ["# Netscape HTTP Cookie File"]

    for cookie in jar:
        if not cookie.name or not cookie.value:
            continue
        if not any(cookie_domain_matches(cookie.domain, domain) for domain in domains):
            continue
        lines.append(
            "\t".join(
                [
                    cookie.domain,
                    "TRUE" if getattr(cookie, "domain_initial_dot", False) else "FALSE",
                    cookie.path or "/",
                    "TRUE" if cookie.secure else "FALSE",
                    str(int(cookie.expires or 0)),
                    cookie.name,
                    cookie.value,
                ]
            )
        )

    return lines


def get_site_domains(site_key: str) -> list[str]:
    return list(SITE_COOKIE_CONFIG[site_key]["domains"])


def get_site_browser_name(site_key: str) -> str:
    return str(SITE_COOKIE_CONFIG[site_key]["browser"]())


def get_site_browser_profile(site_key: str | None) -> str:
    if not site_key:
        return "auto"
    profile_getter = SITE_COOKIE_CONFIG.get(site_key, {}).get("profile")
    if not profile_getter:
        return "auto"
    return str(profile_getter())


def cookie_domain_matches(cookie_domain: str, configured_domain: str) -> bool:
    normalized_cookie_domain = cookie_domain.lstrip(".").lower()
    normalized_configured_domain = configured_domain.lstrip(".").lower()
    return (
        normalized_cookie_domain == normalized_configured_domain
        or normalized_cookie_domain.endswith(f".{normalized_configured_domain}")
    )
