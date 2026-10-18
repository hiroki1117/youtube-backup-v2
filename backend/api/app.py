from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from mangum import Mangum

from api.dependencies import require_auth
from api.deployment import deployment_entrypoint
from api.routes import backup_router, video_router
from usecases.models import DomainError


def create_app(kind: str = "all") -> FastAPI:
    app = FastAPI(
        title="YouTube Backup API",
        version="0.1.0",
        dependencies=[Depends(require_auth)],
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    if kind in {"all", "video"}:
        app.include_router(video_router)
    if kind in {"all", "backup"}:
        app.include_router(backup_router)

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, error: DomainError):
        return JSONResponse(status_code=error.status, content={"detail": error.code})

    @app.exception_handler(Exception)
    async def upstream_error(request: Request, error: Exception):
        return JSONResponse(status_code=503, content={"detail": "upstream_unavailable"})

    return app


# Export/local aggregate only. AWS functions use the same routers in resource-specific apps.
app = create_app()
video_handler = deployment_entrypoint("video")(Mangum(create_app("video"), lifespan="off"))
backup_handler = deployment_entrypoint("backup")(Mangum(create_app("backup"), lifespan="off"))
