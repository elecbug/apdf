#!/usr/bin/env python3
"""
APDF endpoint smoke/contract checker.

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
from pathlib import Path
from typing import Any, Callable

PDF_MIME = "application/pdf"
PNG_MIME = "image/png"

# A tiny 1x1 transparent PNG, enough for upload/embedding smoke tests.
SMOKE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


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
            headers={"User-Agent": "apdf-smoke-check/1.0", **(headers or {})},
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
        snippet = response.text[:400].replace("\n", " ")
        raise AssertionError(f"{label}: expected {sorted(allowed)}, got {response.status}. Body: {snippet}")


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
        snippet = response.body[:20]
        raise AssertionError(f"{label}: response is not a PDF. Header={snippet!r}")


def assert_redirect_to_job(response: HttpResponse, label: str) -> str:
    assert_status(response, {303, 307, 308}, label)
    location = response.headers.get("location", "")
    match = re.search(r"/job/([A-Za-z0-9]+)", location)
    if not match:
        raise AssertionError(f"{label}: redirect location is not /job/<code>: {location!r}")
    return match.group(1).upper()


def parse_job_status(html: str) -> str | None:
    match = re.search(r"Status:\s*<strong>\s*([^<]+?)\s*</strong>", html, flags=re.I)
    if match:
        return match.group(1).strip().lower()
    return None


def parse_download_links(html: str, code: str) -> list[str]:
    pattern = rf'href="(/download/{re.escape(code)}/[^"]+)"'
    return re.findall(pattern, html)


class SmokeRunner:
    def __init__(
        self,
        client: APDFClient,
        pdf_path: Path,
        *,
        skip_legacy: bool = False,
        keep_jobs: bool = False,
        fail_fast: bool = False,
    ):
        self.client = client
        self.pdf_path = pdf_path
        self.skip_legacy = skip_legacy
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

        self.step("POST /edit/apply + download", self.check_edit_apply)

        if not self.skip_legacy:
            self.step("POST /merge", self.check_merge)
            self.step("POST /extract", self.check_extract)
            self.step("POST /delete", self.check_delete_pages)
            self.step("POST /rotate", self.check_rotate)
            self.step("POST /split", self.check_split)
            self.step("POST /overlay/text", self.check_overlay_text)
            self.step("POST /overlay/image", self.check_overlay_image)

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
        # Create a small job first, then verify that the lookup form redirects to it.
        if not self.source_id:
            # Re-upload if the previous step deleted/cleared early in a failed run.
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

    def check_edit_apply(self) -> str:
        operations = [
            {"type": "insert_blank", "position": "after", "page": 1, "size": "same"},
        ]
        response = self.client.post_multipart(
            "/edit/apply",
            fields={"operations": json.dumps(operations)},
            files=[("pdf", self.pdf_filename, PDF_MIME, self.pdf_bytes)],
        )
        data = assert_json_ok(response, "POST /edit/apply")
        if data.get("ok") is not True:
            raise AssertionError(f"POST /edit/apply: ok is not true: {data!r}")
        download_url = data.get("download_url")
        code = str(data.get("code", "")).upper()
        if not isinstance(download_url, str) or not download_url:
            raise AssertionError(f"POST /edit/apply: missing download_url: {data!r}")
        assert_pdf_response(self.client.get(download_url), "download edited PDF")
        if code:
            self.delete_job(code)
        return f"download_url={download_url}"

    def check_merge(self) -> str:
        code = self.post_redirect_job(
            "/merge",
            files=[
                ("files", f"a_{self.pdf_filename}", PDF_MIME, self.pdf_bytes),
                ("files", f"b_{self.pdf_filename}", PDF_MIME, self.pdf_bytes),
            ],
        )
        self.assert_job_done_and_download(code, "merged.pdf")
        self.delete_job(code)
        return f"code={code}"

    def check_extract(self) -> str:
        pages = "1-2" if self.page_count >= 2 else "1"
        code = self.post_redirect_job(
            "/extract",
            fields={"pages": pages},
            files=[("file", self.pdf_filename, PDF_MIME, self.pdf_bytes)],
        )
        self.assert_job_done_and_download(code, "extracted.pdf")
        self.delete_job(code)
        return f"code={code}, pages={pages}"

    def check_delete_pages(self) -> str:
        if self.page_count <= 1:
            return "skipped: input PDF has only one page"
        pages = str(self.page_count)
        code = self.post_redirect_job(
            "/delete",
            fields={"pages": pages},
            files=[("file", self.pdf_filename, PDF_MIME, self.pdf_bytes)],
        )
        self.assert_job_done_and_download(code, "deleted.pdf")
        self.delete_job(code)
        return f"code={code}, pages={pages}"

    def check_rotate(self) -> str:
        code = self.post_redirect_job(
            "/rotate",
            fields={"pages": "1", "angle": "90"},
            files=[("file", self.pdf_filename, PDF_MIME, self.pdf_bytes)],
        )
        self.assert_job_done_and_download(code, "rotated.pdf")
        self.delete_job(code)
        return f"code={code}"

    def check_split(self) -> str:
        ranges = "1-2" if self.page_count >= 2 else "1"
        code = self.post_redirect_job(
            "/split",
            fields={"ranges": ranges},
            files=[("file", self.pdf_filename, PDF_MIME, self.pdf_bytes)],
        )
        links = self.assert_job_done_and_download(code, expected_filename=None)
        self.delete_job(code)
        return f"code={code}, ranges={ranges}, downloads={len(links)}"

    def check_overlay_text(self) -> str:
        code = self.post_redirect_job(
            "/overlay/text",
            fields={
                "page": "1",
                "text": "APDF smoke test",
                "x": "72",
                "y": "72",
                "font_size": "14",
                "opacity": "0.85",
            },
            files=[("file", self.pdf_filename, PDF_MIME, self.pdf_bytes)],
        )
        self.assert_job_done_and_download(code, "text_overlay.pdf")
        self.delete_job(code)
        return f"code={code}"

    def check_overlay_image(self) -> str:
        code = self.post_redirect_job(
            "/overlay/image",
            fields={
                "page": "1",
                "x": "72",
                "y": "72",
                "width": "64",
                "height": "0",
                "opacity": "0.9",
            },
            files=[
                ("file", self.pdf_filename, PDF_MIME, self.pdf_bytes),
                ("image", "smoke.png", PNG_MIME, SMOKE_PNG),
            ],
        )
        self.assert_job_done_and_download(code, "image_overlay.pdf")
        self.delete_job(code)
        return f"code={code}"

    def post_redirect_job(
        self,
        path: str,
        *,
        fields: dict[str, str] | None = None,
        files: list[tuple[str, str, str, bytes]] | None = None,
    ) -> str:
        response = self.client.post_multipart(path, fields=fields or {}, files=files or [])
        return assert_redirect_to_job(response, f"POST {path}")

    def assert_job_done_and_download(self, code: str, expected_filename: str | None) -> list[str]:
        job_response = self.client.get(f"/job/{urllib.parse.quote(code)}")
        assert_status(job_response, {200}, f"GET /job/{code}")
        html = job_response.text
        status = parse_job_status(html)
        if status != "done":
            snippet = html[:500].replace("\n", " ")
            raise AssertionError(f"job {code}: expected status=done, got {status!r}. HTML: {snippet}")

        if expected_filename:
            download_path = f"/download/{urllib.parse.quote(code)}/{urllib.parse.quote(expected_filename)}"
            assert_pdf_response(self.client.get(download_path), f"GET {download_path}")
            return [download_path]

        links = parse_download_links(html, code)
        if not links:
            raise AssertionError(f"job {code}: no download links found")
        for link in links:
            assert_pdf_response(self.client.get(link), f"GET {link}")
        return links

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
            print(f"{mark:4} {result.elapsed_ms:8.1f} ms  {result.name} {('- ' + result.detail) if result.detail else ''}")
        print(f"\nTotal: {len(self.results)}, Passed: {passed}, Failed: {failed}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="APDF endpoint smoke/contract checker")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="APDF server base URL")
    parser.add_argument("--pdf", default="test.pdf", help="Path to a small test PDF")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds")
    parser.add_argument("--skip-legacy", action="store_true", help="Skip legacy form endpoints such as /merge and /split")
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
        skip_legacy=args.skip_legacy,
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
