from __future__ import annotations

import io
import math
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from pypdf._page import PageObject
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from app.config import FONTS_DIR
from app.services.pdf.core import open_pdf


SUPPORTED_EDIT_OPERATION_TYPES = {
    "insert_blank",
    "insert_image_page",
    "append_pdf",
    "rotate",
    "page_numbers",
    "delete_pages",
    "move_pages",
    "overlay_text",
    "overlay_image",
}


def apply_edit_operations(
    src: Path,
    operations: list[dict[str, Any]],
    image_paths: dict[str, Path],
    out: Path,
    append_pdf_paths: dict[str, Path] | None = None,
) -> None:
    reader = open_pdf(src)
    pages = [page for page in reader.pages]
    append_pdf_paths = append_pdf_paths or {}

    for index, op in enumerate(operations, start=1):
        if not isinstance(op, dict):
            raise ValueError(f"Invalid edit operation at #{index}")

        op_type = str(op.get("type", "")).strip().lower()

        if op_type == "insert_blank":
            pages = _apply_insert_blank(pages, op)

        elif op_type == "insert_image_page":
            pages = _apply_insert_image_page(pages, op, image_paths)

        elif op_type == "append_pdf":
            pages = _apply_append_pdf(pages, op, append_pdf_paths)

        elif op_type == "rotate":
            pages = _apply_rotate_pages(pages, op)

        elif op_type == "page_numbers":
            pages = _apply_page_numbers(pages, op)

        elif op_type == "delete_pages":
            pages = _apply_delete_pages(pages, op)

        elif op_type == "move_pages":
            pages = _apply_move_pages(pages, op)

        elif op_type == "overlay_text":
            pages = _apply_overlay_text(pages, op)

        elif op_type == "overlay_image":
            pages = _apply_overlay_image(pages, op, image_paths)

        else:
            raise ValueError(f"Unsupported edit operation at #{index}: {op_type}")

    writer = PdfWriter()

    for page in pages:
        writer.add_page(page)

    out.parent.mkdir(parents=True, exist_ok=True)

    with out.open("wb") as f:
        writer.write(f)


def _apply_insert_blank(
    pages: list[PageObject],
    op: dict[str, Any],
) -> list[PageObject]:
    position = str(op.get("position", "after"))
    size = str(op.get("size", "same"))

    insert_index = _resolve_insert_index(pages, op, position)
    width, height = _resolve_blank_page_size(pages, op, position, size)

    blank_page = PageObject.create_blank_page(
        width=width,
        height=height,
    )

    new_pages = list(pages)
    new_pages.insert(insert_index, blank_page)

    return new_pages


def _apply_insert_image_page(
    pages: list[PageObject],
    op: dict[str, Any],
    image_paths: dict[str, Path],
) -> list[PageObject]:
    image_id = op.get("image_id")

    if not image_id:
        raise ValueError("insert_image_page requires image_id")

    image_path = image_paths.get(str(image_id))

    if not image_path:
        raise ValueError(f"Image file not found for image_id: {image_id}")

    position = str(op.get("position", "after"))
    fit = str(op.get("fit", "fit"))

    insert_index = _resolve_insert_index(pages, op, position)
    width, height = _resolve_reference_page_size(pages, op, position)

    image_page = _make_image_pdf_page(
        image_path=image_path,
        page_width=width,
        page_height=height,
        fit=fit,
    )

    new_pages = list(pages)
    new_pages.insert(insert_index, image_page)

    return new_pages


def _apply_append_pdf(
    pages: list[PageObject],
    op: dict[str, Any],
    append_pdf_paths: dict[str, Path],
) -> list[PageObject]:
    pdf_id = op.get("pdf_id")

    if not pdf_id:
        raise ValueError("append_pdf requires pdf_id")

    pdf_path = append_pdf_paths.get(str(pdf_id))

    if not pdf_path:
        raise ValueError(f"PDF file not found for pdf_id: {pdf_id}")

    position = str(op.get("position", "after"))
    insert_index = _resolve_insert_index(pages, op, position)
    append_reader = open_pdf(pdf_path)
    append_pages = [page for page in append_reader.pages]

    if not append_pages:
        raise ValueError("append_pdf input has no pages")

    new_pages = list(pages)
    new_pages[insert_index:insert_index] = append_pages

    return new_pages


