from __future__ import annotations

from pathlib import Path

from fastapi.templating import Jinja2Templates

from app.config import ASSEMBLE_RESULT_CODE_ENABLED

APP_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=APP_DIR / "templates")
templates.env.globals["assemble_result_code_enabled"] = ASSEMBLE_RESULT_CODE_ENABLED
