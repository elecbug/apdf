from __future__ import annotations

import json
import re
import secrets
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.config import CLIENT_EXPIRE_SECONDS, CLIENTS_DIR, CODE_ALPHABET


@dataclass
class SourceMeta:
    source_id: str
    name: str
    filename: str
    pages: int
    size: int
    created_at: str


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def sanitize_client_id(client_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", client_id.strip())
    if len(safe) < 8 or len(safe) > 80:
        raise ValueError("Invalid client_id")
    return safe


def generate_source_id() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))


def client_path(client_id: str) -> Path:
    safe = sanitize_client_id(client_id)
    root = CLIENTS_DIR / safe
    (root / "sources").mkdir(parents=True, exist_ok=True)
    touch_client(safe)
    return root


def sources_file(client_id: str) -> Path:
    return client_path(client_id) / "sources.json"


def touch_client(client_id: str) -> None:
    safe = sanitize_client_id(client_id)
    root = CLIENTS_DIR / safe
    root.mkdir(parents=True, exist_ok=True)
    (root / "updated_at").write_text(now_utc().isoformat(), encoding="utf-8")


def load_sources(client_id: str) -> list[SourceMeta]:
    path = sources_file(client_id)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return [SourceMeta(**item) for item in data]


def save_sources(client_id: str, sources: list[SourceMeta]) -> None:
    path = sources_file(client_id)
    with path.open("w", encoding="utf-8") as f:
        json.dump([asdict(item) for item in sources], f, ensure_ascii=False, indent=2)
    touch_client(client_id)


def source_pdf_path(client_id: str, source_id: str) -> Path:
    safe_client = sanitize_client_id(client_id)
    safe_source = re.sub(r"[^A-Z0-9]", "", source_id.strip().upper())
    if len(safe_source) < 6 or len(safe_source) > 24:
        raise ValueError("Invalid source_id")
    return CLIENTS_DIR / safe_client / "sources" / f"{safe_source}.pdf"


def allocate_source_path(client_id: str) -> tuple[str, Path]:
    sources = load_sources(client_id)
    existing = {item.source_id for item in sources}
    source_id = generate_source_id()
    while source_id in existing:
        source_id = generate_source_id()
    return source_id, source_pdf_path(client_id, source_id)


def make_source_meta(source_id: str, original_name: str, size: int, pages: int) -> SourceMeta:
    return SourceMeta(
        source_id=source_id,
        name=original_name,
        filename=f"{source_id}.pdf",
        pages=pages,
        size=size,
        created_at=now_utc().isoformat(),
    )


def add_source(client_id: str, original_name: str, size: int, pages: int) -> tuple[SourceMeta, Path]:
    source_id, path = allocate_source_path(client_id)
    meta = make_source_meta(source_id, original_name, size, pages)
    register_source(client_id, meta)
    return meta, path


def register_source(client_id: str, meta: SourceMeta) -> None:
    sources = [item for item in load_sources(client_id) if item.source_id != meta.source_id]
    sources.append(meta)
    save_sources(client_id, sources)


def remove_source(client_id: str, source_id: str) -> bool:
    sources = load_sources(client_id)
    filtered = [item for item in sources if item.source_id != source_id]
    removed = len(filtered) != len(sources)
    if removed:
        source_pdf_path(client_id, source_id).unlink(missing_ok=True)
        save_sources(client_id, filtered)
    return removed


def clear_sources(client_id: str) -> None:
    root = client_path(client_id)
    shutil.rmtree(root / "sources", ignore_errors=True)
    (root / "sources").mkdir(parents=True, exist_ok=True)
    save_sources(client_id, [])


def cleanup_expired_clients() -> int:
    deleted = 0
    cutoff = now_utc() - timedelta(seconds=CLIENT_EXPIRE_SECONDS)
    for root in CLIENTS_DIR.iterdir() if CLIENTS_DIR.exists() else []:
        if not root.is_dir():
            continue
        marker = root / "updated_at"
        try:
            if not marker.exists() or datetime.fromisoformat(marker.read_text(encoding="utf-8")) < cutoff:
                shutil.rmtree(root, ignore_errors=True)
                deleted += 1
        except Exception:
            shutil.rmtree(root, ignore_errors=True)
            deleted += 1
    return deleted