def _apply_rotate_pages(
    pages: list[PageObject],
    op: dict[str, Any],
) -> list[PageObject]:
    pages_expr = str(op.get("pages", "")).strip()
    angle = int(op.get("angle", 90))

    if angle not in {90, 180, 270, -90, -180, -270}:
        raise ValueError("Rotate angle must be one of 90, 180, 270")

    target_indexes = _parse_page_selection(pages_expr, len(pages))
    new_pages = list(pages)

    for index in target_indexes:
        new_pages[index].rotate(angle)

    return new_pages


def _apply_page_numbers(
    pages: list[PageObject],
    op: dict[str, Any],
) -> list[PageObject]:
    if not pages:
        raise ValueError("Input PDF has no pages")

    try:
        start_page = int(op.get("start_page", 1))
    except Exception as exc:
        raise ValueError("page_numbers start_page must be an integer") from exc

    if start_page < 1 or start_page > len(pages):
        raise ValueError(f"page_numbers start_page out of range: {start_page}")

    try:
        start_number = int(op.get("start_number", 1))
    except Exception as exc:
        raise ValueError("page_numbers start_number must be an integer") from exc

    if start_number < 0:
        raise ValueError("page_numbers start_number must be zero or greater")

    position = _normalize_page_number_position(str(op.get("position", "bottom-center")))
    raw_number_format = op.get("format", "N")
    number_format = "N" if raw_number_format is None or str(raw_number_format) == "" else str(raw_number_format)
    numbering_style = _normalize_numbering_style(str(op.get("numbering_style", "decimal")))

    new_pages = list(pages)

    for page_index in range(start_page - 1, len(new_pages)):
        numbered_page_offset = page_index - (start_page - 1)
        logical_number = start_number + numbered_page_offset
        label = _format_page_number_label(
            value=logical_number,
            number_format=number_format,
            numbering_style=numbering_style,
        )

        page = new_pages[page_index]
        page_width, page_height = _page_size(page)
        resolved_position = _resolve_page_number_position_for_page(
            position=position,
            numbered_page_offset=numbered_page_offset,
        )
        overlay_reader = PdfReader(
            io.BytesIO(
                _make_page_number_overlay_pdf(
                    page_width=page_width,
                    page_height=page_height,
                    label=label,
                    position=resolved_position,
                )
            )
        )
        page.merge_page(overlay_reader.pages[0])

    return new_pages


def _apply_delete_pages(
    pages: list[PageObject],
    op: dict[str, Any],
) -> list[PageObject]:
    pages_expr = str(op.get("pages", "")).strip()

    delete_indexes = set(_parse_page_selection(pages_expr, len(pages)))

    if len(delete_indexes) >= len(pages):
        raise ValueError("Cannot delete all pages")

    return [
        page
        for index, page in enumerate(pages)
        if index not in delete_indexes
    ]


def _apply_move_pages(
    pages: list[PageObject],
    op: dict[str, Any],
) -> list[PageObject]:
    pages_expr = str(op.get("pages", "")).strip()
    position = str(op.get("position", "after")).strip().lower()

    if position not in {"before", "after", "end"}:
        raise ValueError("Move position must be before, after, or end")

    move_indexes = _parse_page_selection(pages_expr, len(pages))
    move_index_set = set(move_indexes)

    if not move_indexes:
        raise ValueError("No pages selected to move")

    moving_pages = [
        page
        for index, page in enumerate(pages)
        if index in move_index_set
    ]

    remaining_pairs = [
        (index, page)
        for index, page in enumerate(pages)
        if index not in move_index_set
    ]

    if position == "end":
        insert_index = len(remaining_pairs)
    else:
        try:
            target_page = int(op.get("target_page"))
        except Exception as exc:
            raise ValueError("target_page is required unless position is end") from exc

        if target_page < 1 or target_page > len(pages):
            raise ValueError(f"Move target page out of range: {target_page}")

        target_index = target_page - 1

        if target_index in move_index_set:
            raise ValueError("Move target page cannot be one of the moved pages")

        try:
            target_remaining_index = next(
                index
                for index, (original_index, _page) in enumerate(remaining_pairs)
                if original_index == target_index
            )
        except StopIteration as exc:
            raise ValueError(f"Move target page not found: {target_page}") from exc

        insert_index = (
            target_remaining_index
            if position == "before"
            else target_remaining_index + 1
        )

    remaining_pages = [page for _index, page in remaining_pairs]

    return [
        *remaining_pages[:insert_index],
        *moving_pages,
        *remaining_pages[insert_index:],
    ]


