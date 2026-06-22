from __future__ import annotations

import shutil
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import JOBS_DIR, MAX_INLINE_BYTES, MAX_INLINE_PAGES
from app.services import pdf_ops
from app.services.job_store import cleanup_expired, create_job, find_by_code, job_path, load_meta, save_meta

app = FastAPI(title="APDF", version="0.1.0")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


@app.middleware("http")
async def cleanup_middleware(request: Request, call_next):
    # Small internal tool: opportunistic cleanup per request.
    cleanup_expired()
    return await call_next(request)


def safe_name(name: str) -> str:
    base = Path(name).name.replace("/", "_").replace("\\", "_")
    return base or "uploaded.pdf"


async def save_upload(file: UploadFile, dst: Path) -> int:
    size = 0
    with dst.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            f.write(chunk)
    return size


def finalize_job(meta, outputs: list[Path], message: str = "Done"):
    meta.status = "done"
    meta.message = message
    meta.outputs = [p.name for p in outputs]
    save_meta(meta)


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/merge")
async def merge(files: Annotated[list[UploadFile], File()]):
    meta = create_job("merge")
    root = job_path(meta.job_id)
    input_paths: list[Path] = []
    total_size = 0
    try:
        for idx, upload in enumerate(files):
            if not upload.filename.lower().endswith(".pdf"):
                raise HTTPException(400, "Only PDF files are allowed")
            dst = root / "input" / f"{idx:03d}_{safe_name(upload.filename)}"
            total_size += await save_upload(upload, dst)
            input_paths.append(dst)
        total_pages = sum(pdf_ops.page_count(p) for p in input_paths)
        out = root / "output" / "merged.pdf"
        pdf_ops.merge_pdfs(input_paths, out)
        mode = "inline" if total_size <= MAX_INLINE_BYTES and total_pages <= MAX_INLINE_PAGES else "job"
        finalize_job(meta, [out], f"Merged {len(input_paths)} files. Mode: {mode}")
        return RedirectResponse(f"/job/{meta.code}", status_code=303)
    except Exception as e:
        meta.status = "failed"
        meta.message = str(e)
        save_meta(meta)
        return RedirectResponse(f"/job/{meta.code}", status_code=303)


@app.post("/extract")
async def extract(file: Annotated[UploadFile, File()], pages: Annotated[str, Form()]):
    meta = create_job("extract")
    root = job_path(meta.job_id)
    try:
        src = root / "input" / safe_name(file.filename)
        await save_upload(file, src)
        out = root / "output" / "extracted.pdf"
        pdf_ops.extract_pages(src, pages, out)
        finalize_job(meta, [out], f"Extracted pages: {pages}")
        return RedirectResponse(f"/job/{meta.code}", status_code=303)
    except Exception as e:
        meta.status = "failed"; meta.message = str(e); save_meta(meta)
        return RedirectResponse(f"/job/{meta.code}", status_code=303)


@app.post("/delete")
async def delete_pages(file: Annotated[UploadFile, File()], pages: Annotated[str, Form()]):
    meta = create_job("delete")
    root = job_path(meta.job_id)
    try:
        src = root / "input" / safe_name(file.filename)
        await save_upload(file, src)
        out = root / "output" / "deleted.pdf"
        pdf_ops.delete_pages(src, pages, out)
        finalize_job(meta, [out], f"Deleted pages: {pages}")
        return RedirectResponse(f"/job/{meta.code}", status_code=303)
    except Exception as e:
        meta.status = "failed"; meta.message = str(e); save_meta(meta)
        return RedirectResponse(f"/job/{meta.code}", status_code=303)


@app.post("/rotate")
async def rotate(file: Annotated[UploadFile, File()], pages: Annotated[str, Form()], angle: Annotated[int, Form()]):
    meta = create_job("rotate")
    root = job_path(meta.job_id)
    try:
        src = root / "input" / safe_name(file.filename)
        await save_upload(file, src)
        out = root / "output" / "rotated.pdf"
        pdf_ops.rotate_pages(src, pages, angle, out)
        finalize_job(meta, [out], f"Rotated pages {pages} by {angle} degrees")
        return RedirectResponse(f"/job/{meta.code}", status_code=303)
    except Exception as e:
        meta.status = "failed"; meta.message = str(e); save_meta(meta)
        return RedirectResponse(f"/job/{meta.code}", status_code=303)


