from __future__ import annotations

import io
import json
import math
from pathlib import Path
from typing import Any

from reportlab.pdfgen import canvas

from app.services.pdf.core import finite_float
from app.services.pdf.paint import parse_paint
from app.services.pdf.brush_texture import default_texture_seed, texture_paths


# The Edit template also embeds these presets for the live canvas preview.
BRUSH_PRESETS = json.loads(
    (Path(__file__).resolve().parents[2] / "static" / "pen-brush-presets.json").read_text(encoding="utf-8")
)

MAX_STROKES = 200
MAX_STROKE_POINTS = 5000
MAX_DRAWING_POINTS = 30000


def validate_drawing(raw: Any, page_sizes: list[tuple[float, float]]) -> dict[int, list[dict]]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_STROKES:
        raise ValueError(f"Drawing requires 1 to {MAX_STROKES} strokes")
    grouped: dict[int, list[dict]] = {}
    total_points = 0
    for stroke in raw:
        if not isinstance(stroke, dict):
            raise ValueError("Each drawing stroke must be an object")
        page = stroke.get("page")
        if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= len(page_sizes):
            raise ValueError("Drawing page must be an integer within the PDF page range")
        texture = str(stroke.get("texture", "ink"))
        if texture not in BRUSH_PRESETS:
            raise ValueError(f"Unsupported pen texture: {texture}")
        width = finite_float(stroke.get("width", 3), "Pen width")
        if not 0.1 <= width <= 100:
            raise ValueError("Pen width must be between 0.1 and 100 pt")
        color, opacity = parse_paint(stroke.get("color", "#2d63c8"), stroke.get("opacity", 1), "Pen")
        raw_points = stroke.get("points")
        if not isinstance(raw_points, list) or not 1 <= len(raw_points) <= MAX_STROKE_POINTS:
            raise ValueError(f"Each stroke requires 1 to {MAX_STROKE_POINTS} points")
        total_points += len(raw_points)
        if total_points > MAX_DRAWING_POINTS:
            raise ValueError("Drawing has too many points; apply smaller batches")
        page_width, page_height = page_sizes[page - 1]
        points = []
        for point in raw_points:
            if not isinstance(point, (list, tuple)) or len(point) != 2:
                raise ValueError("Each pen point must contain X and Y")
            x, y = finite_float(point[0], "Pen X"), finite_float(point[1], "Pen Y")
            if not 0 <= x <= page_width or not 0 <= y <= page_height:
                raise ValueError("Pen point out of visible page bounds")
            if not points or points[-1] != (x, y):
                points.append((x, y))
        seed = stroke.get("seed")
        if seed is None:
            seed = default_texture_seed(points, page)
        if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 0xFFFFFFFF:
            raise ValueError("Pen texture seed must be an unsigned 32-bit integer")
        grouped.setdefault(page, []).append({
            "texture": texture, "width": width, "color": color, "opacity": opacity, "points": points,
            "seed": seed,
        })
    return grouped


def offset_points(points: list[tuple[float, float]], offset: float) -> list[tuple[float, float]]:
    result = []
    for index, (x, y) in enumerate(points):
        previous = points[max(0, index - 1)]
        following = points[min(len(points) - 1, index + 1)]
        dx, dy = following[0] - previous[0], following[1] - previous[1]
        length = math.hypot(dx, dy)
        nx, ny = (-dy / length, dx / length) if length > 1e-9 else (0, 1)
        result.append((x + nx * offset, y + ny * offset))
    return result


def make_drawing_overlay(page_width: float, page_height: float, strokes: list[dict]) -> bytes:
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    clip = c.beginPath()
    clip.rect(0, 0, page_width, page_height)
    c.clipPath(clip, stroke=0, fill=0)
    c.setLineJoin(1)
    for stroke in strokes:
        if stroke["color"] is None or stroke["opacity"] == 0:
            continue
        c.setStrokeColorRGB(*stroke["color"])
        c.setFillColorRGB(*stroke["color"])
        preset = BRUSH_PRESETS[stroke["texture"]]
        c.setLineCap({"butt": 0, "round": 1, "square": 2}[preset["cap"]])
        if "surface" in preset:
            c.setDash([])
            for group in texture_paths(stroke["points"], stroke["width"], preset["surface"], stroke["seed"]):
                c.setLineWidth(group["width"])
                c.setStrokeAlpha(stroke["opacity"] * group["alpha"])
                c.setFillAlpha(stroke["opacity"] * group["alpha"])
                path = c.beginPath()
                has_lines = False
                for points in group["paths"]:
                    if len(points) == 1:
                        c.circle(*points[0], group["width"] / 2, stroke=0, fill=1)
                    else:
                        has_lines = True
                        path.moveTo(*points[0])
                        for point in points[1:]:
                            path.lineTo(*point)
                if has_lines:
                    c.drawPath(path, stroke=1, fill=0)
            continue
        for layer in preset["layers"]:
            width = stroke["width"] * layer["width"]
            c.setLineWidth(width)
            c.setStrokeAlpha(stroke["opacity"] * layer["alpha"])
            c.setFillAlpha(stroke["opacity"] * layer["alpha"])
            c.setDash([v * stroke["width"] for v in layer["dash"]], layer["phase"] * stroke["width"])
            points = offset_points(stroke["points"], layer["offset"] * stroke["width"])
            if len(points) == 1:
                x, y = points[0]
                if preset["cap"] == "butt":
                    c.rect(x - width / 2, y - width / 2, width, width, stroke=0, fill=1)
                else:
                    c.circle(x, y, width / 2, stroke=0, fill=1)
            else:
                path = c.beginPath()
                path.moveTo(*points[0])
                for point in points[1:]:
                    path.lineTo(*point)
                c.drawPath(path, stroke=1, fill=0)
    c.showPage()
    c.save()
    return buffer.getvalue()