def _apply_overlay_text(
    pages: list[PageObject],
    op: dict[str, Any],
) -> list[PageObject]:
    if not pages:
        raise ValueError("Input PDF has no pages")

    page_number = _get_page_number(op, len(pages))
    text = str(op.get("text", ""))

    if not text.strip():
        raise ValueError("overlay_text requires non-empty text")

    try:
        x = float(op.get("x"))
        y = float(op.get("y"))
    except Exception as exc:
        raise ValueError("overlay_text requires numeric x and y") from exc

    if x < 0 or y < 0:
        raise ValueError("overlay_text coordinates must be non-negative")

    try:
        font_size = int(op.get("font_size", 14))
    except Exception as exc:
        raise ValueError("overlay_text font_size must be an integer") from exc

    if font_size < 1 or font_size > 300:
        raise ValueError("overlay_text font_size must be between 1 and 300")

    try:
        opacity = float(op.get("opacity", 1.0))
    except Exception as exc:
        raise ValueError("overlay_text opacity must be numeric") from exc

    if opacity < 0 or opacity > 1:
        raise ValueError("overlay_text opacity must be between 0 and 1")

    color = _normalize_hex_color(str(op.get("color", "#000000")))
    bold = _coerce_bool(op.get("bold", False), "overlay_text bold")
    italic = _coerce_bool(op.get("italic", False), "overlay_text italic")
    underline = _coerce_bool(op.get("underline", False), "overlay_text underline")

    max_width: float | None = None
    raw_max_width = op.get("max_width")
    if raw_max_width is not None and raw_max_width != "":
        try:
            max_width = float(raw_max_width)
        except Exception as exc:
            raise ValueError("overlay_text max_width must be numeric") from exc

        if max_width <= 0:
            raise ValueError("overlay_text max_width must be positive")

    target_index = page_number - 1
    new_pages = list(pages)
    page = new_pages[target_index]
    page_width, page_height = _page_size(page)

    if x > page_width or y > page_height:
        raise ValueError(
            f"overlay_text coordinate out of page bounds: "
            f"x={x}, y={y}, page={page_width}x{page_height}"
        )

    if max_width is not None and x + max_width > page_width:
        raise ValueError(
            f"overlay_text max_width out of page bounds: "
            f"x={x}, max_width={max_width}, page_width={page_width}"
        )

    overlay_reader = PdfReader(
        io.BytesIO(
            _make_text_overlay_pdf(
                page_width=page_width,
                page_height=page_height,
                text=text,
                x=x,
                y=y,
                font_size=font_size,
                opacity=opacity,
                color=color,
                bold=bold,
                italic=italic,
                underline=underline,
                max_width=max_width,
            )
        )
    )
    page.merge_page(overlay_reader.pages[0])

    return new_pages


