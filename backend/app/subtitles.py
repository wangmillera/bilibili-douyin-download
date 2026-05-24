from __future__ import annotations

from pathlib import Path
import re
import subprocess

from opencc import OpenCC

from .config import settings


LANGUAGE_PREFERENCES = [
    "zh-Hans",
    "zh-Hant",
    "zh-CN",
    "zh-TW",
    "zh",
    "en",
]

SIMPLIFIED_CHINESE_CONVERTER = OpenCC("t2s")


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
            lines.append(to_simplified_chinese(cleaned))
    return "\n".join(lines).strip()


def write_txt_from_srt(srt_path: Path, txt_path: Path) -> None:
    content = srt_path.read_text(encoding="utf-8")
    txt_path.write_text(subtitle_to_text(content), encoding="utf-8")


def to_simplified_chinese(text: str) -> str:
    return SIMPLIFIED_CHINESE_CONVERTER.convert(text)


def normalize_srt_to_simplified(srt_path: Path) -> None:
    lines: list[str] = []
    for raw_line in srt_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.isdigit() or "-->" in line:
            lines.append(raw_line)
            continue
        lines.append(to_simplified_chinese(raw_line))
    srt_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
