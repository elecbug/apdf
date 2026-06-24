from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile


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
