from __future__ import annotations

import io
from pathlib import Path
from typing import Iterable

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from app.config import FONTS_DIR


def parse_pages(spec: str, page_count: int) -> list[int]:
    """Parse 1-based page spec like '1-3,5,7' into 0-based indices."""
    if not spec.strip():
        return list(range(page_count))
    result: list[int] = []
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            start, end = int(start_s), int(end_s)
            if start > end:
                start, end = end, start
            result.extend(range(start - 1, end))
        else:
            result.append(int(part) - 1)
    deduped = []
    for idx in result:
        if idx < 0 or idx >= page_count:
            raise ValueError(f"Page out of range: {idx + 1}")
        if idx not in deduped:
            deduped.append(idx)
    return deduped


def page_count(path: Path) -> int:
    return len(PdfReader(str(path)).pages)


def merge_pdfs(input_paths: Iterable[Path], output_path: Path) -> None:
    writer = PdfWriter()
    for path in input_paths:
        writer.append(str(path))
    with output_path.open("wb") as f:
        writer.write(f)


def extract_pages(input_path: Path, pages_spec: str, output_path: Path) -> None:
    reader = PdfReader(str(input_path))
    writer = PdfWriter()
    for idx in parse_pages(pages_spec, len(reader.pages)):
        writer.add_page(reader.pages[idx])
    with output_path.open("wb") as f:
        writer.write(f)


def delete_pages(input_path: Path, pages_spec: str, output_path: Path) -> None:
    reader = PdfReader(str(input_path))
    delete_set = set(parse_pages(pages_spec, len(reader.pages)))
    writer = PdfWriter()
    for idx, page in enumerate(reader.pages):
        if idx not in delete_set:
            writer.add_page(page)
    with output_path.open("wb") as f:
        writer.write(f)


def rotate_pages(input_path: Path, pages_spec: str, angle: int, output_path: Path) -> None:
    if angle not in {90, 180, 270}:
        raise ValueError("angle must be 90, 180, or 270")
    reader = PdfReader(str(input_path))
    targets = set(parse_pages(pages_spec, len(reader.pages)))
    writer = PdfWriter()
    for idx, page in enumerate(reader.pages):
        if idx in targets:
            page.rotate(angle)
        writer.add_page(page)
    with output_path.open("wb") as f:
        writer.write(f)


def split_ranges(input_path: Path, ranges_text: str, output_dir: Path) -> list[Path]:
    reader = PdfReader(str(input_path))
    outputs: list[Path] = []
    chunks = [x.strip() for x in ranges_text.splitlines() if x.strip()]
    if not chunks:
        chunks = [str(i + 1) for i in range(len(reader.pages))]
    for n, spec in enumerate(chunks, start=1):
        writer = PdfWriter()
        for idx in parse_pages(spec, len(reader.pages)):
            writer.add_page(reader.pages[idx])
        out = output_dir / f"split_{n:03d}.pdf"
        with out.open("wb") as f:
            writer.write(f)
        outputs.append(out)
    return outputs


def _register_font(font_name: str | None = None, font_path: str | None = None) -> str:
    if font_name and font_path:
        pdfmetrics.registerFont(TTFont(font_name, font_path))
        return font_name
    for candidate in [
        FONTS_DIR / "NotoSansKR-Regular.ttf",
        FONTS_DIR / "NotoSansCJKkr-Regular.otf",
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf"),
    ]:
        if candidate.exists():
            name = "APDFKorean"
            pdfmetrics.registerFont(TTFont(name, str(candidate)))
            return name
    return "Helvetica"


def make_text_overlay(page_width: float, page_height: float, text: str, x: float, y_from_top: float,
                      font_size: int = 12, opacity: float = 1.0) -> bytes:
    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=(page_width, page_height))
    font = _register_font()
    c.setFont(font, font_size)
    try:
        c.setFillAlpha(opacity)
    except Exception:
        pass
    y = page_height - y_from_top - font_size
    for line in text.splitlines():
        c.drawString(x, y, line)
        y -= font_size * 1.25
    c.save()
    packet.seek(0)
    return packet.read()


