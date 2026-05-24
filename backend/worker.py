from rq import Worker

from app.queue import get_redis_connection


def main() -> None:
    worker = Worker(["video_tasks"], connection=get_redis_connection())
    worker.work()


if __name__ == "__main__":
    main()
