from fastapi import FastAPI

from api.factory import build_app
from api.routes import backup_router, video_router


def create_app() -> FastAPI:
    # Export/local aggregate only. Each Lambda mounts just its own router from entrypoints/.
    return build_app(video_router, backup_router)


app = create_app()
