from __future__ import annotations

import json
import secrets
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from app.config import CODE_ALPHABET, CODE_LENGTH, JOB_EXPIRE_SECONDS, JOBS_DIR


@dataclass
class JobMeta:
    job_id: str
    code: str
    operation: str
    status: str
    created_at: str
    expires_at: str
    message: str = ""
    outputs: list[str] | None = None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def generate_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def job_path(job_id: str) -> Path:
    return JOBS_DIR / job_id


def create_job(operation: str) -> JobMeta:
    job_id = str(uuid4())
    code = generate_code()
    created = now_utc()
    meta = JobMeta(
        job_id=job_id,
        code=code,
        operation=operation,
        status="created",
        created_at=created.isoformat(),
        expires_at=(created + timedelta(seconds=JOB_EXPIRE_SECONDS)).isoformat(),
        outputs=[],
    )
    root = job_path(job_id)
    (root / "input").mkdir(parents=True, exist_ok=True)
    (root / "output").mkdir(parents=True, exist_ok=True)
    save_meta(meta)
    return meta


def save_meta(meta: JobMeta) -> None:
    root = job_path(meta.job_id)
    root.mkdir(parents=True, exist_ok=True)
    with (root / "metadata.json").open("w", encoding="utf-8") as f:
        json.dump(asdict(meta), f, ensure_ascii=False, indent=2)


def load_meta(job_id: str) -> JobMeta:
    with (job_path(job_id) / "metadata.json").open("r", encoding="utf-8") as f:
        data = json.load(f)
    return JobMeta(**data)


def find_by_code(code: str) -> JobMeta | None:
    normalized = code.strip().upper()
    for meta_file in JOBS_DIR.glob("*/metadata.json"):
        try:
            with meta_file.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("code") == normalized:
                meta = JobMeta(**data)
                if is_expired(meta):
                    delete_job(meta.job_id)
                    return None
                return meta
        except Exception:
            continue
    return None


def is_expired(meta: JobMeta) -> bool:
    return datetime.fromisoformat(meta.expires_at) <= now_utc()


def delete_job(job_id: str) -> None:
    shutil.rmtree(job_path(job_id), ignore_errors=True)


def cleanup_expired() -> int:
    deleted = 0
    for meta_file in JOBS_DIR.glob("*/metadata.json"):
        try:
            meta = load_meta(meta_file.parent.name)
            if is_expired(meta):
                delete_job(meta.job_id)
                deleted += 1
        except Exception:
            shutil.rmtree(meta_file.parent, ignore_errors=True)
            deleted += 1
    return deleted
