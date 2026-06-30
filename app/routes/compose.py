from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import MAX_INLINE_BYTES, MAX_INLINE_PAGES
from app.services import pdf_ops
from app.services.client_store import load_sources, source_pdf_path
from app.services.job_results import fail_job, finalize_job
from app.services.job_store import create_job, job_path


router = APIRouter(tags=["compose"])


@router.post("/compose")
async def compose(request: Request):
    meta = create_job("compose")
    root = job_path(meta.job_id)

    try:
        payload = await request.json()
        client_id = str(payload.get("client_id", ""))
        plan = payload.get("plan")

        if not isinstance(plan, list):
            raise ValueError("plan must be a list")
        if not plan:
            raise ValueError("Assembly plan is empty")

        sources = {item.source_id: item for item in load_sources(client_id)}
        source_paths: dict[str, Path] = {}
        total_size = 0

        for item in plan:
            source_id = str(item.get("source_id", "")).strip().upper()
            if source_id not in sources:
                raise ValueError(f"Unknown source_id: {source_id}")

            path = source_pdf_path(client_id, source_id)
            if not path.exists():
                raise ValueError(f"Source file missing: {source_id}")

            source_paths[source_id] = path
            total_size += sources[source_id].size

        out = root / "output" / "assembled.pdf"
        pdf_ops.assemble_sources(source_paths, plan, out)
        total_pages = pdf_ops.page_count(out)
        mode = "inline" if total_size <= MAX_INLINE_BYTES and total_pages <= MAX_INLINE_PAGES else "job"

        finalize_job(meta, [out], f"Assembled {len(plan)} source PDF(s) into {total_pages} pages. Mode: {mode}")

        response = {
            "ok": True,
            "code": meta.code,
            "mode": mode,
            "url": f"/job/{meta.code}",
            "filename": out.name,
        }

        if mode == "inline":
            response["download_url"] = f"/download/{meta.code}/{out.name}"

        return JSONResponse(response)

    except Exception as exc:
        fail_job(meta, exc)
        return JSONResponse(
            {"ok": False, "code": meta.code, "url": f"/job/{meta.code}", "error": str(exc)},
            status_code=400,
        )
