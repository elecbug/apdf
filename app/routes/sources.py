from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services import pdf_ops
from app.services.client_store import (
    allocate_source_path,
    clear_sources,
    load_sources,
    make_source_meta,
    register_source,
    remove_source,
    touch_client,
)
from app.utils.uploads import safe_name, save_upload


router = APIRouter(prefix="/api/clients/{client_id}/sources", tags=["sources"])


@router.get("")
def list_sources(client_id: str):
    try:
        touch_client(client_id)
        return {"sources": [source.__dict__ for source in load_sources(client_id)]}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("")
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


@router.delete("/{source_id}")
def delete_source(client_id: str, source_id: str):
    try:
        removed = remove_source(client_id, source_id.strip().upper())
        if not removed:
            raise HTTPException(404, "Source not found")
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("")
def clear_client_sources(client_id: str):
    try:
        clear_sources(client_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
