from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("APDF_DATA_DIR", BASE_DIR / "data"))
JOBS_DIR = DATA_DIR / "jobs"
CLIENTS_DIR = DATA_DIR / "clients"
FONTS_DIR = Path(os.getenv("APDF_FONTS_DIR", BASE_DIR / "fonts"))
LOG_DIR = DATA_DIR / "logs"
AUDIT_LOG_PATH = LOG_DIR / "audit.jsonl"


def read_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name, str(default)).strip().lower()
    if value in {"true", "1", "yes", "on"}:
        return True
    if value in {"false", "0", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


ASSEMBLE_RESULT_CODE_ENABLED = read_bool_env("APDF_ASSEMBLE_RESULT_CODE")
MAX_INLINE_BYTES = int(os.getenv("APDF_MAX_INLINE_BYTES", 10 * 1024 * 1024))
MAX_INLINE_PAGES = int(os.getenv("APDF_MAX_INLINE_PAGES", 200))
JOB_EXPIRE_SECONDS = int(os.getenv("APDF_JOB_EXPIRE_SECONDS", 2 * 60 * 60))
CLIENT_EXPIRE_SECONDS = int(os.getenv("APDF_CLIENT_EXPIRE_SECONDS", 6 * 60 * 60))
CODE_LENGTH = int(os.getenv("APDF_CODE_LENGTH", 8))
CODE_ALPHABET = os.getenv("APDF_CODE_ALPHABET", "ABCDEFGHJKLMNPQRSTUVWXYZ")

JOBS_DIR.mkdir(parents=True, exist_ok=True)
CLIENTS_DIR.mkdir(parents=True, exist_ok=True)
FONTS_DIR.mkdir(parents=True, exist_ok=True)
