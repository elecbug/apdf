from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Request


LOG_DIR = Path(os.getenv("APDF_ACCESS_LOG_DIR", "/app/data/logs"))
LOG_TZ = ZoneInfo(os.getenv("APDF_LOG_TZ", "Asia/Seoul"))


def now_for_log() -> datetime:
    return datetime.now(LOG_TZ)


def get_access_log_path() -> Path:
    today = now_for_log().strftime("%Y-%m-%d")
    return LOG_DIR / f"access-{today}.jsonl"


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    if request.client:
        return request.client.host

    return "unknown"


def get_route_template(request: Request) -> str:
    route = request.scope.get("route")
    route_path = getattr(route, "path", None)

    if route_path:
        return route_path

    return "unmatched"


def get_safe_path_param(key: str, value: Any) -> str:
    value_str = str(value)

    return value_str


def get_filled_route(request: Request) -> str:
    route_template = get_route_template(request)

    if route_template == "unmatched":
        return request.url.path

    filled = route_template

    for key, value in request.path_params.items():
        safe_value = get_safe_path_param(key, value)
        filled = filled.replace("{" + key + "}", safe_value)

    return filled


def get_safe_path_params(request: Request) -> dict[str, Any]:
    params: dict[str, Any] = {}

    for key, value in request.path_params.items():
        params[key] = value

    return params


def write_access_log(request: Request, status_code: int) -> None:
    path = get_access_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    record: dict[str, Any] = {
        "ts": now_for_log().isoformat(),
        "ip": get_client_ip(request),
        "method": request.method,
        "route_template": get_route_template(request),
        "path_params": get_safe_path_params(request),
        "status": status_code,
    }

    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")