def _apply_overlay_image(
    pages: list[PageObject],
    op: dict[str, Any],
    image_paths: dict[str, Path],
) -> list[PageObject]:
    if not pages:
        raise ValueError("Input PDF has no pages")

    page_number = _get_page_number(op, len(pages))
    image_id = str(op.get("image_id", ""))

    if not image_id:
        raise ValueError("overlay_image requires image_id")

    image_path = image_paths.get(image_id)
    if not image_path:
        raise ValueError(f"Image file not found for image_id: {image_id}")

    try:
        x = float(op.get("x"))
        y = float(op.get("y"))
    except Exception as exc:
        raise ValueError("overlay_image requires numeric x and y") from exc

    if x < 0 or y < 0:
        raise ValueError("overlay_image coordinates must be non-negative")

    try:
        width = float(op.get("width"))
        height = float(op.get("height"))
    except Exception as exc:
        raise ValueError("overlay_image requires numeric width and height") from exc

    if width <= 0 or height <= 0:
        raise ValueError("overlay_image width and height must be positive")

    try:
        opacity = float(op.get("opacity", 1.0))
    except Exception as exc:
        raise ValueError("overlay_image opacity must be numeric") from exc

    if opacity < 0 or opacity > 1:
        raise ValueError("overlay_image opacity must be between 0 and 1")

    target_index = page_number - 1
    new_pages = list(pages)
    page = new_pages[target_index]
    page_width, page_height = _page_size(page)

    if x > page_width or y > page_height or x + width > page_width or y + height > page_height:
        raise ValueError(
            f"overlay_image rectangle out of page bounds: "
            f"x={x}, y={y}, width={width}, height={height}, page={page_width}x{page_height}"
        )

    overlay_reader = PdfReader(
        io.BytesIO(
            _make_image_overlay_pdf(
                page_width=page_width,
                page_height=page_height,
                image_path=image_path,
                x=x,
                y=y,
                width=width,
                height=height,
                opacity=opacity,
            )
        )
    )
    page.merge_page(overlay_reader.pages[0])

    return new_pages


def _normalize_page_number_position(position: str) -> str:
    normalized = position.strip().lower().replace("_", "-")
    allowed = {
        "top-left",
        "top-center",
        "top-right",
        "top-alternate-left",
        "top-alternate-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
        "bottom-alternate-left",
        "bottom-alternate-right",
    }
    if normalized not in allowed:
        raise ValueError(f"Invalid page number position: {position}")
    return normalized


def _resolve_page_number_position_for_page(position: str, numbered_page_offset: int) -> str:
    if position == "top-alternate-left":
        side = "left" if numbered_page_offset % 2 == 0 else "right"
        return f"top-{side}"

    if position == "top-alternate-right":
        side = "right" if numbered_page_offset % 2 == 0 else "left"
        return f"top-{side}"

    if position == "bottom-alternate-left":
        side = "left" if numbered_page_offset % 2 == 0 else "right"
        return f"bottom-{side}"

    if position == "bottom-alternate-right":
        side = "right" if numbered_page_offset % 2 == 0 else "left"
        return f"bottom-{side}"

    return position


def _normalize_numbering_style(style: str) -> str:
    normalized = style.strip().lower().replace("_", "-")
    aliases = {
        "1": "decimal",
        "1-2-3": "decimal",
        "number": "decimal",
        "numbers": "decimal",
        "numeric": "decimal",
        "decimal": "decimal",
        "a-b-c": "lower-alpha",
        "lower-alpha": "lower-alpha",
        "loweralpha": "lower-alpha",
        "alphabetic-lower": "lower-alpha",
        "a": "lower-alpha",
        "abc": "lower-alpha",
        "upper-alpha": "upper-alpha",
        "upperalpha": "upper-alpha",
        "alphabetic-upper": "upper-alpha",
        "i-ii-iii": "lower-roman",
        "lower-roman": "lower-roman",
        "lowerroman": "lower-roman",
        "roman-lower": "lower-roman",
        "upper-roman": "upper-roman",
        "upperroman": "upper-roman",
        "roman-upper": "upper-roman",
    }
    resolved = aliases.get(normalized)
    if not resolved:
        raise ValueError(f"Invalid page number style: {style}")
    return resolved


def _format_page_number_label(value: int, number_format: str, numbering_style: str) -> str:
    parts: list[str] = []
    i = 0

    while i < len(number_format):
        ch = number_format[i]

        if ch == "\\":
            if i + 1 >= len(number_format):
                parts.append("\\")
                i += 1
                continue

            next_ch = number_format[i + 1]

            if next_ch == "N":
                parts.append("N")
                i += 2
                continue

            if next_ch == "\\":
                parts.append("\\")
                i += 2
                continue

            # Unknown escapes are preserved literally.
            # Example: "\\x" remains "\\x".
            parts.append("\\")
            parts.append(next_ch)
            i += 2
            continue

        if ch == "N":
            j = i
            while j < len(number_format) and number_format[j] == "N":
                j += 1

            width = j - i
            parts.append(_format_page_number_value(value, numbering_style, width))
            i = j
            continue

        parts.append(ch)
        i += 1

    return "".join(parts)


