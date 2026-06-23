from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import MAX_INLINE_BYTES, MAX_INLINE_PAGES
from app.services import pdf_ops
from app.services.client_store import (
    allocate_source_path,
    cleanup_expired_clients,
    clear_sources,
    load_sources,
    make_source_meta,
    register_source,
    remove_source,
    source_pdf_path,
    touch_client,
)
from app.services.job_store import cleanup_expired, create_job, find_by_code, job_path, save_meta
from app.services.audit_log import write_access_log


app = FastAPI(title="APDF", version="0.3.0")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


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


def safe_name(name: str | None) -> str:
    base = Path(name or "uploaded.pdf").name.replace("/", "_").replace("\\", "_")
    return base or "uploaded.pdf"


async def save_upload(file: UploadFile, dst: Path) -> int:
    size = 0
    dst.parent.mkdir(parents=True, exist_ok=True)

    try:
        await file.seek(0)
    except Exception:
        pass

    with dst.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break

            size += len(chunk)
            f.write(chunk)

    try:
        await file.seek(0)
    except Exception:
        pass

    return size


def is_upload_file(value) -> bool:
    return hasattr(value, "filename") and hasattr(value, "read")


def sanitize_image_id(image_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", image_id.strip())
    if len(safe) < 3 or len(safe) > 80:
        raise ValueError("Invalid image_id")
    return safe


def safe_image_extension(upload: UploadFile) -> str:
    filename = upload.filename or ""
    suffix = Path(filename).suffix.lower()
    content_type = (upload.content_type or "").lower()

    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        return suffix

    if content_type == "image/png":
        return ".png"
    if content_type == "image/jpeg":
        return ".jpg"
    if content_type == "image/webp":
        return ".webp"

    raise ValueError("Only PNG, JPEG, or WebP images are allowed")


def load_edit_operations(raw: str) -> list[dict]:
    try:
        operations = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid operations JSON") from exc

    if not isinstance(operations, list):
        raise ValueError("operations must be a list")

    return operations


def finalize_job(meta, outputs: list[Path], message: str = "Done"):
    meta.status = "done"
    meta.message = message
    meta.outputs = [p.name for p in outputs]
    save_meta(meta)


@app.get("/")
def root():
    return RedirectResponse("/assemble", status_code=303)


@app.get("/assemble", response_class=HTMLResponse)
def assemble_page(request: Request):
    return templates.TemplateResponse("assemble.html", {"request": request})


@app.get("/edit", response_class=HTMLResponse)
def edit_page(request: Request):
    return templates.TemplateResponse("edit.html", {"request": request})


@app.get("/api/clients/{client_id}/sources")
def list_sources(client_id: str):
    try:
        touch_client(client_id)
        return {"sources": [source.__dict__ for source in load_sources(client_id)]}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/clients/{client_id}/sources")
async def upload_sources(client_id: str, files: Annotated[list[UploadFile], File()]):
    uploaded = []
    try:
        touch_client(client_id)
        for upload in files:
            if not upload.filename or not upload.filename.lower().endswith(".pdf"):
                raise HTTPException(400, "Only PDF files are allowed")

            source_id, dst = allocate_source_path(client_id)
            size = await save_upload(upload, dst)
            try:
                pages = pdf_ops.page_count(dst)
            except Exception as exc:
                dst.unlink(missing_ok=True)
                raise HTTPException(400, f"Invalid PDF: {upload.filename}") from exc

            meta = make_source_meta(source_id, safe_name(upload.filename), size, pages)
            register_source(client_id, meta)
            uploaded.append(meta.__dict__)

        return {"sources": uploaded}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/clients/{client_id}/sources/{source_id}")
def delete_source(client_id: str, source_id: str):
    try:
        removed = remove_source(client_id, source_id.strip().upper())
        if not removed:
            raise HTTPException(404, "Source not found")
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/clients/{client_id}/sources")
def clear_client_sources(client_id: str):
    try:
        clear_sources(client_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/compose")
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
        finalize_job(meta, [out], f"Assembled {len(plan)} ranges into {total_pages} pages. Mode: {mode}")
        return JSONResponse({"ok": True, "code": meta.code, "url": f"/job/{meta.code}"})
    except Exception as e:
        meta.status = "failed"
        meta.message = str(e)
        save_meta(meta)
        return JSONResponse({"ok": False, "code": meta.code, "url": f"/job/{meta.code}", "error": str(e)}, status_code=400)


@app.post("/edit/apply")
async def apply_edits(request: Request):
    meta = create_job("edit")
    root = job_path(meta.job_id)

    try:
        form = await request.form()

        pdf_upload = form.get("pdf")
        if not is_upload_file(pdf_upload):
            raise ValueError("PDF file is required")
        if not pdf_upload.filename or not pdf_upload.filename.lower().endswith(".pdf"):
            raise ValueError("Only PDF files are allowed")

        operations_raw = form.get("operations")
        if not isinstance(operations_raw, str):
            raise ValueError("operations field is required")

        operations = load_edit_operations(operations_raw)
        if not operations:
            raise ValueError("operations is empty")

        src = root / "input" / "target.pdf"
        total_size = await save_upload(pdf_upload, src)

        if total_size <= 0:
            raise ValueError("Uploaded PDF is empty")

        with src.open("rb") as f:
            header = f.read(5)

        if header != b"%PDF-":
            raise ValueError(f"Uploaded file is not a PDF. Header: {header!r}")

        try:
            original_pages = pdf_ops.page_count(src)
        except Exception as exc:
            src.unlink(missing_ok=True)
            raise ValueError(f"Invalid PDF: {exc}") from exc

        image_paths: dict[str, Path] = {}
        image_ids = {
            sanitize_image_id(str(op.get("image_id", "")))
            for op in operations
            if isinstance(op, dict) and str(op.get("type", "")).strip().lower() == "insert_image_page"
        }

        image_dir = root / "input" / "images"
        for image_id in image_ids:
            image_upload = form.get(image_id)
            if not is_upload_file(image_upload):
                raise ValueError(f"Missing image file: {image_id}")

            ext = safe_image_extension(image_upload)
            image_path = image_dir / f"{image_id}{ext}"
            total_size += await save_upload(image_upload, image_path)
            image_paths[image_id] = image_path

        out = root / "output" / "edited.pdf"
        pdf_ops.apply_edit_operations(src, operations, image_paths, out)

        total_pages = pdf_ops.page_count(out)
        mode = "inline" if total_size <= MAX_INLINE_BYTES and total_pages <= MAX_INLINE_PAGES else "job"
        finalize_job(
            meta,
            [out],
            f"Applied {len(operations)} edit operations. Pages: {original_pages} -> {total_pages}. Mode: {mode}",
        )
        return JSONResponse({
            "ok": True,
            "code": meta.code,
            "url": f"/job/{meta.code}",
            "download_url": f"/download/{meta.code}/edited.pdf",
            "filename": "edited.pdf",
        })
    
    except Exception as e:
        meta.status = "failed"
        meta.message = str(e)
        save_meta(meta)
        return JSONResponse({"ok": False, "code": meta.code, "url": f"/job/{meta.code}", "error": str(e)}, status_code=400)


@app.post("/merge")
async def merge(files: Annotated[list[UploadFile], File()]):
    meta = create_job("merge")
    root = job_path(meta.job_id)
    input_paths: list[Path] = []
    total_size = 0
    try:
        for idx, upload in enumerate(files):
            if not upload.filename or not upload.filename.lower().endswith(".pdf"):
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
