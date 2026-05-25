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


# ---------------------------------------------------------------------------
# Douyin Playwright cookie-login session
# ---------------------------------------------------------------------------

_DOUYIN_COOKIE_DOMAINS = (
    "douyin.com",
    ".douyin.com",
    "www.douyin.com",
    "v.douyin.com",
    ".iesdouyin.com",
)

_login_state: dict = {
    "active": False,
    "playwright": None,
    "browser": None,
    "context": None,
}


@app.post("/api/douyin/cookies/login")
async def start_douyin_login() -> dict[str, str]:
    if _login_state["active"]:
        return {"status": "already_active"}

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise HTTPException(status_code=500, detail="playwright 未安装，请先执行 pip install playwright && playwright install chromium")

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False)
    context = await browser.new_context()
    page = await context.new_page()
    await page.goto("https://www.douyin.com/", wait_until="domcontentloaded")

    _login_state["active"] = True
    _login_state["playwright"] = pw
    _login_state["browser"] = browser
    _login_state["context"] = context

    return {"status": "started"}


@app.post("/api/douyin/cookies/export")
async def export_douyin_cookies() -> dict[str, object]:
    if not _login_state["active"]:
        raise HTTPException(status_code=400, detail="没有活跃的登录会话，请先调用 /api/douyin/cookies/login")

    context = _login_state["context"]
    raw_cookies = await context.cookies()
    cookies = [
        c for c in raw_cookies
        if any(c["domain"] == d or c["domain"].endswith(d) for d in _DOUYIN_COOKIE_DOMAINS)
    ]

    cookie_header = "; ".join(
        f"{c['name']}={c['value']}" for c in cookies if c.get("name") and c.get("value")
    )
    settings.douyin_cookie_file.parent.mkdir(parents=True, exist_ok=True)
    settings.douyin_cookie_file.write_text(cookie_header + "\n", encoding="utf-8")

    key_names = {"msToken", "ttwid", "odin_tt", "passport_csrf_token", "sid_guard"}
    found = sorted(c["name"] for c in cookies if c["name"] in key_names)

    await _login_state["browser"].close()
    await _login_state["playwright"].stop()
    _login_state["active"] = False
    _login_state["playwright"] = None
    _login_state["browser"] = None
    _login_state["context"] = None

    return {
        "status": "saved",
        "cookie_count": len(cookies),
        "key_cookies": found,
        "file": str(settings.douyin_cookie_file),
    }


@app.get("/api/douyin/cookies/status")
async def douyin_login_status() -> dict[str, object]:
    return {"active": _login_state["active"]}


@app.post("/api/douyin/cookies/cancel")
async def cancel_douyin_login() -> dict[str, str]:
    if _login_state["active"]:
        try:
            await _login_state["browser"].close()
        except Exception:
            pass
        try:
            await _login_state["playwright"].stop()
        except Exception:
            pass
        _login_state["active"] = False
        _login_state["playwright"] = None
        _login_state["browser"] = None
        _login_state["context"] = None
    return {"status": "cancelled"}