def _format_page_number_value(value: int, numbering_style: str, width: int) -> str:
    if numbering_style == "decimal":
        return str(value).zfill(width) if width > 1 else str(value)

    if value < 1:
        raise ValueError("Alphabetic and Roman page numbers require values >= 1")

    if numbering_style == "upper-alpha":
        return _to_alpha(value, uppercase=True)

    if numbering_style == "lower-alpha":
        return _to_alpha(value, uppercase=False)

    if numbering_style == "upper-roman":
        return _to_roman(value)

    if numbering_style == "lower-roman":
        return _to_roman(value).lower()

    raise ValueError(f"Invalid page number style: {numbering_style}")


def _to_alpha(value: int, *, uppercase: bool) -> str:
    if value < 1:
        raise ValueError("Alphabetic page numbers require values >= 1")

    letters: list[str] = []
    current = value
    while current > 0:
        current -= 1
        letters.append(chr(ord("A") + (current % 26)))
        current //= 26

    result = "".join(reversed(letters))
    return result if uppercase else result.lower()


def _to_roman(value: int) -> str:
    if value < 1 or value > 3999:
        raise ValueError("Roman page numbers require values from 1 to 3999")

    numerals = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ]
    remaining = value
    parts: list[str] = []
    for amount, symbol in numerals:
        while remaining >= amount:
            parts.append(symbol)
            remaining -= amount
    return "".join(parts)


def _normalize_hex_color(value: str) -> tuple[float, float, float]:
    color = value.strip() or "#000000"

    if not color.startswith("#"):
        raise ValueError("overlay_text color must be a hex color such as #000000")

    hex_part = color[1:]

    if len(hex_part) == 3:
        hex_part = "".join(ch * 2 for ch in hex_part)

    if len(hex_part) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in hex_part):
        raise ValueError("overlay_text color must be a hex color such as #000000")

    red = int(hex_part[0:2], 16) / 255
    green = int(hex_part[2:4], 16) / 255
    blue = int(hex_part[4:6], 16) / 255
    return red, green, blue


def _coerce_bool(value: Any, label: str) -> bool:
    if isinstance(value, bool):
        return value

    if value is None:
        return False

    if isinstance(value, (int, float)):
        return bool(value)

    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off", ""}:
        return False

    raise ValueError(f"{label} must be boolean")


def _make_page_number_overlay_pdf(
    page_width: float,
    page_height: float,
    label: str,
    position: str,
) -> bytes:
    margin = 36.0
    font_size = 10
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    font_name = _register_overlay_font()
    c.setFont(font_name, font_size)

    text_width = pdfmetrics.stringWidth(label, font_name, font_size)

    if position.endswith("left"):
        x = margin
    elif position.endswith("center"):
        x = (page_width - text_width) / 2
    else:
        x = page_width - margin - text_width

    if position.startswith("top"):
        y = page_height - margin - font_size
    else:
        y = margin

    c.drawString(x, y, label)
    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer.read()


def _make_text_overlay_pdf(
    page_width: float,
    page_height: float,
    text: str,
    x: float,
    y: float,
    font_size: int,
    opacity: float,
    color: tuple[float, float, float],
    bold: bool = False,
    italic: bool = False,
    underline: bool = False,
    max_width: float | None = None,
) -> bytes:
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    font_name = _register_overlay_font()
    c.setFont(font_name, font_size)
    c.setFillColorRGB(*color)

    try:
        c.setFillAlpha(opacity)
    except Exception:
        pass

    lines = _wrap_text_lines(
        text=text,
        font_name=font_name,
        font_size=font_size,
        max_width=max_width,
    )

    draw_y = y
    for line in lines:
        if line:
            _draw_styled_text_line(
                c,
                line=line,
                x=x,
                y=draw_y,
                font_name=font_name,
                font_size=font_size,
                color=color,
                opacity=opacity,
                bold=bold,
                italic=italic,
                underline=underline,
            )
        draw_y -= font_size * 1.25

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer.read()