def overlay_text(input_path: Path, output_path: Path, page_no: int, text: str, x: float, y: float,
                 font_size: int = 12, opacity: float = 1.0) -> None:
    reader = PdfReader(str(input_path))
    writer = PdfWriter()
    target = page_no - 1
    for idx, page in enumerate(reader.pages):
        if idx == target:
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            overlay_pdf = PdfReader(io.BytesIO(make_text_overlay(width, height, text, x, y, font_size, opacity)))
            page.merge_page(overlay_pdf.pages[0])
        writer.add_page(page)
    with output_path.open("wb") as f:
        writer.write(f)


def make_image_overlay(page_width: float, page_height: float, image_path: Path, x: float, y_from_top: float,
                       width: float, height: float | None = None, opacity: float = 1.0) -> bytes:
    with Image.open(image_path) as im:
        iw, ih = im.size
    if height is None or height <= 0:
        height = width * ih / iw
    y = page_height - y_from_top - height
    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=(page_width, page_height))
    try:
        c.setFillAlpha(opacity)
    except Exception:
        pass
    c.drawImage(str(image_path), x, y, width=width, height=height, preserveAspectRatio=True, mask="auto")
    c.save()
    packet.seek(0)
    return packet.read()


def overlay_image(input_path: Path, image_path: Path, output_path: Path, page_no: int, x: float, y: float,
                  width: float, height: float | None = None, opacity: float = 1.0) -> None:
    reader = PdfReader(str(input_path))
    writer = PdfWriter()
    target = page_no - 1
    for idx, page in enumerate(reader.pages):
        if idx == target:
            pw = float(page.mediabox.width)
            ph = float(page.mediabox.height)
            overlay_pdf = PdfReader(io.BytesIO(make_image_overlay(pw, ph, image_path, x, y, width, height, opacity)))
            page.merge_page(overlay_pdf.pages[0])
        writer.add_page(page)
    with output_path.open("wb") as f:
        writer.write(f)


def assemble_ranges(input_paths: list[Path], plan: list[dict], output_path: Path) -> None:
    """Assemble a new PDF from source files and 1-based inclusive ranges.

    Each plan item:
    {
        "file_index": 0,
        "start": 1,
        "end": 3 | None
    }
    """
    if not plan:
        raise ValueError("Assembly plan is empty")

    readers = [PdfReader(str(path)) for path in input_paths]
    writer = PdfWriter()

    for position, item in enumerate(plan, start=1):
        try:
            file_index = int(item["file_index"])
            start = int(item.get("start") or 1)
            raw_end = item.get("end")
        except Exception as exc:
            raise ValueError(f"Invalid plan item at #{position}") from exc

        if file_index < 0 or file_index >= len(readers):
            raise ValueError(f"Invalid file index at #{position}: {file_index}")
        reader = readers[file_index]
        total = len(reader.pages)
        end = total if raw_end in (None, "", 0) else int(raw_end)
        if start < 1 or end < 1 or start > end or end > total:
            raise ValueError(
                f"Invalid page range at #{position}: {start}-{end} for source with {total} pages"
            )
        for idx in range(start - 1, end):
            writer.add_page(reader.pages[idx])

    with output_path.open("wb") as f:
        writer.write(f)


def assemble_sources(source_paths: dict[str, Path], plan: list[dict], output_path: Path) -> None:
    """Assemble a new PDF from stored source_id-based ranges.

    Each plan item:
    {
        "source_id": "A8KQ29XZP1",
        "start": 1,
        "end": 3
    }
    """
    if not plan:
        raise ValueError("Assembly plan is empty")

    readers: dict[str, PdfReader] = {}
    writer = PdfWriter()

    for position, item in enumerate(plan, start=1):
        try:
            source_id = str(item["source_id"]).strip().upper()
            start = int(item.get("start") or 1)
            end = int(item.get("end") or 0)
        except Exception as exc:
            raise ValueError(f"Invalid plan item at #{position}") from exc

        if source_id not in source_paths:
            raise ValueError(f"Unknown source_id at #{position}: {source_id}")

        if source_id not in readers:
            readers[source_id] = PdfReader(str(source_paths[source_id]))

        reader = readers[source_id]
        total = len(reader.pages)
        if end <= 0:
            end = total

        if start < 1 or end < 1 or start > end or end > total:
            raise ValueError(
                f"Invalid page range at #{position}: {start}-{end} for source with {total} pages"
            )

        for idx in range(start - 1, end):
            writer.add_page(reader.pages[idx])

    with output_path.open("wb") as f:
        writer.write(f)
