from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from app.routes import compose, edit, jobs, pages, sources
from app.services.audit_log import write_access_log
from app.services.client_store import cleanup_expired_clients
from app.services.job_store import cleanup_expired
from app.web import APP_DIR


APP_VERSION = "0.4.0"


def create_app() -> FastAPI:
    app = FastAPI(title="APDF", version=APP_VERSION)
    app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")

    @app.middleware("http")
    async def cleanup_and_access_log_middleware(request: Request, call_next):
        # Small internal tool: opportunistic cleanup per request.
        cleanup_expired()
        cleanup_expired_clients()

        status_code = 500

        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            # Do not log PDF contents, filenames, client_id, source_id, job code, or user-agent.
            # Only access IP + endpoint-level request metadata are recorded.
            if not request.url.path.startswith("/static/"):
                try:
                    write_access_log(request, status_code)
                except Exception:
                    pass

    app.include_router(pages.router)
    app.include_router(sources.router)
    app.include_router(compose.router)
    app.include_router(edit.router)
    app.include_router(jobs.router)

    return app


app = create_app()
