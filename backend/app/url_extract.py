from __future__ import annotations

import re


URL_PATTERN = re.compile(r"https?://[^\s<>'\"，。；、）】]+", re.IGNORECASE)


def extract_first_url(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("请提供视频链接或包含链接的分享文案")

    match = URL_PATTERN.search(text)
    if match:
        return match.group(0).rstrip(".,;:!?)]}】」\"'")

    raise ValueError("未识别到可用链接，请粘贴包含 http:// 或 https:// 的分享文案")
