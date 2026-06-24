from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

from app.services.job_store import delete_job, find_by_code, job_path
from app.web import templates


router = APIRouter(tags=["jobs"])


@router.get("/job/{code}", response_class=HTMLResponse)
def job_result(request: Request, code: str):
    meta = find_by_code(code)
    if not meta:
        raise HTTPException(404, "Job not found or expired")
    return templates.TemplateResponse("job.html", {"request": request, "job": meta})


@router.post("/lookup")
def lookup(code: Annotated[str, Form()]):
    return RedirectResponse(f"/job/{code.strip().upper()}", status_code=303)


@router.get("/download/{code}/{filename}")
def download(code: str, filename: str):
    meta = find_by_code(code)
    if not meta or not meta.outputs or filename not in meta.outputs:
        raise HTTPException(404, "File not found")

    path = job_path(meta.job_id) / "output" / filename
    return FileResponse(path, filename=filename, media_type="application/pdf")


@router.post("/delete-job/{code}")
def delete_job_route(code: str):
    meta = find_by_code(code)
    if meta:
        delete_job(meta.job_id)
    return RedirectResponse("/", status_code=303)
