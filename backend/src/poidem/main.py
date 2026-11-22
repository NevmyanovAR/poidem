import asyncio
from contextlib import asynccontextmanager, suppress

import anyio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from poidem import __version__
from poidem.api.errors import register_errors
from poidem.api.middleware import (
    BodyLimitMiddleware,
    ExactHostMiddleware,
    ExceptionBoundaryMiddleware,
    RequestContextMiddleware,
)
from poidem.api.routers import account, health, reference_data
from poidem.db.session import Database
from poidem.services.media import cleanup_loop
from poidem.settings import Settings, load_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.database = Database(settings)
        app.state.migration_heads = health.migration_heads()
        app.state.settings = settings
        app.state.photo_limiter = anyio.CapacityLimiter(2)
        cleanup = asyncio.create_task(cleanup_loop(app.state.database, settings))
        try:
            yield
        finally:
            cleanup.cancel()
            with suppress(asyncio.CancelledError):
                await cleanup
            await app.state.database.close()

    app = FastAPI(
        title="Пойдём? API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.app_env != "production" else None,
    )
    register_errors(app)
    app.include_router(health.router)
    app.include_router(reference_data.router)
    app.include_router(account.router)
    # Последний добавленный middleware оборачивает остальные.
    app.add_middleware(ExceptionBoundaryMiddleware)
    app.add_middleware(BodyLimitMiddleware, photo_max_bytes=settings.photo_max_bytes)
    app.add_middleware(ExactHostMiddleware, allowed_hosts=settings.trusted_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestContextMiddleware)
    return app
