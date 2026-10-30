from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from pypdf import PdfReader


def finite_float(value: Any, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{label} must be numeric") from exc
    if not math.isfinite(result):
        raise ValueError(f"{label} must be finite")
    return result


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
