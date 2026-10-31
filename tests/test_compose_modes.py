from __future__ import annotations

import asyncio
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import UploadFile
from fastapi.responses import FileResponse
from pypdf import PdfReader, PdfWriter
from starlette.requests import Request

from app.config import read_bool_env
from app.routes import compose, pages
from app.routes.sources import upload_sources
from app.services.client_store import load_sources, source_pdf_path
from app.services.job_store import find_by_code
from app.web import templates


class ComposeModeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for target, directory in [
            ("app.services.client_store.CLIENTS_DIR", "clients"),
            ("app.services.job_store.JOBS_DIR", "jobs"),
        ]:
            path = self.root / directory
            path.mkdir()
            context = patch(target, path)
            context.start()
            self.addCleanup(context.stop)
        writer = PdfWriter()
        for _ in range(3):
            writer.add_blank_page(200, 300)
        buffer = io.BytesIO()
        writer.write(buffer)
        upload = UploadFile(io.BytesIO(buffer.getvalue()), filename="source.pdf")
        try:
            asyncio.run(upload_sources("compose-test-client", [upload]))
        finally:
            asyncio.run(upload.close())
        self.source = load_sources("compose-test-client")[0]
        self.payload = {
            "client_id": "compose-test-client",
            "plan": [{"source_id": self.source.source_id, "start": 2, "end": 3}],
        }

    def request(self, enabled, payload=None):
        raw = json.dumps(self.payload if payload is None else payload).encode()

        async def receive():
            return {"type": "http.request", "body": raw, "more_body": False}

        request = Request({"type": "http", "method": "POST", "path": "/compose", "headers": []}, receive)
        with patch.object(compose, "ASSEMBLE_RESULT_CODE_ENABLED", enabled):
            return asyncio.run(compose.compose(request))

    def test_direct_download_creates_no_job_or_code_and_removes_output_after_transfer(self):
        with patch.object(compose, "create_job", side_effect=AssertionError("Direct mode must not create jobs")):
            response = self.request(False)
        self.assertIsInstance(response, FileResponse)
        self.assertEqual(response.media_type, "application/pdf")
        self.assertIn('filename="assembled.pdf"', response.headers["content-disposition"])
        self.assertEqual(len(PdfReader(response.path).pages), 2)
        self.assertEqual(list((self.root / "jobs").iterdir()), [])
        self.assertTrue(source_pdf_path("compose-test-client", self.source.source_id).exists())
        asyncio.run(response.background())
        self.assertFalse(Path(response.path).exists())
        self.assertFalse(Path(response.path).parent.exists())

    def test_result_code_always_returns_a_stored_result_even_for_a_tiny_pdf(self):
        response = self.request(True)
        data = json.loads(response.body)
        self.assertEqual(data["mode"], "job")
        self.assertEqual(data["url"], f'/job/{data["code"]}')
        self.assertNotIn("download_url", data)
        meta = find_by_code(data["code"])
        self.assertEqual(meta.status, "done")
        self.assertEqual(meta.outputs, ["assembled.pdf"])
        output = self.root / "jobs" / meta.job_id / "output" / "assembled.pdf"
        self.assertEqual(len(PdfReader(output).pages), 2)

    def test_direct_failure_cleans_partial_files_and_does_not_issue_a_code(self):
        original = tempfile.TemporaryDirectory

        def temporary(**options):
            return original(dir=self.root, **options)

        self.payload["plan"][0]["end"] = 100
        with patch.object(compose, "TemporaryDirectory", side_effect=temporary):
            response = self.request(False)
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("code", json.loads(response.body))
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ["clients", "jobs"])

    def test_code_mode_keeps_failed_job_for_result_page(self):
        self.payload["plan"][0]["end"] = 100
        response = self.request(True)
        self.assertEqual(response.status_code, 400)
        meta = find_by_code(json.loads(response.body)["code"])
        self.assertEqual(meta.status, "failed")

    def test_invalid_payloads_and_unknown_sources_create_no_jobs(self):
        for enabled in [False, True]:
            for payload in [[], {}, {"plan": []}, {"plan": [None]}, {"client_id": "compose-test-client", "plan": [{"source_id": "UNKNOWN"}]}]:
                with self.subTest(enabled=enabled, payload=payload):
                    self.assertEqual(self.request(enabled, payload).status_code, 400)
        self.assertEqual(list((self.root / "jobs").iterdir()), [])

    def test_client_cannot_override_server_mode(self):
        self.payload.update({"mode": "job", "result_code": True})
        response = self.request(False)
        self.assertIsInstance(response, FileResponse)
        asyncio.run(response.background())

    def test_page_exposes_only_the_selected_assemble_flow(self):
        request = Request({"type": "http", "method": "GET", "path": "/assemble", "headers": []})
        for enabled in [False, True]:
            with patch.dict(templates.env.globals, {"assemble_result_code_enabled": enabled}):
                html = pages.assemble_page(request).body.decode()
            self.assertEqual('action="/lookup"' in html, enabled)
            self.assertEqual('Build &amp; Get Result Code' in html, enabled)
            self.assertEqual('No result code is created.' in html, not enabled)


class AssembleConfigTests(unittest.TestCase):
    def test_boolean_setting_is_explicit_and_rejects_misspellings(self):
        for value, expected in [("true", True), ("FALSE", False), ("1", True), ("0", False), (" on ", True), ("off", False)]:
            with patch.dict(os.environ, {"APDF_ASSEMBLE_RESULT_CODE": value}):
                self.assertEqual(read_bool_env("APDF_ASSEMBLE_RESULT_CODE"), expected)
        with patch.dict(os.environ, {"APDF_ASSEMBLE_RESULT_CODE": "treu"}):
            with self.assertRaisesRegex(ValueError, "APDF_ASSEMBLE_RESULT_CODE must be true or false"):
                read_bool_env("APDF_ASSEMBLE_RESULT_CODE")


if __name__ == "__main__":
    unittest.main()
