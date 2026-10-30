from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

from app.services.pdf.editor import apply_edit_operations


class ShapeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.pdf"
        self.output = self.root / "output.pdf"
        writer = PdfWriter()
        writer.add_blank_page(300, 400)
        writer.write(self.source)
        self.operation = {
            "type": "overlay_shape", "shape": "rectangle", "page": 1,
            "x": 20, "y": 30, "width": 120, "height": 80,
            "fill_color": "#ff0000", "fill_opacity": 0.25,
            "stroke_color": "#0000ff", "stroke_opacity": 0.75, "stroke_width": 4,
        }

    def apply(self, **changes):
        apply_edit_operations(self.source, [{**self.operation, **changes}], {}, self.output)
        return PdfReader(self.output).pages[0]

    def operators(self, page):
        return [operator for _operands, operator in page.get_contents().operations]

    def test_all_six_shapes_are_vector_pdf_content(self):
        for shape in ("circle", "rectangle", "triangle", "pentagon", "star", "rounded_rectangle"):
            with self.subTest(shape=shape):
                page = self.apply(shape=shape)
                self.assertFalse(page["/Resources"].get("/XObject"))
                self.assertTrue(set(self.operators(page)) & {b"B", b"B*"})

    def test_fill_and_border_have_independent_alpha_including_rgba(self):
        page = self.apply(fill_color="#ff000080", fill_opacity=0.5, stroke_color="#00f8", stroke_opacity=0.75)
        states = [state.get_object() for state in page["/Resources"]["/ExtGState"].values()]
        self.assertTrue(any(abs(float(state.get("/ca", -1)) - 0.5 * 128 / 255) < 1e-6 for state in states))
        self.assertTrue(any(abs(float(state.get("/CA", -1)) - 0.75 * 136 / 255) < 1e-6 for state in states))

    def test_transparent_fill_leaves_only_the_border(self):
        for color in (None, "transparent", "#f000"):
            with self.subTest(color=color):
                operators = self.operators(self.apply(fill_color=color))
                self.assertIn(b"S", operators)
                self.assertFalse(set(operators) & {b"f", b"f*", b"B", b"B*"})

    def test_border_can_be_transparent_zero_alpha_or_zero_width(self):
        for changes in ({"stroke_color": None}, {"stroke_color": "transparent"}, {"stroke_opacity": 0}, {"stroke_width": 0}):
            with self.subTest(changes=changes):
                operators = self.operators(self.apply(**changes))
                self.assertTrue(set(operators) & {b"f", b"f*"})
                self.assertFalse(set(operators) & {b"S", b"B", b"B*"})

    def test_fully_transparent_shape_is_valid(self):
        operators = self.operators(self.apply(fill_opacity=0, stroke_opacity=0))
        self.assertFalse(set(operators) & {b"S", b"f", b"f*", b"B", b"B*"})

    def test_invalid_bounds_colors_and_alpha_are_rejected(self):
        for changes in (
            {"shape": "unknown"}, {"page": 2}, {"x": -1}, {"y": -1},
            {"width": 0}, {"height": -1}, {"x": 250}, {"y": 350},
            {"fill_color": "red"}, {"stroke_color": "#ggg"},
            {"fill_opacity": -0.1}, {"fill_opacity": 1.1},
            {"stroke_opacity": -0.1}, {"stroke_opacity": 1.1},
            {"stroke_width": -1}, {"stroke_width": 80},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    self.apply(**changes)

    def test_nonfinite_numbers_are_rejected(self):
        for key in ("x", "y", "width", "height", "fill_opacity", "stroke_opacity", "stroke_width"):
            for value in ("nan", "inf", "-inf"):
                with self.subTest(key=key, value=value):
                    with self.assertRaisesRegex(ValueError, "finite"):
                        self.apply(**{key: value})

    def test_shapes_support_every_rotation_and_nonzero_crop_origin(self):
        for rotation in (0, 90, 180, 270):
            writer = PdfWriter()
            page = writer.add_blank_page(400, 600)
            page.cropbox = RectangleObject((40, 80, 340, 500))
            page.rotate(rotation)
            writer.write(self.source)
            for shape in ("circle", "rectangle", "triangle", "pentagon", "star", "rounded_rectangle"):
                with self.subTest(rotation=rotation, shape=shape):
                    result = self.apply(shape=shape)
                    self.assertEqual(result.rotation, rotation)
                    self.assertEqual(tuple(result.cropbox), (40, 80, 340, 500))
                    self.assertTrue(set(self.operators(result)) & {b"B", b"B*"})

    def test_border_can_touch_page_edges_without_expanding_the_page(self):
        page = self.apply(x=0, y=0, width=300, height=400)
        self.assertEqual(tuple(page.mediabox), (0, 0, 300, 400))


if __name__ == "__main__":
    unittest.main()
