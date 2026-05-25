from datetime import datetime
from pathlib import Path
import threading
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .downloader import get_desktop_diagnostics
from .jobs import process_task
from .models import CreateTaskRequest, CreateTaskResponse, SubtitleResponse, TaskRecord
from .queue import get_queue
from .task_store import (
    create_task,
    delete_task,
    get_task_dir,
    list_recent_tasks,
    load_task,
    purge_expired_tasks,
    read_text_file,
    update_task,
)
from .url_extract import extract_first_url


app = FastAPI(title="Video Downloader API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.app_env == "desktop" else list(settings.allowed_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_existing_task(task_id: str) -> TaskRecord:
    task = load_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.expires_at and task.expires_at < datetime.utcnow():
        update_task(task_id, status="expired")
        raise HTTPException(status_code=410, detail="Task expired")
    return task


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/desktop/diagnostics")
def desktop_diagnostics() -> dict[str, object]:
    return get_desktop_diagnostics()


@app.post("/api/tasks", response_model=CreateTaskResponse)
def submit_task(payload: CreateTaskRequest) -> CreateTaskResponse:
    purge_expired_tasks()
    try:
        source_url = extract_first_url(str(payload.url))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    task_id = uuid4().hex
    create_task(task_id, source_url, cookies_supplied=bool(payload.cookies and payload.cookies.strip()))
    if settings.queue_mode == "inline":
        thread = threading.Thread(
            target=process_task,
            args=(task_id, source_url, payload.cookies),
            daemon=True,
        )
        thread.start()
    else:
        queue = get_queue()
        queue.enqueue(process_task, task_id, source_url, payload.cookies, job_id=task_id)
    return CreateTaskResponse(task_id=task_id)


@app.get("/api/tasks/{task_id}", response_model=TaskRecord)
def get_task(task_id: str) -> TaskRecord:
    return get_existing_task(task_id)


@app.get("/api/tasks", response_model=list[TaskRecord])
def get_recent_tasks(limit: int = 8) -> list[TaskRecord]:
    purge_expired_tasks()
    return list_recent_tasks(limit=limit)


@app.delete("/api/tasks/{task_id}")
def remove_task(task_id: str) -> dict[str, bool]:
    deleted = delete_task(task_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"deleted": True}


@app.get("/api/tasks/{task_id}/subtitle", response_model=SubtitleResponse)
def get_subtitle(task_id: str) -> SubtitleResponse:
    task = get_existing_task(task_id)
    if not task.subtitle_ready or not task.subtitle_txt_filename:
        raise HTTPException(status_code=404, detail="Subtitle not ready")
    return SubtitleResponse(
        task_id=task_id,
        source=task.subtitle_source,
        format="txt",
        content=read_text_file(task_id, task.subtitle_txt_filename),
    )


@app.get("/api/tasks/{task_id}/files/video")
def download_video(task_id: str) -> FileResponse:
    task = get_existing_task(task_id)
    if not task.video_ready or not task.video_filename:
        raise HTTPException(status_code=404, detail="Video not ready")
    path = get_task_dir(task_id) / task.video_filename
    return guarded_file_response(path, task.video_filename, "video/mp4")


@app.get("/api/tasks/{task_id}/thumbnail")
def download_thumbnail(task_id: str) -> FileResponse:
    task = get_existing_task(task_id)
    if not task.thumbnail_filename:
        raise HTTPException(status_code=404, detail="Thumbnail not ready")
    path = get_task_dir(task_id) / task.thumbnail_filename
    media_type = "image/jpeg"
    if path.suffix.lower() == ".png":
        media_type = "image/png"
    elif path.suffix.lower() == ".webp":
        media_type = "image/webp"
    return guarded_file_response(path, task.thumbnail_filename, media_type)


@app.get("/api/tasks/{task_id}/files/subtitle.srt")
def download_subtitle_srt(task_id: str) -> FileResponse:
    task = get_existing_task(task_id)
    if not task.subtitle_ready or not task.subtitle_srt_filename:
        raise HTTPException(status_code=404, detail="Subtitle not ready")
    path = get_task_dir(task_id) / task.subtitle_srt_filename
    return guarded_file_response(path, task.subtitle_srt_filename, "application/x-subrip")


@app.get("/api/tasks/{task_id}/files/subtitle.txt")
def download_subtitle_txt(task_id: str) -> FileResponse:
    task = get_existing_task(task_id)
    if not task.subtitle_ready or not task.subtitle_txt_filename:
        raise HTTPException(status_code=404, detail="Subtitle not ready")
    path = get_task_dir(task_id) / task.subtitle_txt_filename
    return guarded_file_response(path, task.subtitle_txt_filename, "text/plain; charset=utf-8")


def guarded_file_response(path: Path, filename: str, media_type: str) -> FileResponse:
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(path, filename=filename, media_type=media_type)