def _draw_styled_text_line(
    c: canvas.Canvas,
    *,
    line: str,
    x: float,
    y: float,
    font_name: str,
    font_size: int,
    color: tuple[float, float, float],
    opacity: float,
    bold: bool,
    italic: bool,
    underline: bool,
) -> None:
    bold_offset = max(0.25, font_size * 0.025) if bold else 0.0

    c.saveState()
    c.translate(x, y)

    if italic:
        # Synthetic italic should shear glyphs along the x-axis while keeping
        # the text baseline fixed. canvas.skew(12, 0) changes the y-axis as
        # text advances, which makes the text appear to climb upward.
        shear = math.tan(math.radians(12))
        c.transform(1, 0, shear, 1, 0, 0)

    c.drawString(0, 0, line)

    if bold:
        c.drawString(bold_offset, 0, line)

    c.restoreState()

    if underline:
        text_width = pdfmetrics.stringWidth(line, font_name, font_size) + bold_offset
        underline_y = y - max(1.0, font_size * 0.12)
        line_width = max(0.5, font_size * 0.06)

        c.saveState()
        c.setStrokeColorRGB(*color)
        try:
            c.setStrokeAlpha(opacity)
        except Exception:
            pass
        c.setLineWidth(line_width)
        c.line(x, underline_y, x + text_width, underline_y)
        c.restoreState()


def _wrap_text_lines(
    text: str,
    font_name: str,
    font_size: int,
    max_width: float | None,
) -> list[str]:
    source_lines = text.splitlines() or [""]

    if max_width is None:
        return source_lines

    wrapped: list[str] = []

    for source_line in source_lines:
        wrapped.extend(_wrap_text_line(source_line, font_name, font_size, max_width))

    return wrapped


def _wrap_text_line(
    text: str,
    font_name: str,
    font_size: int,
    max_width: float,
) -> list[str]:
    if not text:
        return [""]

    lines: list[str] = []
    current = ""

    for char in text:
        candidate = current + char

        if not current or pdfmetrics.stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
            continue

        lines.append(current.rstrip())
        current = char.lstrip() if char.isspace() else char

    if current:
        lines.append(current.rstrip())

    return lines or [""]


def _make_image_overlay_pdf(
    page_width: float,
    page_height: float,
    image_path: Path,
    x: float,
    y: float,
    width: float,
    height: float,
    opacity: float,
) -> bytes:
    image = Image.open(image_path)
    image = ImageOps.exif_transpose(image)

    if image.mode in {"P", "LA"}:
        image = image.convert("RGBA")
    elif image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGB")

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(page_width, page_height))

    try:
        c.setFillAlpha(opacity)
        c.setStrokeAlpha(opacity)
    except Exception:
        pass

    c.drawImage(
        ImageReader(image),
        x,
        y,
        width=width,
        height=height,
        preserveAspectRatio=False,
        mask="auto",
    )

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer.read()


def _register_overlay_font() -> str:
    for candidate in [
        FONTS_DIR / "NotoSansKR-Regular.ttf",
        FONTS_DIR / "NotoSansCJKkr-Regular.otf",
        FONTS_DIR / "NotoSansCJK-Regular.ttc",
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansKR-Regular.otf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    ]:
        if candidate.exists():
            font_name = "APDFOverlayFont"
            try:
                pdfmetrics.registerFont(TTFont(font_name, str(candidate)))
                return font_name
            except Exception:
                continue

    return "Helvetica"


def _resolve_insert_index(
    pages: list[PageObject],
    op: dict[str, Any],
    position: str,
) -> int:
    if position == "end":
        return len(pages)

    if not pages:
        return 0

    page_number = _get_page_number(op, len(pages))

    if position == "before":
        return page_number - 1

    if position == "after":
        return page_number

    raise ValueError(f"Invalid insert position: {position}")


def _resolve_blank_page_size(
    pages: list[PageObject],
    op: dict[str, Any],
    position: str,
    size: str,
) -> tuple[float, float]:
    if size == "a4":
        return float(A4[0]), float(A4[1])

    if size == "letter":
        return float(letter[0]), float(letter[1])

    if size == "same":
        return _resolve_reference_page_size(pages, op, position)

    raise ValueError(f"Invalid blank page size: {size}")


def _resolve_reference_page_size(
    pages: list[PageObject],
    op: dict[str, Any],
    position: str,
) -> tuple[float, float]:
    if not pages:
        return float(A4[0]), float(A4[1])

    if position == "end":
        reference_page = pages[-1]
    else:
        page_number = _get_page_number(op, len(pages))
        reference_page = pages[page_number - 1]

    return _page_size(reference_page)


