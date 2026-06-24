#!/usr/bin/env python3
"""
APDF endpoint smoke/contract checker for the split Python routing model.

Run this while APDF is already running, for example:

    python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf test.pdf

The checker intentionally uses only the Python standard library so that it can run
inside the APDF project without adding a test dependency such as requests/httpx.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any, Callable

PDF_MIME = "application/pdf"
PNG_MIME = "image/png"

# A tiny 1x1 transparent PNG, enough for upload/embedding smoke tests.
SMOKE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)

REMOVED_LEGACY_ENDPOINTS = [
    "/merge",
    "/extract",
    "/delete",
    "/rotate",
    "/split",
    "/overlay/text",
    "/overlay/image",
]


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        return None


@dataclass
class HttpResponse:
    status: int
    headers: dict[str, str]
    body: bytes
    url: str

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.text)


@dataclass
class StepResult:
    name: str
    ok: bool
    elapsed_ms: float
    detail: str = ""


@dataclass
class EditResult:
    code: str
    download_url: str
    original_pages: int | None
    edited_pages: int | None
    message: str


class APDFClient:
    def __init__(self, base_url: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout = timeout
        self.opener = urllib.request.build_opener(NoRedirectHandler)

    def url(self, path: str) -> str:
        return urllib.parse.urljoin(self.base_url, path.lstrip("/"))

    def request(
        self,
        method: str,
        path: str,
        *,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> HttpResponse:
        req = urllib.request.Request(
            self.url(path),
            data=data,
            headers={"User-Agent": "apdf-smoke-check/2.0", **(headers or {})},
            method=method.upper(),
        )

        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                return HttpResponse(
                    status=response.status,
                    headers={k.lower(): v for k, v in response.headers.items()},
                    body=response.read(),
                    url=response.geturl(),
                )
        except urllib.error.HTTPError as exc:
            return HttpResponse(
                status=exc.code,
                headers={k.lower(): v for k, v in exc.headers.items()},
                body=exc.read(),
                url=exc.geturl(),
            )

    def get(self, path: str) -> HttpResponse:
        return self.request("GET", path)

    def delete(self, path: str) -> HttpResponse:
        return self.request("DELETE", path)

    def post_json(self, path: str, payload: Any) -> HttpResponse:
        data = json.dumps(payload).encode("utf-8")
        return self.request(
            "POST",
            path,
            data=data,
            headers={"Content-Type": "application/json"},
        )

    def post_form(self, path: str, fields: dict[str, str]) -> HttpResponse:
        data = urllib.parse.urlencode(fields).encode("utf-8")
        return self.request(
            "POST",
            path,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def post_multipart(
        self,
        path: str,
        *,
        fields: dict[str, str] | None = None,
        files: list[tuple[str, str, str, bytes]] | None = None,
    ) -> HttpResponse:
        body, content_type = build_multipart(fields or {}, files or [])
        return self.request(
            "POST",
            path,
            data=body,
            headers={"Content-Type": content_type},
        )


def build_multipart(
    fields: dict[str, str],
    files: list[tuple[str, str, str, bytes]],
) -> tuple[bytes, str]:
    boundary = f"----apdf-smoke-{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    def add_line(line: str = "") -> None:
        chunks.append(line.encode("utf-8") + b"\r\n")

    for name, value in fields.items():
        add_line(f"--{boundary}")
        add_line(f'Content-Disposition: form-data; name="{name}"')
        add_line()
        chunks.append(value.encode("utf-8"))
        chunks.append(b"\r\n")

    for field_name, filename, content_type, content in files:
        safe_filename = filename.replace('"', "_")
        add_line(f"--{boundary}")
        add_line(
            f'Content-Disposition: form-data; name="{field_name}"; filename="{safe_filename}"'
        )
        add_line(f"Content-Type: {content_type}")
        add_line()
        chunks.append(content)
        chunks.append(b"\r\n")

    add_line(f"--{boundary}--")
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def assert_status(response: HttpResponse, allowed: set[int], label: str) -> None:
    if response.status not in allowed:
        snippet = response.text[:600].replace("\n", " ")
        raise AssertionError(
            f"{label}: expected {sorted(allowed)}, got {response.status}. Body: {snippet}"
        )


def assert_json_ok(response: HttpResponse, label: str) -> Any:
    assert_status(response, {200}, label)
    try:
        data = response.json()
    except Exception as exc:
        raise AssertionError(f"{label}: response is not valid JSON") from exc
    return data


def assert_pdf_response(response: HttpResponse, label: str) -> None:
    assert_status(response, {200}, label)
    if not response.body.startswith(b"%PDF-"):
        snippet = response.body[:40]
        raise AssertionError(f"{label}: response is not a PDF. Header={snippet!r}")


def parse_job_status(html: str) -> str | None:
    match = re.search(r"Status:\s*<strong>\s*([^<]+?)\s*</strong>", html, flags=re.I)
    if match:
        return unescape(match.group(1)).strip().lower()
    return None


def parse_job_message(html: str) -> str:
    match = re.search(r"Message:\s*([^<]+)\s*</p>", html, flags=re.I)
    if match:
        return unescape(match.group(1)).strip()
    return ""


def parse_page_transition(message: str) -> tuple[int | None, int | None]:
    match = re.search(r"Pages:\s*(\d+)\s*->\s*(\d+)", message)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def parse_download_links(html: str, code: str) -> list[str]:
    pattern = rf'href="(/download/{re.escape(code)}/[^"]+)"'
    return re.findall(pattern, html)


class SmokeRunner:
    def __init__(
        self,
        client: APDFClient,
        pdf_path: Path,
        *,
        expect_legacy_removed: bool = False,
        keep_jobs: bool = False,
        fail_fast: bool = False,
    ):
        self.client = client
        self.pdf_path = pdf_path
        self.expect_legacy_removed = expect_legacy_removed
        self.keep_jobs = keep_jobs
        self.fail_fast = fail_fast
        self.results: list[StepResult] = []
        self.client_id = f"smoke-{uuid.uuid4().hex}"
        self.pdf_bytes = pdf_path.read_bytes()
        self.pdf_filename = pdf_path.name or "test.pdf"
        self.source_id: str | None = None
        self.page_count: int = 1

    def step(self, name: str, func: Callable[[], str | None]) -> None:
        start = time.perf_counter()
        try:
            detail = func() or ""
            self.results.append(StepResult(name, True, (time.perf_counter() - start) * 1000, detail))
            print(f"[PASS] {name}{': ' + detail if detail else ''}")
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            detail = f"{exc.__class__.__name__}: {exc}"
            self.results.append(StepResult(name, False, elapsed, detail))
            print(f"[FAIL] {name}: {detail}")
            if self.fail_fast:
                raise

    def run(self) -> int:
        if not self.pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {self.pdf_path}")
        if not self.pdf_bytes.startswith(b"%PDF-"):
            raise ValueError(f"Input file does not look like a PDF: {self.pdf_path}")

        self.step("GET / redirect", self.check_root_redirect)
        self.step("GET /assemble", lambda: self.check_html_page("/assemble"))
        self.step("GET /edit", lambda: self.check_html_page("/edit"))

        self.step("source API: empty list", self.check_source_empty_list)
        self.step("source API: upload PDF", self.check_source_upload)
        self.step("source API: list uploaded PDF", self.check_source_uploaded_list)
        self.step("POST /compose + GET job/download", self.check_compose)
        self.step("POST /lookup", self.check_lookup)
        self.step("source API: delete one source", self.check_source_delete_one)
        self.step("source API: clear sources", self.check_source_clear_all)

        self.step("POST /edit/apply insert_blank", self.check_edit_insert_blank)
        self.step("POST /edit/apply insert_image_page", self.check_edit_insert_image_page)
        self.step("POST /edit/apply rotate", self.check_edit_rotate)
        self.step("POST /edit/apply delete_pages", self.check_edit_delete_pages)
        self.step("POST /edit/apply combined queue", self.check_edit_combined_queue)

        if self.expect_legacy_removed:
            self.step("legacy endpoints removed", self.check_legacy_removed)

        self.print_summary()
        return 0 if all(result.ok for result in self.results) else 1

    def check_root_redirect(self) -> str:
        response = self.client.get("/")
        assert_status(response, {303, 307, 308}, "GET /")
        location = response.headers.get("location", "")
        if "/assemble" not in location:
            raise AssertionError(f"GET /: expected redirect to /assemble, got {location!r}")
        return location

    def check_html_page(self, path: str) -> str:
        response = self.client.get(path)
        assert_status(response, {200}, f"GET {path}")
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type:
            raise AssertionError(f"GET {path}: expected text/html, got {content_type!r}")
        if "APDF" not in response.text:
            raise AssertionError(f"GET {path}: APDF marker was not found")
        return f"{len(response.body)} bytes"

    def check_source_empty_list(self) -> str:
        data = assert_json_ok(
            self.client.get(f"/api/clients/{urllib.parse.quote(self.client_id)}/sources"),
            "GET sources",
        )
        if not isinstance(data.get("sources"), list):
            raise AssertionError("GET sources: response.sources is not a list")
        return f"{len(data['sources'])} source(s)"

    def check_source_upload(self) -> str:
        response = self.client.post_multipart(
            f"/api/clients/{urllib.parse.quote(self.client_id)}/sources",
            files=[("files", self.pdf_filename, PDF_MIME, self.pdf_bytes)],
        )
        data = assert_json_ok(response, "POST sources")
        sources = data.get("sources")
        if not isinstance(sources, list) or len(sources) != 1:
            raise AssertionError(f"POST sources: expected one uploaded source, got {sources!r}")
        source = sources[0]
        self.source_id = str(source.get("source_id", "")).strip().upper()
        self.page_count = int(source.get("pages", 0))
        if not self.source_id:
            raise AssertionError("POST sources: missing source_id")
        if self.page_count < 1:
            raise AssertionError(f"POST sources: invalid page count {self.page_count}")
        return f"source_id={self.source_id}, pages={self.page_count}"

    def check_source_uploaded_list(self) -> str:
        if not self.source_id:
            raise AssertionError("source_id is not available")
        data = assert_json_ok(
            self.client.get(f"/api/clients/{urllib.parse.quote(self.client_id)}/sources"),
            "GET sources after upload",
        )
        sources = data.get("sources")
        if not isinstance(sources, list):
            raise AssertionError("GET sources after upload: sources is not a list")
        ids = {str(item.get("source_id", "")).upper() for item in sources if isinstance(item, dict)}
        if self.source_id not in ids:
            raise AssertionError(f"GET sources after upload: {self.source_id} not found in {ids}")
        return f"{len(sources)} source(s)"

    def check_compose(self) -> str:
        if not self.source_id:
            raise AssertionError("source_id is not available")
        end_page = min(2, self.page_count)
        payload = {
            "client_id": self.client_id,
            "plan": [{"source_id": self.source_id, "start": 1, "end": end_page}],
        }
        data = assert_json_ok(self.client.post_json("/compose", payload), "POST /compose")
        if data.get("ok") is not True:
            raise AssertionError(f"POST /compose: ok is not true: {data!r}")
        code = str(data.get("code", "")).upper()
        if not code:
            raise AssertionError(f"POST /compose: missing code: {data!r}")
        self.assert_job_done_and_download(code, "assembled.pdf")
        self.delete_job(code)
        return f"code={code}, pages=1-{end_page}"

    def check_lookup(self) -> str:
        if not self.source_id:
            self.check_source_upload()
        payload = {
            "client_id": self.client_id,
            "plan": [{"source_id": self.source_id, "start": 1, "end": 1}],
        }
        data = assert_json_ok(self.client.post_json("/compose", payload), "POST /compose for lookup")
        code = str(data.get("code", "")).upper()
        response = self.client.post_form("/lookup", {"code": code.lower()})
        assert_status(response, {303, 307, 308}, "POST /lookup")
        location = response.headers.get("location", "")
        if f"/job/{code}" not in location:
            raise AssertionError(f"POST /lookup: expected /job/{code}, got {location!r}")
        self.delete_job(code)
        return f"/job/{code}"

    def check_source_delete_one(self) -> str:
        if not self.source_id:
            raise AssertionError("source_id is not available")
        response = self.client.delete(
            f"/api/clients/{urllib.parse.quote(self.client_id)}/sources/{urllib.parse.quote(self.source_id)}"
        )
        data = assert_json_ok(response, "DELETE source")
        if data.get("ok") is not True:
            raise AssertionError(f"DELETE source: ok is not true: {data!r}")
        old_source_id = self.source_id
        self.source_id = None
        return f"deleted {old_source_id}"

    def check_source_clear_all(self) -> str:
        response = self.client.delete(f"/api/clients/{urllib.parse.quote(self.client_id)}/sources")
        data = assert_json_ok(response, "DELETE sources")
        if data.get("ok") is not True:
            raise AssertionError(f"DELETE sources: ok is not true: {data!r}")
        return "cleared"

    def check_edit_insert_blank(self) -> str:
        result = self.apply_edit(
            [{"type": "insert_blank", "position": "after", "page": 1, "size": "same"}],
            expected_delta=1,
        )
        return self.format_edit_result(result)

    def check_edit_insert_image_page(self) -> str:
        image_id = "smoke_image"
        result = self.apply_edit(
            [{"type": "insert_image_page", "image_id": image_id, "position": "end", "fit": "fit"}],
            files=[(image_id, "smoke.png", PNG_MIME, SMOKE_PNG)],
            expected_delta=1,
        )
        return self.format_edit_result(result)

    def check_edit_rotate(self) -> str:
        result = self.apply_edit(
            [{"type": "rotate", "pages": "1", "angle": 90}],
            expected_delta=0,
        )
        return self.format_edit_result(result)

    def check_edit_delete_pages(self) -> str:
        if self.page_count <= 1:
            return "skipped: input PDF has only one page"
        result = self.apply_edit(
            [{"type": "delete_pages", "pages": str(self.page_count)}],
            expected_delta=-1,
        )
        return self.format_edit_result(result)

    def check_edit_combined_queue(self) -> str:
        if self.page_count <= 1:
            return "skipped: input PDF has only one page"

        image_id = "combo_image"
        operations = [
            {"type": "insert_blank", "position": "after", "page": 1, "size": "same"},
            {"type": "insert_image_page", "image_id": image_id, "position": "end", "fit": "fit"},
            {"type": "rotate", "pages": "1,3", "angle": 180},
            {"type": "delete_pages", "pages": "2"},
        ]
        # +1 blank, +1 image, -1 delete => net +1.
        result = self.apply_edit(
            operations,
            files=[(image_id, "combo.png", PNG_MIME, SMOKE_PNG)],
            expected_delta=1,
        )
        return self.format_edit_result(result)

    def apply_edit(
        self,
        operations: list[dict[str, Any]],
        *,
        files: list[tuple[str, str, str, bytes]] | None = None,
        expected_delta: int | None = None,
    ) -> EditResult:
        multipart_files = [("pdf", self.pdf_filename, PDF_MIME, self.pdf_bytes)]
        multipart_files.extend(files or [])

        response = self.client.post_multipart(
            "/edit/apply",
            fields={"operations": json.dumps(operations)},
            files=multipart_files,
        )
        data = assert_json_ok(response, "POST /edit/apply")
        if data.get("ok") is not True:
            raise AssertionError(f"POST /edit/apply: ok is not true: {data!r}")

        code = str(data.get("code", "")).upper()
        download_url = data.get("download_url")
        if not code:
            raise AssertionError(f"POST /edit/apply: missing code: {data!r}")
        if not isinstance(download_url, str) or not download_url:
            raise AssertionError(f"POST /edit/apply: missing download_url: {data!r}")

        assert_pdf_response(self.client.get(download_url), "download edited PDF")
        job_info = self.assert_job_done_and_download(code, "edited.pdf")
        message = job_info["message"]
        original_pages, edited_pages = parse_page_transition(message)

        if expected_delta is not None and original_pages is not None and edited_pages is not None:
            expected_pages = original_pages + expected_delta
            if edited_pages != expected_pages:
                raise AssertionError(
                    f"edit page count mismatch: expected {original_pages} -> {expected_pages}, "
                    f"got {original_pages} -> {edited_pages}. Message: {message!r}"
                )

        self.delete_job(code)
        return EditResult(
            code=code,
            download_url=str(download_url),
            original_pages=original_pages,
            edited_pages=edited_pages,
            message=message,
        )

    def format_edit_result(self, result: EditResult) -> str:
        if result.original_pages is not None and result.edited_pages is not None:
            return f"code={result.code}, pages={result.original_pages}->{result.edited_pages}"
        return f"code={result.code}, download_url={result.download_url}"

    def check_legacy_removed(self) -> str:
        statuses: dict[str, int] = {}
        for path in REMOVED_LEGACY_ENDPOINTS:
            response = self.client.post_multipart(path)
            statuses[path] = response.status
            if response.status != 404:
                snippet = response.text[:300].replace("\n", " ")
                raise AssertionError(
                    f"{path}: expected 404 after legacy route removal, got {response.status}. Body: {snippet}"
                )
        return ", ".join(f"{path}=404" for path in statuses)

    def assert_job_done_and_download(self, code: str, expected_filename: str | None) -> dict[str, Any]:
        job_response = self.client.get(f"/job/{urllib.parse.quote(code)}")
        assert_status(job_response, {200}, f"GET /job/{code}")
        html = job_response.text
        status = parse_job_status(html)
        if status != "done":
            message = parse_job_message(html)
            snippet = html[:700].replace("\n", " ")
            raise AssertionError(
                f"job {code}: expected status=done, got {status!r}. "
                f"Message: {message!r}. HTML: {snippet}"
            )

        if expected_filename:
            download_path = f"/download/{urllib.parse.quote(code)}/{urllib.parse.quote(expected_filename)}"
            assert_pdf_response(self.client.get(download_path), f"GET {download_path}")
            links = [download_path]
        else:
            links = parse_download_links(html, code)
            if not links:
                raise AssertionError(f"job {code}: no download links found")
            for link in links:
                assert_pdf_response(self.client.get(link), f"GET {link}")

        return {
            "status": status,
            "message": parse_job_message(html),
            "downloads": links,
        }

    def delete_job(self, code: str) -> None:
        if self.keep_jobs:
            return
        response = self.client.request("POST", f"/delete-job/{urllib.parse.quote(code)}")
        assert_status(response, {303, 307, 308}, f"POST /delete-job/{code}")

    def print_summary(self) -> None:
        passed = sum(1 for result in self.results if result.ok)
        failed = len(self.results) - passed
        print("\n=== APDF smoke check summary ===")
        for result in self.results:
            mark = "PASS" if result.ok else "FAIL"
            print(
                f"{mark:4} {result.elapsed_ms:8.1f} ms  {result.name} "
                f"{('- ' + result.detail) if result.detail else ''}"
            )
        print(f"\nTotal: {len(self.results)}, Passed: {passed}, Failed: {failed}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="APDF endpoint smoke/contract checker")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="APDF server base URL")
    parser.add_argument("--pdf", default="test.pdf", help="Path to a small test PDF")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds")
    parser.add_argument(
        "--expect-legacy-removed",
        action="store_true",
        help="Also verify old standalone form endpoints return 404",
    )
    parser.add_argument("--keep-jobs", action="store_true", help="Do not call /delete-job for generated jobs")
    parser.add_argument("--fail-fast", action="store_true", help="Stop on the first failed step")
    parser.add_argument("--debug", action="store_true", help="Print traceback on unexpected crash")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    client = APDFClient(args.base_url, timeout=args.timeout)
    runner = SmokeRunner(
        client,
        Path(args.pdf),
        expect_legacy_removed=args.expect_legacy_removed,
        keep_jobs=args.keep_jobs,
        fail_fast=args.fail_fast,
    )
    return runner.run()


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception:
        if "--debug" in sys.argv:
            traceback.print_exc()
        else:
            print("Fatal error. Re-run with --debug for a traceback.", file=sys.stderr)
        raise SystemExit(2)
