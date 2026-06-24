from __future__ import annotations

from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

from app.services.pdf.core import open_pdf


def assemble_sources(
    source_paths: dict[str, Path],
    plan: list[dict[str, Any]],
    out: Path,
) -> None:
    if not plan:
        raise ValueError("Assembly plan is empty")

    writer = PdfWriter()
    readers: dict[str, PdfReader] = {}

    for item in plan:
        source_id = str(item.get("source_id", "")).strip().upper()

        if not source_id:
            raise ValueError("Missing source_id")

        src = source_paths.get(source_id)

        if src is None:
            raise ValueError(f"Unknown source_id: {source_id}")

        if not src.exists():
            raise ValueError(f"Source PDF does not exist: {source_id}")

        if source_id not in readers:
            try:
                readers[source_id] = open_pdf(src)
            except ValueError as exc:
                raise ValueError(f"Encrypted PDF is not supported: {source_id}") from exc

        reader = readers[source_id]
        total_pages = len(reader.pages)

        try:
            start = int(item.get("start"))
            end = int(item.get("end"))
        except Exception as exc:
            raise ValueError(f"Invalid page range for source_id: {source_id}") from exc

        if start < 1 or end < 1:
            raise ValueError("Page numbers must be 1-based positive integers")

        if start > end:
            raise ValueError(f"Invalid page range: {start}-{end}")

        if end > total_pages:
            raise ValueError(
                f"Page range exceeds source page count: {source_id}, "
                f"requested {start}-{end}, total {total_pages}"
            )

        for page_index in range(start - 1, end):
            writer.add_page(reader.pages[page_index])

    out.parent.mkdir(parents=True, exist_ok=True)

    with out.open("wb") as f:
        writer.write(f)
