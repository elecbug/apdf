from __future__ import annotations

from pathlib import Path

from app.services.job_store import JobMeta, save_meta


def finalize_job(meta: JobMeta, outputs: list[Path], message: str = "Done") -> None:
    meta.status = "done"
    meta.message = message
    meta.outputs = [p.name for p in outputs]
    save_meta(meta)


def fail_job(meta: JobMeta, error: Exception | str) -> None:
    meta.status = "failed"
    meta.message = str(error)
    save_meta(meta)
