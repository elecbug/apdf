from __future__ import annotations

import re
from typing import Any

from app.services.pdf.core import finite_float


def parse_paint(value: Any, opacity: Any, label: str) -> tuple[tuple[float, float, float] | None, float]:
    alpha = finite_float(opacity, f"{label}_opacity")
    if not 0 <= alpha <= 1:
        raise ValueError(f"{label}_opacity must be between 0 and 1")
    if value is None or str(value).strip().lower() == "transparent":
        return None, alpha
    color = str(value).strip()
    if not re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})", color):
        raise ValueError(f"{label}_color must be a hex color or transparent")
    digits = color[1:]
    if len(digits) in {3, 4}:
        digits = "".join(char * 2 for char in digits)
    if len(digits) == 8:
        alpha *= int(digits[6:8], 16) / 255
    return tuple(int(digits[index:index + 2], 16) / 255 for index in (0, 2, 4)), alpha
