from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

from app.services.pdf.editor import apply_edit_operations


class DrawingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "source.pdf"
        self.output = Path(self.temp.name) / "output.pdf"
        writer = PdfWriter()
        for rotation in (0, 90, 180, 270):
            page = writer.add_blank_page(400, 600)
            page.cropbox = RectangleObject((40, 80, 340, 500))
            page.rotate(rotation)
        writer.write(self.source)
        self.stroke = {"page": 1, "color": "#f00", "width": 8, "opacity": 0.5,
                       "texture": "ink", "points": [[20, 30], [60, 80], [120, 30]]}

    def apply(self, strokes):
        apply_edit_operations(self.source, [{"type": "overlay_drawing", "strokes": strokes}], {}, self.output)
        return PdfReader(self.output)

    def test_all_brushes_are_distinct_vectors(self):
        contents = set()
        for texture in ("ink", "pencil", "marker", "dry_brush"):
            with self.subTest(texture=texture):
                reader = self.apply([{**self.stroke, "texture": texture}])
                self.assertEqual(len(reader.pages), 4)
                page = reader.pages[0]
                self.assertFalse(page["/Resources"].get("/XObject"))
                self.assertIn(b"S", [operator for _, operator in page.get_contents().operations])
                contents.add(page.get_contents().get_data())
        self.assertEqual(len(contents), 4)

    def test_styles_and_pages_are_kept_per_stroke(self):
        reader = self.apply([
            self.stroke,
            {**self.stroke, "page": 2, "color": "#0000ff", "width": 12, "texture": "dry_brush"},
        ])
        self.assertIsNotNone(reader.pages[0].get_contents())
        self.assertIsNotNone(reader.pages[1].get_contents())
        self.assertIsNone(reader.pages[2].get_contents())
        self.assertIsNone(reader.pages[3].get_contents())
        for page, rotation in zip(reader.pages, (0, 90, 180, 270)):
            self.assertEqual(page.rotation, rotation)
            self.assertEqual(tuple(page.cropbox), (40, 80, 340, 500))

    def test_taps_and_duplicate_points_render_as_dots(self):
        for texture in ("ink", "pencil", "marker", "dry_brush"):
            for points in ([[50, 60]], [[50, 60], [50, 60]]):
                with self.subTest(texture=texture, points=points):
                    page = self.apply([{**self.stroke, "texture": texture, "points": points}]).pages[0]
                    self.assertTrue(set(operator for _, operator in page.get_contents().operations) & {b"f", b"f*"})

    def test_rgba_color_alpha_is_multiplied_by_opacity(self):
        page = self.apply([{**self.stroke, "color": "#ff000080"}]).pages[0]
        states = [state.get_object() for state in page["/Resources"]["/ExtGState"].values()]
        self.assertTrue(any(abs(float(state.get("/CA", -1)) - 0.5 * 128 / 255) < 1e-6 for state in states))

    def test_transparent_and_zero_alpha_strokes_are_valid(self):
        for changes in ({"opacity": 0}, {"color": None}, {"color": "transparent"}):
            with self.subTest(changes=changes):
                page = self.apply([{**self.stroke, **changes}]).pages[0]
                self.assertNotIn(b"S", [operator for _, operator in page.get_contents().operations])

    def test_bounds_follow_displayed_rotation_and_crop(self):
        for page in (2, 4):
            self.apply([{**self.stroke, "page": page, "points": [[350, 150], [420, 300]]}])
        for page in (1, 3):
            with self.assertRaisesRegex(ValueError, "bounds"):
                self.apply([{**self.stroke, "page": page, "points": [[350, 150]]}])

    def test_strokes_at_page_edges_do_not_expand_the_pdf(self):
        reader = self.apply([{**self.stroke, "width": 100, "points": [[0, 0], [300, 420]]}])
        self.assertEqual(tuple(reader.pages[0].mediabox), (0, 0, 400, 600))
        self.assertEqual(tuple(reader.pages[0].cropbox), (40, 80, 340, 500))

    def test_invalid_strokes_are_rejected(self):
        for changes in (
            {"page": 0}, {"page": 5}, {"page": 1.5}, {"page": True}, {"texture": "unknown"},
            {"width": 0}, {"width": 101}, {"opacity": -1}, {"opacity": 1.1}, {"color": "red"},
            {"points": []}, {"points": "invalid"}, {"points": [[1, 2, 3]]},
            {"points": [[-1, 1]]}, {"points": [[301, 0]]}, {"points": [[0, 421]]},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    self.apply([{**self.stroke, **changes}])
        for strokes in (None, [], {}, [None]):
            with self.subTest(strokes=strokes):
                with self.assertRaises(ValueError):
                    self.apply(strokes)

    def test_nonfinite_values_are_rejected(self):
        for value in ("nan", "inf", "-inf"):
            for changes in ({"width": value}, {"opacity": value}, {"points": [[value, 0]]}, {"points": [[0, value]]}):
                with self.subTest(changes=changes):
                    with self.assertRaisesRegex(ValueError, "finite"):
                        self.apply([{**self.stroke, **changes}])

    def test_drawing_limits_are_checked_before_rendering(self):
        for strokes in (
            [self.stroke] * 201,
            [{**self.stroke, "points": [[0, 0]] * 5001}],
            [{**self.stroke, "points": [[0, 0]] * 5000}] * 7,
        ):
            with self.subTest(count=len(strokes)):
                with self.assertRaises(ValueError):
                    self.apply(strokes)


if __name__ == "__main__":
    unittest.main()
