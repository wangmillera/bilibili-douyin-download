from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from .config import settings
from .subtitles import to_simplified_chinese, write_txt_from_srt


@lru_cache(maxsize=1)
def get_model():
    from faster_whisper import WhisperModel

    return WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )


def format_srt_timestamp(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def transcribe_media(media_path: Path, srt_path: Path, txt_path: Path, duration_seconds: int | None = None, progress_callback=None) -> None:
    model = get_model()
    segments, _ = model.transcribe(
        str(media_path),
        beam_size=5,
        vad_filter=True,
    )

    srt_lines: list[str] = []
    for index, segment in enumerate(segments, start=1):
        text = to_simplified_chinese(segment.text.strip())
        if not text:
            continue
        if progress_callback and duration_seconds and duration_seconds > 0:
            fraction = max(0.0, min(1.0, segment.end / duration_seconds))
            progress_callback(55 + fraction * 40, f"字幕转写中 {fraction * 100:.1f}%")
        srt_lines.extend(
            [
                str(index),
                f"{format_srt_timestamp(segment.start)} --> {format_srt_timestamp(segment.end)}",
                text,
                "",
            ]
        )

    srt_path.write_text("\n".join(srt_lines).strip() + "\n", encoding="utf-8")
    write_txt_from_srt(srt_path, txt_path)
