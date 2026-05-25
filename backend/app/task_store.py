from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import json
import shutil

from .config import settings
from .models import TaskRecord


def get_task_dir(task_id: str) -> Path:
    return settings.tasks_dir / task_id


def get_task_meta_path(task_id: str) -> Path:
    return get_task_dir(task_id) / "meta.json"


def save_task(record: TaskRecord) -> TaskRecord:
    task_dir = get_task_dir(record.task_id)
    task_dir.mkdir(parents=True, exist_ok=True)
    record.updated_at = datetime.utcnow()
    get_task_meta_path(record.task_id).write_text(
        record.model_dump_json(indent=2),
        encoding="utf-8",
    )
    return record


def load_task(task_id: str) -> TaskRecord | None:
    meta_path = get_task_meta_path(task_id)
    if not meta_path.exists():
        return None
    return TaskRecord.model_validate_json(meta_path.read_text(encoding="utf-8"))


def create_task(task_id: str, source_url: str, cookies_supplied: bool = False) -> TaskRecord:
    record = TaskRecord(
        task_id=task_id,
        source_url=source_url,
        cookies_supplied=cookies_supplied,
        status="queued",
        progress=0,
        status_message="任务已创建，等待处理",
        expires_at=datetime.utcnow() + timedelta(seconds=settings.task_ttl_seconds),
    )
    return save_task(record)


def update_task(task_id: str, **changes: object) -> TaskRecord:
    record = load_task(task_id)
    if record is None:
        raise FileNotFoundError(f"Task {task_id} not found")
    update_data = record.model_dump()
    update_data.update(changes)
    updated = TaskRecord(**update_data)
    if updated.status != "expired":
        updated.expires_at = datetime.utcnow() + timedelta(seconds=settings.task_ttl_seconds)
    return save_task(updated)


def read_text_file(task_id: str, filename: str) -> str:
    path = get_task_dir(task_id) / filename
    return path.read_text(encoding="utf-8")


def list_expired_task_ids(now: datetime | None = None) -> list[str]:
    now = now or datetime.utcnow()
    expired: list[str] = []
    for task_dir in settings.tasks_dir.iterdir():
        if not task_dir.is_dir():
            continue
        record = load_task(task_dir.name)
        if record and record.expires_at and record.expires_at < now:
            expired.append(task_dir.name)
    return expired


def purge_expired_tasks() -> list[str]:
    removed: list[str] = []
    for task_id in list_expired_task_ids():
        task_dir = get_task_dir(task_id)
        if task_dir.exists():
            shutil.rmtree(task_dir, ignore_errors=True)
        removed.append(task_id)
    return removed


def delete_task(task_id: str) -> bool:
    task_dir = get_task_dir(task_id)
    if not task_dir.exists():
        return False
    shutil.rmtree(task_dir, ignore_errors=True)
    return True


def list_recent_tasks(limit: int = 8) -> list[TaskRecord]:
    records: list[TaskRecord] = []
    for task_dir in settings.tasks_dir.iterdir():
        if not task_dir.is_dir():
            continue
        record = load_task(task_dir.name)
        if record is not None:
            records.append(record)
    records.sort(key=lambda record: record.created_at, reverse=True)
    return records[: max(1, limit)]


def load_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
