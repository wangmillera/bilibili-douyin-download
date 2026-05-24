from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=["probe"], required=True)
    parser.add_argument("--repo-dir", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--cookie-file", required=True)
    return parser.parse_args()


def normalize_douyin_url(url: str) -> str:
    parsed = urlparse(url)
    if "/video/" in parsed.path:
        return url
    query = parse_qs(parsed.query)
    modal_id = (query.get("modal_id") or [None])[0]
    if modal_id and str(modal_id).isdigit():
        return f"https://www.douyin.com/video/{modal_id}"
    return url


def load_cookie_dict(cookie_file: str) -> dict[str, str]:
    path = Path(cookie_file)
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return {}
    pairs: dict[str, str] = {}
    for segment in text.split(";"):
        item = segment.strip()
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            pairs[key] = value
    return pairs


def install_repo_path(repo_dir: str) -> None:
    path = str(Path(repo_dir).resolve())
    if path not in sys.path:
        sys.path.insert(0, path)


def extract_first_url(payload) -> str | None:
    if isinstance(payload, dict):
        urls = payload.get("url_list") or payload.get("urlList") or []
        if isinstance(urls, list):
            for url in urls:
                if url:
                    return str(url)
    return None


def detect_media_type(aweme_data: dict) -> str:
    if aweme_data.get("image_post_info") or aweme_data.get("images") or aweme_data.get("image_list"):
        return "gallery"
    aweme_type = aweme_data.get("aweme_type")
    if isinstance(aweme_type, int) and aweme_type in {2, 68, 150}:
        return "gallery"
    return "video"


def bind_build_no_watermark_url(base_downloader_cls):
    class Shim:
        config = {"video_quality": "highest"}

        def __init__(self, api_client):
            self.api_client = api_client

        def _download_headers(self, user_agent: str | None = None):
            headers = {
                "Referer": f"{self.api_client.BASE_URL}/",
                "Origin": self.api_client.BASE_URL,
                "Accept": "*/*",
            }
            headers["User-Agent"] = user_agent or self.api_client.headers.get("User-Agent", "")
            return headers

        def _is_watermarked_media_url(self, url: str) -> bool:
            lowered = url.lower()
            return "watermark=1" in lowered or "watermark=2" in lowered

        @staticmethod
        def _pick_play_addr_by_quality(video, quality="highest"):
            return base_downloader_cls._pick_play_addr_by_quality(video, quality)

    def build(aweme_data, api_client):
        shim = Shim(api_client)
        return base_downloader_cls._build_no_watermark_url(shim, aweme_data)

    return build


async def probe(repo_dir: str, url: str, cookie_file: str) -> dict:
    install_repo_path(repo_dir)
    from core import DouyinAPIClient, URLParser
    from core.downloader_base import BaseDownloader
    from utils.validators import is_short_url, normalize_short_url

    build_no_watermark_url = bind_build_no_watermark_url(BaseDownloader)
    cookies = load_cookie_dict(cookie_file)

    async with DouyinAPIClient(cookies) as api_client:
        resolved_url = normalize_douyin_url(url)
        if is_short_url(url):
            resolved_url = await api_client.resolve_short_url(normalize_short_url(url)) or url
            resolved_url = normalize_douyin_url(resolved_url)

        parsed = URLParser.parse(resolved_url)
        if not parsed:
            raise RuntimeError(f"Unsupported Douyin URL: {url}")

        aweme_id = parsed.get("aweme_id")
        if not aweme_id:
            raise RuntimeError(f"Could not extract aweme_id from URL: {resolved_url}")

        aweme_data = await api_client.get_video_detail(str(aweme_id))
        if not aweme_data:
            raise RuntimeError(f"Failed to get Douyin video detail for {aweme_id}")

        if detect_media_type(aweme_data) != "video":
            raise RuntimeError("Current Douyin URL is not a normal video")

        video_info = build_no_watermark_url(aweme_data, api_client)
        if not video_info:
            raise RuntimeError("No playable Douyin video URL found")

        title = ((aweme_data.get("desc") or "").strip() or f"douyin-{aweme_id}")
        duration_ms = (aweme_data.get("video") or {}).get("duration")
        duration_seconds = int(duration_ms / 1000) if duration_ms else None
        thumbnail_url = extract_first_url((aweme_data.get("video") or {}).get("cover"))

        return {
            "aweme_id": str(aweme_id),
            "title": title,
            "duration_seconds": duration_seconds,
            "thumbnail_url": thumbnail_url,
            "video_url": video_info[0],
            "video_headers": video_info[1],
        }


def main() -> None:
    args = parse_args()
    if args.action == "probe":
        payload = asyncio.run(probe(args.repo_dir, args.url, args.cookie_file))
        print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
