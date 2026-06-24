from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import JSONResponse

from app.config import MAX_INLINE_BYTES, MAX_INLINE_PAGES
from app.services import pdf_ops
from app.services.job_results import fail_job, finalize_job
from app.services.job_store import create_job, job_path
from app.utils.uploads import is_upload_file, save_upload


router = APIRouter(tags=["edit"])


SUPPORTED_EDIT_TYPES = {"insert_blank", "insert_image_page", "rotate", "delete_pages"}


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

    for index, op in enumerate(operations, start=1):
        if not isinstance(op, dict):
            raise ValueError(f"operation #{index} must be an object")

        op_type = str(op.get("type", "")).strip().lower()
        if op_type not in SUPPORTED_EDIT_TYPES:
            raise ValueError(f"Unsupported edit operation at #{index}: {op_type}")

        op["type"] = op_type

    return operations


@router.post("/edit/apply")
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
            if op.get("type") == "insert_image_page"
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

    except Exception as exc:
        fail_job(meta, exc)
        return JSONResponse(
            {"ok": False, "code": meta.code, "url": f"/job/{meta.code}", "error": str(exc)},
            status_code=400,
        )
