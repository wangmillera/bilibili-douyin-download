from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


TaskState = Literal[
    "queued",
    "probing",
    "extracting_subtitle",
    "transcribing",
    "downloading_video",
    "completed",
    "failed",
    "expired",
]

SubtitleSource = Literal["embedded", "automatic", "asr", "none"]


class CreateTaskRequest(BaseModel):
    url: HttpUrl | str
    cookies: str | None = None
    download_subtitles: bool = False
    retry_task_id: str | None = None


class TaskRecord(BaseModel):
    task_id: str
    source_url: str
    cookies_supplied: bool = False
    platform: str | None = None
    title: str | None = None
    thumbnail_url: str | None = None
    thumbnail_filename: str | None = None
    duration_seconds: int | None = None
    status: TaskState = "queued"
    progress: float = 0
    status_message: str = "等待提交"
    subtitle_enabled: bool = True
    subtitle_source: SubtitleSource = "none"
    subtitle_ready: bool = False
    video_ready: bool = False
    video_needs_transcode: bool = False
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None
    video_filename: str | None = None
    subtitle_srt_filename: str | None = None
    subtitle_txt_filename: str | None = None


class CreateTaskResponse(BaseModel):
    task_id: str


class SubtitleResponse(BaseModel):
    task_id: str
    source: SubtitleSource
    format: str
    content: str
