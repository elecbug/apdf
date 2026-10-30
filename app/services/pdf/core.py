from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader


def open_pdf(path: Path) -> PdfReader:
    reader = PdfReader(str(path))

    if reader.is_encrypted:
        try:
            decrypted = reader.decrypt("")
        except Exception as exc:
            raise ValueError("Encrypted PDF is not supported") from exc
        if not decrypted:
            raise ValueError("Encrypted PDF is not supported")

    if not reader.pages:
        raise ValueError("Input PDF has no pages")

    return reader


def page_count(path: Path) -> int:
    return len(open_pdf(path).pages)
