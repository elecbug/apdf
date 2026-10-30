from __future__ import annotations

import io
import math
from typing import Any

from reportlab.pdfgen import canvas

from app.services.pdf.core import finite_float
from app.services.pdf.paint import parse_paint


SUPPORTED_SHAPES = {"circle", "rectangle", "triangle", "pentagon", "star", "rounded_rectangle"}


def _paint(value: Any, opacity: Any, label: str) -> tuple[tuple[float, float, float] | None, float]:
    return parse_paint(value, opacity, f"overlay_shape {label}")


def make_shape_overlay(page_width: float, page_height: float, op: dict[str, Any]) -> bytes:
    shape = str(op.get("shape", "rectangle")).strip().lower()
    if shape not in SUPPORTED_SHAPES:
        raise ValueError(f"Unsupported shape: {shape}")

    x, y, width, height = (
        finite_float(op.get(key), f"overlay_shape {key}")
        for key in ("x", "y", "width", "height")
    )
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise ValueError("overlay_shape requires non-negative coordinates and positive dimensions")
    if x + width > page_width or y + height > page_height:
        raise ValueError("overlay_shape rectangle out of page bounds")

    fill_color, fill_alpha = _paint(op.get("fill_color", "#2d63c8"), op.get("fill_opacity", 1), "fill")
    stroke_color, stroke_alpha = _paint(op.get("stroke_color", "#183b7a"), op.get("stroke_opacity", 1), "stroke")
    stroke_width = finite_float(op.get("stroke_width", 2), "overlay_shape stroke_width")
    if stroke_width < 0:
        raise ValueError("overlay_shape stroke_width must be non-negative")
    fill = fill_color is not None and fill_alpha > 0
    stroke = stroke_color is not None and stroke_alpha > 0 and stroke_width > 0
    if stroke and stroke_width >= min(width, height):
        raise ValueError("Border width must be smaller than the shape width and height")

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    if fill_color is not None:
        c.setFillColorRGB(*fill_color)
    if stroke_color is not None:
        c.setStrokeColorRGB(*stroke_color)
    c.setFillAlpha(fill_alpha)
    c.setStrokeAlpha(stroke_alpha)
    c.setLineWidth(stroke_width)
    c.setLineJoin(1)

    # Keep the entire stroke inside the selected box, including page edges.
    inset = stroke_width / 2 if stroke else 0
    left, bottom = x + inset, y + inset
    draw_width, draw_height = width - 2 * inset, height - 2 * inset
    if fill or stroke:
        if shape == "rectangle":
            c.rect(left, bottom, draw_width, draw_height, fill=int(fill), stroke=int(stroke))
        elif shape == "rounded_rectangle":
            c.roundRect(left, bottom, draw_width, draw_height, min(draw_width, draw_height) * 0.18, fill=int(fill), stroke=int(stroke))
        elif shape == "circle":
            c.circle(x + width / 2, y + height / 2, min(draw_width, draw_height) / 2, fill=int(fill), stroke=int(stroke))
        else:
            if shape == "triangle":
                points = [(0.5, 1), (0, 0), (1, 0)]
            else:
                count = 10 if shape == "star" else 5
                inner_radius = (3 - math.sqrt(5)) / 2
                vertices = []
                for index in range(count):
                    angle = math.pi / 2 + 2 * math.pi * index / count
                    radius = inner_radius if shape == "star" and index % 2 else 1
                    vertices.append((math.cos(angle) * radius, math.sin(angle) * radius))
                min_x, max_x = min(p[0] for p in vertices), max(p[0] for p in vertices)
                min_y, max_y = min(p[1] for p in vertices), max(p[1] for p in vertices)
                points = [((px - min_x) / (max_x - min_x), (py - min_y) / (max_y - min_y)) for px, py in vertices]
            path = c.beginPath()
            for index, (px, py) in enumerate(points):
                point = (left + px * draw_width, bottom + py * draw_height)
                if index == 0:
                    path.moveTo(*point)
                else:
                    path.lineTo(*point)
            path.close()
            c.drawPath(path, fill=int(fill), stroke=int(stroke))

    c.showPage()
    c.save()
    return buffer.getvalue()
