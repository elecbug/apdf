from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from app.config import ASSEMBLE_RESULT_CODE_ENABLED
from app.services import pdf_ops
from app.services.client_store import load_sources, source_pdf_path
from app.services.job_results import fail_job, finalize_job
from app.services.job_store import create_job, job_path


router = APIRouter(tags=["compose"])


def compose_direct(source_paths: dict[str, Path], plan: list[dict]):
    temporary = TemporaryDirectory(prefix="apdf-compose-")
    try:
        out = Path(temporary.name) / "assembled.pdf"
        pdf_ops.assemble_sources(source_paths, plan, out)
        return FileResponse(
            out,
            filename=out.name,
            media_type="application/pdf",
            headers={"Cache-Control": "no-store"},
            background=BackgroundTask(temporary.cleanup),
        )
    except Exception:
        temporary.cleanup()
        raise


def compose_with_result_code(source_paths: dict[str, Path], plan: list[dict]):
    meta = create_job("compose")
    try:
        out = job_path(meta.job_id) / "output" / "assembled.pdf"
        pdf_ops.assemble_sources(source_paths, plan, out)
        total_pages = pdf_ops.page_count(out)
        finalize_job(meta, [out], f"Assembled {len(plan)} source PDF(s) into {total_pages} pages.")
        return JSONResponse({
            "ok": True,
            "code": meta.code,
            "mode": "job",
            "url": f"/job/{meta.code}",
            "filename": out.name,
        })
    except Exception as exc:
        fail_job(meta, exc)
        return JSONResponse(
            {"ok": False, "code": meta.code, "url": f"/job/{meta.code}", "error": str(exc)},
            status_code=400,
        )


@router.post("/compose")
async def compose(request: Request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("Request must be a JSON object")
        client_id = str(payload.get("client_id", ""))
        plan = payload.get("plan")
        if not isinstance(plan, list):
            raise ValueError("plan must be a list")
        if not plan:
            raise ValueError("Assembly plan is empty")

        sources = {item.source_id: item for item in load_sources(client_id)}
        source_paths: dict[str, Path] = {}
        for item in plan:
            if not isinstance(item, dict):
                raise ValueError("Each assembly plan item must be a JSON object")
            source_id = str(item.get("source_id", "")).strip().upper()
            if source_id not in sources:
                raise ValueError(f"Unknown source_id: {source_id}")
            path = source_pdf_path(client_id, source_id)
            if not path.exists():
                raise ValueError(f"Source file missing: {source_id}")
            source_paths[source_id] = path

        build = compose_with_result_code if ASSEMBLE_RESULT_CODE_ENABLED else compose_direct
        return await run_in_threadpool(build, source_paths, plan)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