def _page_size(page: PageObject) -> tuple[float, float]:
    return float(page.mediabox.width), float(page.mediabox.height)


def _get_page_number(op: dict[str, Any], total_pages: int) -> int:
    try:
        page_number = int(op.get("page"))
    except Exception as exc:
        raise ValueError("Page number is required") from exc

    if page_number < 1 or page_number > total_pages:
        raise ValueError(f"Page number out of range: {page_number}")

    return page_number


def _parse_page_selection(expr: str, total_pages: int) -> list[int]:
    if total_pages < 1:
        raise ValueError("Input PDF has no pages")

    normalized_expr = str(expr or "").strip().lower()

    if not normalized_expr or normalized_expr == "all":
        return list(range(total_pages))

    selected: list[int] = []

    for part in normalized_expr.split(","):
        token = part.strip()

        if not token:
            continue

        if token == "all":
            selected.extend(range(total_pages))
            continue

        if "-" in token:
            if token.count("-") != 1:
                raise ValueError(f"Invalid page range: {token}")

            start_text, end_text = token.split("-", 1)
            start = 1 if not start_text.strip() else int(start_text.strip())
            end = total_pages if not end_text.strip() else int(end_text.strip())

            if start > end:
                raise ValueError(f"Invalid page range: {token}")

            for page_number in range(start, end + 1):
                _validate_page_number(page_number, total_pages)
                selected.append(page_number - 1)

        else:
            page_number = int(token)
            _validate_page_number(page_number, total_pages)
            selected.append(page_number - 1)

    if not selected:
        return list(range(total_pages))

    return sorted(set(selected))


def _validate_page_number(page_number: int, total_pages: int) -> None:
    if page_number < 1 or page_number > total_pages:
        raise ValueError(f"Page number out of range: {page_number}")


def _make_image_pdf_page(
    image_path: Path,
    page_width: float,
    page_height: float,
    fit: str,
) -> PageObject:
    image = Image.open(image_path)
    image = ImageOps.exif_transpose(image)

    if image.mode in {"RGBA", "LA", "P"}:
        background = Image.new("RGB", image.size, (255, 255, 255))

        if image.mode == "P":
            image = image.convert("RGBA")

        alpha = image.getchannel("A") if "A" in image.getbands() else None
        background.paste(image.convert("RGB"), mask=alpha)
        image = background
    else:
        image = image.convert("RGB")

    draw_width, draw_height = _resolve_image_draw_size(
        image=image,
        page_width=page_width,
        page_height=page_height,
        fit=fit,
    )

    x = (page_width - draw_width) / 2
    y = (page_height - draw_height) / 2

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(page_width, page_height))

    c.drawImage(
        ImageReader(image),
        x,
        y,
        width=draw_width,
        height=draw_height,
        preserveAspectRatio=True,
        mask="auto",
    )

    c.showPage()
    c.save()

    buffer.seek(0)
    image_pdf_reader = PdfReader(buffer)

    return image_pdf_reader.pages[0]


def _resolve_image_draw_size(
    image: Image.Image,
    page_width: float,
    page_height: float,
    fit: str,
) -> tuple[float, float]:
    image_width_px, image_height_px = image.size

    if image_width_px <= 0 or image_height_px <= 0:
        raise ValueError("Invalid image size")

    if fit == "original":
        dpi_x, dpi_y = image.info.get("dpi", (72, 72))

        try:
            dpi_x = float(dpi_x)
            dpi_y = float(dpi_y)
        except Exception:
            dpi_x = 72
            dpi_y = 72

        if dpi_x <= 0:
            dpi_x = 72

        if dpi_y <= 0:
            dpi_y = 72

        width = image_width_px / dpi_x * 72
        height = image_height_px / dpi_y * 72

        return width, height

    scale_x = page_width / image_width_px
    scale_y = page_height / image_height_px

    if fit == "fit":
        scale = min(scale_x, scale_y)
    elif fit == "fill":
        scale = max(scale_x, scale_y)
    else:
        raise ValueError(f"Invalid image fit mode: {fit}")

    return image_width_px * scale, image_height_px * scale
