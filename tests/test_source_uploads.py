from __future__ import annotations

import asyncio
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from pypdf import PdfWriter

from app.routes.sources import upload_sources
from app.services.client_store import load_sources


class SourceUploadTests(unittest.TestCase):
    def test_failed_batch_keeps_existing_sources_and_removes_new_files(self):
        writer = PdfWriter()
        writer.add_blank_page(200, 300)
        buffer = io.BytesIO()
        writer.write(buffer)
        pdf = buffer.getvalue()

        async def run():
            uploads = []

            def upload(data, name):
                item = UploadFile(io.BytesIO(data), filename=name)
                uploads.append(item)
                return item

            try:
                await upload_sources("test-client", [upload(pdf, "existing.pdf")])
                with self.assertRaises(HTTPException) as error:
                    await upload_sources("test-client", [upload(pdf, "new.pdf"), upload(b"invalid", "bad.pdf")])
                self.assertEqual(error.exception.status_code, 400)
                self.assertEqual([source.name for source in load_sources("test-client")], ["existing.pdf"])
                self.assertEqual(len(list(root.glob("*/sources/*.pdf"))), 1)
            finally:
                for item in uploads:
                    await item.close()

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch("app.services.client_store.CLIENTS_DIR", root):
                asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
