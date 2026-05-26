from __future__ import annotations

import os
import sys


def setup_path() -> None:
    if getattr(sys, "frozen", False):
        base_path = sys._MEIPASS
        scripts_dir = os.path.join(base_path, "scripts")
        if os.path.isdir(scripts_dir):
            sys.path.insert(0, scripts_dir)

        douyin_dir = os.environ.get("DOUYIN_DOWNLOADER_DIR", "")
        if douyin_dir and os.path.isdir(douyin_dir):
            sys.path.insert(0, douyin_dir)


def run_backend() -> None:
    setup_path()
    from app.main import app as fastapi_app

    import uvicorn

    host = os.getenv("DESKTOP_BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("DESKTOP_BACKEND_PORT", "18180"))
    uvicorn.run(fastapi_app, host=host, port=port, log_level="info")


def run_helper() -> None:
    setup_path()
    import asyncio

    import douyin_downloader_helper

    parser = douyin_downloader_helper.parse_args()
    payload = asyncio.run(
        douyin_downloader_helper.probe(parser.repo_dir, parser.url, parser.cookie_file)
    )
    print(douyin_downloader_helper.json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--helper":
        sys.argv = sys.argv[1:]
        sys.argv[0] = "douyin_downloader_helper"
        run_helper()
    else:
        run_backend()
