from datetime import datetime
from pathlib import Path
import threading
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .downloader import get_desktop_diagnostics
from .jobs import cancel_task, process_task
from .models import CreateTaskRequest, CreateTaskResponse, SubtitleResponse, TaskRecord
from .queue import get_queue
from .task_store import (
    create_task,
    delete_task,
    find_completed_task_by_url,
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
def submit_task(payload: CreateTaskRequest, allow_duplicate: bool = False) -> CreateTaskResponse:
    purge_expired_tasks()
    try:
        source_url = extract_first_url(str(payload.url))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not allow_duplicate:
        existing = find_completed_task_by_url(source_url)
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=existing.model_dump(mode="json"),
            )

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


@app.get("/api/tasks/check-duplicate")
def check_duplicate(url: str) -> dict[str, object]:
    try:
        source_url = extract_first_url(url)
    except ValueError:
        return {"duplicate": False, "task": None}
    existing = find_completed_task_by_url(source_url)
    if existing is None:
        return {"duplicate": False, "task": None}
    return {"duplicate": True, "task": existing.model_dump(mode="json")}


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


@app.post("/api/tasks/{task_id}/cancel")
def cancel_task_endpoint(task_id: str) -> dict[str, str]:
    task = load_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status in ("completed", "failed", "expired"):
        raise HTTPException(status_code=400, detail="Task is already in terminal state")
    cancelled = cancel_task(task_id)
    if not cancelled:
        update_task(task_id, status="failed", status_message="任务已被用户终止", error_code="CancelledError", error_message="任务已被用户终止")
    return {"status": "cancelled", "task_id": task_id}


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


# ---------------------------------------------------------------------------
# Douyin real-browser cookie-login session
# ---------------------------------------------------------------------------

_login_state: dict[str, bool] = {"active": False}


def _open_browser(url: str, browser_name: str) -> None:
    import platform
    import subprocess

    system = platform.system()
    if system == "Darwin":
        browser_apps = {
            "chrome": "/Applications/Google Chrome.app",
            "edge": "/Applications/Microsoft Edge.app",
            "safari": "Safari",
        }
        app = browser_apps.get(browser_name.lower(), browser_apps["chrome"])
        subprocess.Popen(["open", "-a", app, url])
    elif system == "Windows":
        subprocess.Popen(["cmd", "/c", "start", url])
    else:
        subprocess.Popen(["xdg-open", url])


@app.post("/api/douyin/cookies/login")
def start_douyin_login() -> dict[str, str]:
    if _login_state["active"]:
        return {"status": "already_active"}

    browser_name = settings.douyin_cookies_browser
    _open_browser("https://www.douyin.com/", browser_name)
    _login_state["active"] = True

    return {"status": "started", "browser": browser_name}


@app.post("/api/douyin/cookies/export")
def export_douyin_cookies() -> dict[str, object]:
    if not _login_state["active"]:
        raise HTTPException(status_code=400, detail="没有活跃的登录会话，请先调用 /api/douyin/cookies/login")

    from .downloader import (
        build_netscape_cookie_lines,
        get_site_browser_name,
        get_site_domains,
        load_browser_cookie_jar,
    )

    browser_name = get_site_browser_name("douyin")
    jar = load_browser_cookie_jar(browser_name, "douyin")
    if jar is None:
        _login_state["active"] = False
        raise HTTPException(status_code=400, detail="无法从浏览器读取抖音 Cookie，请确认已在浏览器中登录抖音")

    lines = build_netscape_cookie_lines(jar, "douyin")
    settings.douyin_cookie_file.parent.mkdir(parents=True, exist_ok=True)
    settings.douyin_cookie_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    domains = get_site_domains("douyin")
    cookie_count = sum(
        1 for cookie in jar
        if cookie.name and cookie.value
        and any(
            cookie.domain.lstrip(".") == d.lstrip(".")
            or cookie.domain.lstrip(".").endswith("." + d.lstrip("."))
            for d in domains
        )
    )
    key_names = {"msToken", "ttwid", "odin_tt", "passport_csrf_token", "sid_guard"}
    found = sorted(cookie.name for cookie in jar if cookie.name in key_names)

    _login_state["active"] = False

    return {
        "status": "saved",
        "cookie_count": cookie_count,
        "key_cookies": found,
        "file": str(settings.douyin_cookie_file),
    }


@app.get("/api/douyin/cookies/status")
def douyin_login_status() -> dict[str, object]:
    return {"active": _login_state["active"]}


@app.post("/api/douyin/cookies/cancel")
def cancel_douyin_login() -> dict[str, str]:
    _login_state["active"] = False
    return {"status": "cancelled"}
