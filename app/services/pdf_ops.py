from __future__ import annotations

import io
import json
import secrets
import shutil
from typing import Any
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from pypdf import PdfReader, PdfWriter
from pypdf._page import PageObject
from PIL import Image, ImageOps
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

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


def page_count(path: Path) -> int:
    reader = PdfReader(str(path))

    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise ValueError("Encrypted PDF is not supported") from exc

    return len(reader.pages)


def apply_edit_operations(
    src: Path,
    operations: list[dict[str, Any]],
    image_paths: dict[str, Path],
    out: Path,
) -> None:
    reader = PdfReader(str(src))

    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise ValueError("Encrypted PDF is not supported") from exc

    pages = [page for page in reader.pages]

    for op in operations:
        op_type = op.get("type")

        if op_type == "insert_blank":
            pages = _apply_insert_blank(pages, op)

        elif op_type == "insert_image_page":
            pages = _apply_insert_image_page(pages, op, image_paths)

        elif op_type == "rotate":
            pages = _apply_rotate_pages(pages, op)

        elif op_type == "delete_pages":
            pages = _apply_delete_pages(pages, op)

        else:
            raise ValueError(f"Unsupported edit operation: {op_type}")

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
    if not expr:
        raise ValueError("Page selection is empty")

    selected: list[int] = []

    for part in expr.split(","):
        token = part.strip()

        if not token:
            continue

        if "-" in token:
            start_text, end_text = token.split("-", 1)
            start = int(start_text.strip())
            end = int(end_text.strip())

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
        raise ValueError("No pages selected")

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

    image_width_px, image_height_px = image.size

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