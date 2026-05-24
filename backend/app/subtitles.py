from __future__ import annotations

from pathlib import Path
import re
import subprocess

from .config import settings


LANGUAGE_PREFERENCES = [
    "zh-Hans",
    "zh-Hant",
    "zh-CN",
    "zh-TW",
    "zh",
    "en",
]


def find_first_match(task_dir: Path, suffixes: tuple[str, ...]) -> Path | None:
    candidates = sorted(path for path in task_dir.iterdir() if path.suffix.lower() in suffixes)
    return candidates[0] if candidates else None


def convert_subtitle_to_srt(source: Path, target: Path) -> None:
    subprocess.run(
        [
            settings.ffmpeg_bin,
            "-y",
            "-i",
            str(source),
            str(target),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def subtitle_to_text(content: str) -> str:
    lines: list[str] = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.isdigit():
            continue
        if "-->" in line:
            continue
        cleaned = re.sub(r"<[^>]+>", "", line)
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines).strip()


def write_txt_from_srt(srt_path: Path, txt_path: Path) -> None:
    content = srt_path.read_text(encoding="utf-8")
    txt_path.write_text(subtitle_to_text(content), encoding="utf-8")
