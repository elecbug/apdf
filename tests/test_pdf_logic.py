from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

from app.services.pdf.core import open_pdf
from app.services.pdf.editor import apply_edit_operations


class PdfLogicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.pdf"
        self.output = self.root / "output.pdf"
        self.image = self.root / "image.png"
        Image.new("RGB", (20, 10), "red").save(self.image)

    def make_source(self, rotation=0, cropped=False):
        writer = PdfWriter()
        page = writer.add_blank_page(200, 300)
        if cropped:
            page.mediabox = RectangleObject((10, 20, 410, 620))
            page.cropbox = RectangleObject((40, 80, 340, 500))
        page.rotate(rotation)
        writer.write(self.source)

    def apply(self, operation):
        # Use a standard font so positions are independent of host fonts.
        with patch("app.services.pdf.editor._register_overlay_font", return_value="Helvetica"):
            apply_edit_operations(self.source, [operation], {"image": self.image}, self.output)
        return PdfReader(self.output)

    def text_positions(self, page):
        # Flatten the output's display rotation, then inspect the final PDF
        # content coordinates rather than the editor's transformation helper.
        page.transfer_rotation_to_content()
        positions = []

        def visit(text, cm, tm, _font, _size):
            if text.strip():
                x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4] - float(page.cropbox.left)
                y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5] - float(page.cropbox.bottom)
                positions.append((text.strip(), x, y, cm))

        page.extract_text(visitor_text=visit)
        return positions

    def test_text_uses_visible_page_coordinates_and_stays_upright(self):
        for rotation in (0, 90, 180, 270):
            for cropped in (False, True):
                with self.subTest(rotation=rotation, cropped=cropped):
                    self.make_source(rotation, cropped)
                    reader = self.apply({"type": "overlay_text", "page": 1, "x": 50, "y": 60, "text": "MARK"})
                    text, x, y, matrix = self.text_positions(reader.pages[0])[0]
                    self.assertEqual(text, "MARK")
                    self.assertAlmostEqual(x, 50, places=3)
                    self.assertAlmostEqual(y, 60, places=3)
                    for actual, expected in zip(matrix[:4], (1, 0, 0, 1)):
                        self.assertAlmostEqual(actual, expected, places=3)

    def test_landscape_visible_coordinate_is_accepted(self):
        self.make_source(90)
        for operation in (
            {"type": "overlay_text", "text": "MARK"},
            {"type": "overlay_image", "image_id": "image", "width": 20, "height": 10},
        ):
            with self.subTest(type=operation["type"]):
                reader = self.apply({**operation, "page": 1, "x": 250, "y": 20})
                self.assertEqual(len(reader.pages), 1)

    def test_page_numbers_use_visible_bottom_left(self):
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                self.make_source(rotation, cropped=True)
                reader = self.apply({"type": "page_numbers", "position": "bottom-left"})
                text, x, y, _matrix = self.text_positions(reader.pages[0])[0]
                self.assertEqual(text, "1")
                self.assertAlmostEqual(x, 36, places=3)
                self.assertAlmostEqual(y, 36, places=3)

    def test_inserted_pages_match_visible_reference_size(self):
        self.make_source(90, cropped=True)
        for operation in (
            {"type": "insert_blank", "size": "same"},
            {"type": "insert_image_page", "image_id": "image"},
        ):
            with self.subTest(type=operation["type"]):
                reader = self.apply({**operation, "position": "end"})
                page = reader.pages[-1]
                self.assertEqual((float(page.mediabox.width), float(page.mediabox.height)), (420, 300))

    def test_nonfinite_overlay_values_are_rejected(self):
        self.make_source()
        for operation in (
            {"type": "overlay_text", "text": "MARK"},
            {"type": "overlay_image", "image_id": "image", "width": 20, "height": 10},
        ):
            fields = ("x", "y", "opacity", "max_width") if operation["type"] == "overlay_text" else ("x", "y", "opacity", "width", "height")
            for field in fields:
                for value in ("nan", "inf", "-inf"):
                    with self.subTest(type=operation["type"], field=field, value=value):
                        with self.assertRaisesRegex(ValueError, "finite"):
                            self.apply({**operation, "page": 1, "x": 10, "y": 20, field: value})

    def test_empty_range_tokens_do_not_mean_all_pages(self):
        self.make_source()
        for expression in (", ,", "-", " , - , "):
            with self.subTest(expression=expression):
                with self.assertRaisesRegex(ValueError, "page selection"):
                    self.apply({"type": "rotate", "pages": expression, "angle": 90})

    def test_empty_and_password_protected_pdfs_are_rejected(self):
        writer = PdfWriter()
        writer.write(self.source)
        with self.assertRaisesRegex(ValueError, "no pages"):
            open_pdf(self.source)
        writer.add_blank_page(200, 300)
        writer.encrypt("secret")
        writer.write(self.source)
        with self.assertRaisesRegex(ValueError, "Encrypted PDF"):
            open_pdf(self.source)


if __name__ == "__main__":
    unittest.main()
