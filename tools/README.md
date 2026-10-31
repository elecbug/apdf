# APDF Smoke Check v11

See the [English documentation index](../docs/README.md), especially the [testing guide](../docs/TESTING.md), for the complete server, offline, and desktop verification workflow.

The desktop app has separate protocol and full PDF workflow checks: `npm run test:desktop` and `npm run test:desktop:browser`. See [the desktop guide](../desktop/README.md). Both browser and desktop variants share the full workflow test, including all tools and offline processing. `npm run icons` regenerates web favicons and native icons from the shared APDF SVG.

This smoke checker targets the current APDF routing model after the Python split and Edit utility updates.

It verifies:

- Core HTML pages
- Edit page UI control IDs, including drag-and-drop target, Preview Zoom, coordinate inspector, Append PDF, Page Numbers, Add Text, text box width, text style toggles, Add Image, Shapes, Pen, and Undo controls
- Browser-session source cache APIs
- `/compose` in the selected Docker mode: a direct PDF with no code, or a stored result-code page
- `/edit/apply` operations:
  - `insert_blank`
  - `insert_image_page`
  - `append_pdf`
  - `rotate`
  - `page_numbers`
  - open range syntax such as `1-`, `-1`, `all`, and empty-as-all behavior
  - `delete_pages`
  - `move_pages`
  - `overlay_text`
  - `overlay_image`
  - `overlay_shape` (all six shapes, transparency, RGBA, and separate fill/border alpha)
  - `overlay_drawing` (ink, pencil, marker, and dry brush with per-stroke styles)
  - combined operation list
- Job result page
- PDF download endpoint
- Optional removal of legacy standalone endpoints

## Usage

With Docker Compose, the smoke checker runs once automatically after APDF becomes healthy:

```bash
docker compose up -d --build
```

The debug directory is mounted into the smoke container. Output is saved to:

```text
debug/.log
```

View the container logs:

```bash
docker compose logs smoke
```

Run the smoke checker again through Docker Compose:

```bash
docker compose up smoke
```

Run it manually on the host:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf --expect-legacy-removed
```

Preview Zoom, the coordinate inspector, and Undo are frontend-only features. The current Edit UI applies one operation immediately from the selected tool detail panel, while `/edit/apply` still accepts an operation list. Text/image overlays, Append PDF, and Page Numbers are tested through `/edit/apply`; automatic coordinate filling, text box width controls, text style controls, and drag-and-drop targets are verified by checking the page control IDs. The Assemble page now builds directly from the source list, so the checker also verifies that legacy Result/Assembly controls are not present. The checker therefore verifies that the Edit page exposes the expected control IDs as well as backend edit contracts.

## Logic regression checks

Run the backend regressions with the dependencies from `app/requirements.txt` installed:

```bash
python -m unittest discover -s tests -v
```

These cover visible page coordinates at all four rotations, cropped pages, text orientation, image placement bounds, page numbering, inserted page sizes, invalid numeric values and page selections, empty/encrypted PDFs, and rollback of failed upload batches.

Assemble regressions also verify direct downloads create no stored jobs or codes, clean temporary outputs after transfer and failure, keep source PDFs, enforce the server-selected mode, retain failed result-code jobs, and render only the selected mode's controls. The smoke checker detects the selected mode and validates its response contract and lookup availability. Use `APDF_ASSEMBLE_RESULT_CODE=false` and `true` on separate disposable servers to check both.

Run `APDF_TEST_PYTHON=python3 node tests/browser_assemble_modes.cjs http://127.0.0.1:8775 http://127.0.0.1:8776` against those two servers (direct mode first). The browser checks the selected controls, ordered/ranged PDF contents, error recovery, direct downloads without job requests, result-page navigation without automatic download, and reopening results by code. Screenshots are written to `docs/design/assemble-*-mode.png`.

Shape regressions additionally cover all six vector shapes, independent fill/border alpha, RGBA multiplication, transparent colors, alpha zero, bounds and border widths, and all rotations with nonzero CropBox origins.

Pen regressions cover four distinct vector brushes, multiple pages and per-stroke styles, dots, duplicate points, RGBA/opacity, visible page bounds, rotation, clipping, invalid inputs, and drawing-size limits.

Texture regressions verify fixed per-stroke seeds, nonperiodic pigment/bristle lengths and densities, independence from mouse-event spacing, removal of repeating PDF dash patterns, and bounded detail for long/thin strokes. The pen browser checks also ensure that zoom does not reshuffle texture and repeated gestures get distinct grain patterns.

The browser regressions use Playwright Chromium and the actual PDF.js engine. Run a disposable APDF server with its own data directory, then run the checks from the project root:

```bash
APDF_DATA_DIR=/tmp/apdf-regression-data uvicorn app.main:app --host 127.0.0.1 --port 8765
```

In another terminal:

```bash
npm install --prefix /tmp/apdf-browser-check playwright pdfjs-dist@5.7.284
/tmp/apdf-browser-check/node_modules/.bin/playwright install chromium
APDF_PLAYWRIGHT_MODULE=/tmp/apdf-browser-check/node_modules/playwright \
APDF_TEST_PDFJS=/tmp/apdf-browser-check/node_modules/pdfjs-dist \
node tests/browser_logic.cjs http://127.0.0.1:8765
```

Set `APDF_TEST_PYTHON` if the Python interpreter with the project dependencies is not `python3`. For a server that already serves PDF.js, `APDF_TEST_PDFJS` is optional. The checks exercise invalid page inputs, overlapping rendering, failed document loads, edits versus file replacement, local downloads and Undo, visible coordinates and actual image placement, mobile fit-width, source operation locking, and blocked browser storage.

Use the same browser environment variables with `node tests/browser_shapes.cjs http://127.0.0.1:8765` for shape-specific checks. These drag in both directions, insert and undo all six shapes, inspect actual rendered pixels for separate fill/border alpha and transparency, reject invalid alpha, and verify placement on rotated/cropped pages and the mobile layout.

Run `node tests/browser_leave.cjs http://127.0.0.1:8765` with the same environment variables to verify that an empty Edit page reloads freely, a loaded PDF prompts before refresh/navigation, cancel preserves the PDF, and confirming permits navigation.

Run `node tests/browser_pen.cjs http://127.0.0.1:8765` with the same environment variables to compare live pen previews with actual PDF-rendered pixels for all four textures. It also checks per-stroke settings, zoom/page/tool changes, stroke and PDF Undo, multi-page Apply, failed-apply recovery, file-replacement protection, dots, page-edge clipping, touch/canceled gestures, input validation, automatic Apply on download, and mobile layout.
