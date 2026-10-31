from __future__ import annotations

import json
from pathlib import Path

from app.services.pdf import apply_edit_operations, assemble_sources, page_count


def run(command: str, payload_json: str, directory: str) -> str:
    """Only virtual, worker-local files enter the shared PDF implementation."""
    payload = json.loads(payload_json)
    root = Path(directory)
    try:
        if command == "count":
            return json.dumps({"ok": True, "pages": page_count(root / "target.pdf")})
        if command == "edit":
            paths = {key: root / filename for key, filename in payload.get("attachments", {}).items()}
            apply_edit_operations(root / "target.pdf", payload["operations"], paths, root / "output.pdf", append_pdf_paths=paths)
        elif command == "compose":
            sources = {key: root / filename for key, filename in payload["sources"].items()}
            assemble_sources(sources, payload["plan"], root / "output.pdf")
        else:
            raise ValueError("Unsupported local PDF operation")
        return json.dumps({"ok": True, "filename": "assembled.pdf" if command == "compose" else "edited.pdf"})
    except Exception as error:
        return json.dumps({"ok": False, "error": str(error)})
