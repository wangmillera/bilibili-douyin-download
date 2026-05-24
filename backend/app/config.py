from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    tasks_dir: Path = Path(os.getenv("TASKS_DIR", "../tmp/tasks")).resolve()
    task_ttl_seconds: int = int(os.getenv("TASK_TTL_SECONDS", "86400"))
    ytdlp_bin: str = os.getenv("YTDLP_BIN", "yt-dlp")
    ffmpeg_bin: str = os.getenv("FFMPEG_BIN", "ffmpeg")
    whisper_model: str = os.getenv("WHISPER_MODEL", "small")
    whisper_device: str = os.getenv("WHISPER_DEVICE", "cpu")
    whisper_compute_type: str = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
    max_video_duration_seconds: int = int(os.getenv("MAX_VIDEO_DURATION_SECONDS", "3600"))
    allowed_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
        if origin.strip()
    )


settings = Settings()
settings.tasks_dir.mkdir(parents=True, exist_ok=True)
