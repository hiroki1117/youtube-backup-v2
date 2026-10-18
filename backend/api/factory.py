from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from api.dependencies import require_auth
from usecases.models import DomainError


def build_app(*routers: APIRouter) -> FastAPI:
    app = FastAPI(
        title="YouTube Backup API",
        version="0.1.0",
        dependencies=[Depends(require_auth)],
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    for router in routers:
        app.include_router(router)

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, error: DomainError):
        return JSONResponse(status_code=error.status, content={"detail": error.code})

    @app.exception_handler(Exception)
    async def upstream_error(request: Request, error: Exception):
        return JSONResponse(status_code=503, content={"detail": "upstream_unavailable"})

    return app
