from __future__ import annotations

import tempfile
import unittest
import math
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

from app.services.pdf.editor import apply_edit_operations
from app.services.pdf.drawing import BRUSH_PRESETS
from app.services.pdf.brush_texture import texture_paths


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

    def test_texture_seed_is_validated(self):
        for seed in (-1, 4294967296, True, 1.5, "1"):
            with self.subTest(seed=seed):
                with self.assertRaisesRegex(ValueError, "seed"):
                    self.apply([{**self.stroke, "seed": seed}])
        for seed in (0, 4294967295):
            self.apply([{**self.stroke, "seed": seed}])

    def test_textured_brushes_do_not_use_repeating_pdf_dashes(self):
        for texture in ("pencil", "dry_brush"):
            with self.subTest(texture=texture):
                page = self.apply([{**self.stroke, "texture": texture, "seed": 42}]).pages[0]
                dashes = [operands[0] for operands, operator in page.get_contents().operations if operator == b"d"]
                self.assertTrue(dashes)
                self.assertTrue(all(not pattern for pattern in dashes))


class BrushTextureTests(unittest.TestCase):
    def paths(self, texture, points=None, seed=42, width=12):
        return texture_paths(points or [(0, 0), (240, 0)], width, BRUSH_PRESETS[texture]["surface"], seed)

    def test_texture_is_stable_for_a_seed_and_varies_between_strokes(self):
        for texture in ("pencil", "dry_brush"):
            with self.subTest(texture=texture):
                self.assertEqual(self.paths(texture), self.paths(texture))
                self.assertNotEqual(self.paths(texture), self.paths(texture, seed=43))

    def test_texture_follows_distance_not_mouse_event_spacing(self):
        for texture in ("pencil", "dry_brush"):
            with self.subTest(texture=texture):
                sparse = self.paths(texture)
                dense = self.paths(texture, [(x, 0) for x in range(241)])
                # The first path is the original, faint base stroke. Pigment
                # and bristle geometry should ignore how densely it was sampled.
                self.assertEqual(len(sparse), len(dense))
                for first, second in zip(sparse[1:], dense[1:]):
                    self.assertEqual(first["width"], second["width"])
                    self.assertEqual(first["alpha"], second["alpha"])
                    self.assertEqual(len(first["paths"]), len(second["paths"]))
                    for line_a, line_b in zip(first["paths"], second["paths"]):
                        self.assertEqual(len(line_a), len(line_b))
                        for point_a, point_b in zip(line_a, line_b):
                            self.assertAlmostEqual(point_a[0], point_b[0], places=7)
                            self.assertAlmostEqual(point_a[1], point_b[1], places=7)

    def test_marks_have_nonuniform_lengths_positions_and_density(self):
        for texture in ("pencil", "dry_brush"):
            with self.subTest(texture=texture):
                groups = self.paths(texture)[1:]
                lines = [line for group in groups for line in group["paths"]]
                lengths = {round(math.dist(line[0], line[-1]), 3) for line in lines}
                offsets = {round(point[1], 3) for line in lines for point in line}
                self.assertGreater(len(lengths), 30)
                self.assertGreater(len(offsets), 30)
                self.assertGreater(len({group["width"] for group in groups}), 2)
                self.assertGreater(len({group["alpha"] for group in groups}), 2)

    def test_texture_detail_is_bounded_for_long_thin_strokes(self):
        for texture in ("pencil", "dry_brush"):
            with self.subTest(texture=texture):
                groups = self.paths(texture, [(0, 0), (100000, 0)], width=0.1)
                self.assertLessEqual(sum(len(group["paths"]) for group in groups), 4097)
                self.assertLess(sum(len(line) for group in groups for line in group["paths"]), 30000)


if __name__ == "__main__":
    unittest.main()