@app.post("/split")
async def split(file: Annotated[UploadFile, File()], ranges: Annotated[str, Form()]):
    meta = create_job("split")
    root = job_path(meta.job_id)
    try:
        src = root / "input" / safe_name(file.filename)
        await save_upload(file, src)
        outputs = pdf_ops.split_ranges(src, ranges, root / "output")
        finalize_job(meta, outputs, "Split complete")
        return RedirectResponse(f"/job/{meta.code}", status_code=303)
    except Exception as e:
        meta.status = "failed"; meta.message = str(e); save_meta(meta)
        return RedirectResponse(f"/job/{meta.code}", status_code=303)


@app.post("/overlay/text")
async def overlay_text(
    file: Annotated[UploadFile, File()],
    page: Annotated[int, Form()],
    text: Annotated[str, Form()],
    x: Annotated[float, Form()],
    y: Annotated[float, Form()],
    font_size: Annotated[int, Form()] = 12,
    opacity: Annotated[float, Form()] = 1.0,
):
    meta = create_job("overlay_text")
    root = job_path(meta.job_id)
    try:
        src = root / "input" / safe_name(file.filename)
        await save_upload(file, src)
        out = root / "output" / "text_overlay.pdf"
        pdf_ops.overlay_text(src, out, page, text, x, y, font_size, opacity)
        finalize_job(meta, [out], "Text overlay applied")
        return RedirectResponse(f"/job/{meta.code}", status_code=303)
    except Exception as e:
        meta.status = "failed"; meta.message = str(e); save_meta(meta)
        return RedirectResponse(f"/job/{meta.code}", status_code=303)


@app.post("/overlay/image")
async def overlay_image(
    file: Annotated[UploadFile, File()],
    image: Annotated[UploadFile, File()],
    page: Annotated[int, Form()],
    x: Annotated[float, Form()],
    y: Annotated[float, Form()],
    width: Annotated[float, Form()],
    height: Annotated[float, Form()] = 0,
    opacity: Annotated[float, Form()] = 1.0,
):
    meta = create_job("overlay_image")
    root = job_path(meta.job_id)
    try:
        src = root / "input" / safe_name(file.filename)
        img = root / "input" / safe_name(image.filename)
        await save_upload(file, src)
        await save_upload(image, img)
        out = root / "output" / "image_overlay.pdf"
        pdf_ops.overlay_image(src, img, out, page, x, y, width, height if height > 0 else None, opacity)
        finalize_job(meta, [out], "Image overlay applied")
        return RedirectResponse(f"/job/{meta.code}", status_code=303)
    except Exception as e:
        meta.status = "failed"; meta.message = str(e); save_meta(meta)
        return RedirectResponse(f"/job/{meta.code}", status_code=303)


@app.get("/job/{code}", response_class=HTMLResponse)
def job_result(request: Request, code: str):
    meta = find_by_code(code)
    if not meta:
        raise HTTPException(404, "Job not found or expired")
    return templates.TemplateResponse("job.html", {"request": request, "job": meta})


@app.post("/lookup")
def lookup(code: Annotated[str, Form()]):
    return RedirectResponse(f"/job/{code.strip().upper()}", status_code=303)


@app.get("/download/{code}/{filename}")
def download(code: str, filename: str):
    meta = find_by_code(code)
    if not meta or not meta.outputs or filename not in meta.outputs:
        raise HTTPException(404, "File not found")
    path = job_path(meta.job_id) / "output" / filename
    return FileResponse(path, filename=filename, media_type="application/pdf")


@app.post("/delete-job/{code}")
def delete_job_route(code: str):
    meta = find_by_code(code)
    if meta:
        shutil.rmtree(job_path(meta.job_id), ignore_errors=True)
    return RedirectResponse("/", status_code=303)
