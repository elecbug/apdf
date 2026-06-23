from __future__ import annotations

import io
import shutil
from pathlib import Path
from typing import Any, Iterable

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

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


A4_SIZE = (595.275590551, 841.88976378)
LETTER_SIZE = (612.0, 792.0)


def _page_size(page) -> tuple[float, float]:
    return float(page.mediabox.width), float(page.mediabox.height)


def _normalize_position(position: str, page_count: int, page_no: int | None) -> int:
    """Return a zero-based insertion index in the current PDF page sequence."""
    normalized = (position or "after").strip().lower()

    if normalized == "end":
        return page_count

    if normalized not in {"before", "after"}:
        raise ValueError("position must be before, after, or end")

    if page_no is None:
        raise ValueError("page is required unless position is end")

    page_no = int(page_no)
    if page_no < 1 or page_no > page_count:
        raise ValueError(f"Page out of range: {page_no}")

    return page_no - 1 if normalized == "before" else page_no


def _reference_page_index(position: str, page_count: int, page_no: int | None) -> int:
    normalized = (position or "after").strip().lower()
    if page_count <= 0:
        raise ValueError("Input PDF has no pages")
    if normalized == "end":
        return page_count - 1
    if page_no is None:
        raise ValueError("page is required unless position is end")
    page_no = int(page_no)
    if page_no < 1 or page_no > page_count:
        raise ValueError(f"Page out of range: {page_no}")
    return page_no - 1


def _blank_page_size(reader: PdfReader, position: str, page_no: int | None, size: str | None) -> tuple[float, float]:
    normalized = (size or "same").strip().lower()

    if normalized == "a4":
        return A4_SIZE
    if normalized == "letter":
        return LETTER_SIZE
    if normalized != "same":
        raise ValueError("blank page size must be same, a4, or letter")

    ref_idx = _reference_page_index(position, len(reader.pages), page_no)
    return _page_size(reader.pages[ref_idx])


def insert_blank_page(
    input_path: Path,
    output_path: Path,
    position: str = "after",
    page_no: int | None = None,
    size: str | None = "same",
) -> None:
    reader = PdfReader(str(input_path))
    page_count_value = len(reader.pages)
    if page_count_value <= 0:
        raise ValueError("Input PDF has no pages")

    insert_at = _normalize_position(position, page_count_value, page_no)
    width, height = _blank_page_size(reader, position, page_no, size)

    writer = PdfWriter()
    for idx, page in enumerate(reader.pages):
        if idx == insert_at:
            writer.add_blank_page(width=width, height=height)
        writer.add_page(page)

    if insert_at == page_count_value:
        writer.add_blank_page(width=width, height=height)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as f:
        writer.write(f)


def _make_image_page_pdf(image_path: Path, page_width: float, page_height: float, fit: str = "fit") -> bytes:
    with Image.open(image_path) as im:
        iw, ih = im.size
        if iw <= 0 or ih <= 0:
            raise ValueError("Invalid image dimensions")

        image_buffer = io.BytesIO()
        if im.mode not in {"RGB", "RGBA"}:
            im = im.convert("RGBA")
        im.save(image_buffer, format="PNG")
        image_buffer.seek(0)

    normalized_fit = (fit or "fit").strip().lower()
    if normalized_fit not in {"fit", "fill", "original"}:
        raise ValueError("image fit mode must be fit, fill, or original")

    if normalized_fit == "original":
        draw_width = float(iw)
        draw_height = float(ih)
    else:
        scale_x = page_width / float(iw)
        scale_y = page_height / float(ih)
        scale = min(scale_x, scale_y) if normalized_fit == "fit" else max(scale_x, scale_y)
        draw_width = float(iw) * scale
        draw_height = float(ih) * scale

    x = (page_width - draw_width) / 2.0
    y = (page_height - draw_height) / 2.0

    packet = io.BytesIO()
    c = canvas.Canvas(packet, pagesize=(page_width, page_height))
    c.drawImage(
        ImageReader(image_buffer),
        x,
        y,
        width=draw_width,
        height=draw_height,
        preserveAspectRatio=False,
        mask="auto",
    )
    c.save()
    packet.seek(0)
    return packet.read()


def insert_image_page(
    input_path: Path,
    image_path: Path,
    output_path: Path,
    position: str = "after",
    page_no: int | None = None,
    fit: str = "fit",
) -> None:
    reader = PdfReader(str(input_path))
    page_count_value = len(reader.pages)
    if page_count_value <= 0:
        raise ValueError("Input PDF has no pages")

    insert_at = _normalize_position(position, page_count_value, page_no)
    ref_idx = _reference_page_index(position, page_count_value, page_no)
    width, height = _page_size(reader.pages[ref_idx])
    image_pdf = PdfReader(io.BytesIO(_make_image_page_pdf(image_path, width, height, fit)))
    image_page = image_pdf.pages[0]

    writer = PdfWriter()
    for idx, page in enumerate(reader.pages):
        if idx == insert_at:
            writer.add_page(image_page)
        writer.add_page(page)

    if insert_at == page_count_value:
        writer.add_page(image_page)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as f:
        writer.write(f)


def apply_edit_operations(
    input_path: Path,
    operations: list[dict[str, Any]],
    image_paths: dict[str, Path],
    output_path: Path,
    work_dir: Path,
) -> None:
    """Apply APDF edit queue operations in order.

    Supported operation types:
    - insert_blank: {type, position, page?, size}
    - insert_image_page: {type, image_id, position, page?, fit}
    - rotate: {type, pages, angle}
    """
    if not isinstance(operations, list):
        raise ValueError("operations must be a list")
    if not operations:
        raise ValueError("operations is empty")

    work_dir.mkdir(parents=True, exist_ok=True)
    current = input_path

    for step, op in enumerate(operations, start=1):
        if not isinstance(op, dict):
            raise ValueError(f"Invalid operation at #{step}")

        op_type = str(op.get("type", "")).strip().lower()
        step_output = work_dir / f"edit_step_{step:03d}.pdf"

        if op_type == "insert_blank":
            position = str(op.get("position", "after"))
            page_value = op.get("page")
            page_no = None if page_value in (None, "") else int(page_value)
            size = str(op.get("size", "same"))
            insert_blank_page(current, step_output, position=position, page_no=page_no, size=size)

        elif op_type == "insert_image_page":
            image_id = str(op.get("image_id", ""))
            if image_id not in image_paths:
                raise ValueError(f"Missing image file for operation #{step}")
            position = str(op.get("position", "after"))
            page_value = op.get("page")
            page_no = None if page_value in (None, "") else int(page_value)
            fit = str(op.get("fit", "fit"))
            insert_image_page(current, image_paths[image_id], step_output, position=position, page_no=page_no, fit=fit)

        elif op_type == "rotate":
            pages = str(op.get("pages", "")).strip()
            angle = int(op.get("angle", 0))
            if not pages:
                raise ValueError(f"Missing pages for rotate operation #{step}")
            rotate_pages(current, pages, angle, step_output)

        else:
            raise ValueError(f"Unsupported operation type at #{step}: {op_type}")

        current = step_output

    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(current, output_path)


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
