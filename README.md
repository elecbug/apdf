# APDF

APDF is a lightweight internal-network PDF utility server for assembling and editing PDF files.

It is designed for short-lived internal use, not as a long-term document storage system. A separate **APDF Local** web app also runs all PDF processing inside the browser and supports offline use.

## Documentation

The [English documentation index](docs/README.md) links the user guide, development setup, architecture, configuration, HTTP API, PDF operation specification, extension guide, testing, deployment, and troubleshooting. Start there when using, integrating, operating, or modifying APDF.

## Desktop app — no runtime installation

APDF Local now also ships as a desktop app with its browser and PDF runtime included. Users do not need Node.js, Python, Docker, a separate browser, a server process, or an internet connection, including on the first launch.

Open the Windows portable EXE, the macOS app, or the Linux executable from the complete extracted archive. Builds are written to `desktop/releases`; [the desktop guide](desktop/README.md) explains the OS/CPU variants, storage, signing status, and builds. [The desktop workflow](.github/workflows/desktop.yml) builds Windows/macOS/Linux x64 and arm64 packages on the corresponding native runners.

All existing edit/assemble tools are shared with the web app. The desktop app uses native PDF save dialogs and confirmation before leaving an editing session. Web favicons and desktop icons now use the same APDF document design.

## Local-only web app

With Node.js 22.12+ installed:

```bash
npm ci
npm run local
```

Open **http://127.0.0.1:4173**. The React app includes all Edit and Assemble tools. PDFs stay on your device; no Python backend or PDF upload is involved. Build dependencies are downloaded once and bundled locally. When the footer says **Ready for offline use**, the app also works after disconnecting the network or stopping the static file server.

`npm run package:local` creates a portable ZIP with a Node launcher. See [the local app guide](local-app/README.md) for installation, storage behavior, testing, and distribution. The Docker/Python instructions below continue to run the original server mode.

## Features

### Assemble

- Upload PDFs into a browser-session source cache by choosing files or dragging PDFs onto the source list.
- Select page ranges directly in the source list.
- Reorder or remove source PDFs.
- Build a new PDF from the current source list.
- Choose immediate PDF downloads or result-code pages using the Docker setting below.

### Edit

- Load and preview a PDF with PDF.js by choosing a file or dragging a PDF onto the Edit PDF section.
- Change preview zoom.
- Inspect, pin, or drag-select PDF coordinates from the preview.
- Apply edit tools immediately.
- Undo recent edits.
- Download the latest edited PDF.

Current edit tools:

- Insert blank page
- Insert image as page
- Append another PDF
- Rotate pages
- Delete pages
- Move pages
- Add page numbers
- Add text overlay with optional wrap width, color, and B/I/U styling
- Add image overlay
- Add circle, rectangle, triangle, pentagon, star, and rounded rectangle shapes with independent fill/border colors and alpha
- Freehand drawing with per-stroke color, width, alpha, and ink/pencil/marker/dry-brush textures

## Run

```bash
docker compose up -d --build
```

This starts APDF and runs the smoke checker once after the APDF container becomes healthy.
Smoke check output is written to:

```text
debug/.log
```

Open:

```text
http://SERVER_IP:8000
```

Restart APDF only:

```bash
docker compose restart apdf
```

Run the smoke checker again:

```bash
docker compose up smoke
```

## Usage

### Assemble PDFs

1. Open `/assemble`.
2. Click **Add PDFs to Sources** or drag PDFs onto the source list.
3. Reorder source PDFs with the up/down buttons if needed.
4. Set the First/Last page range for each source.
5. Remove unwanted sources if needed.
6. Click **Build PDF**.
7. With result-code mode disabled, the PDF downloads immediately. With it enabled, the result page opens with a reusable code and download link.

Page numbers are 1-based.

### Edit a PDF

1. Open `/edit`.
2. Click **Choose PDF to Edit** or drag a PDF onto the Edit PDF section.
3. Select a PDF.
4. Choose a tool from the full-width Tools panel above the preview and detail panels.
5. Configure the tool in the Details panel.
6. Click the tool action button.
7. APDF applies the edit immediately and refreshes the preview.
8. Use **Undo** if needed.
9. Click **Download PDF**.

After an edit, APDF tries to keep the current preview page.

Page range inputs in Edit tools accept `all`, open ranges such as `10-` and `-40`, and empty input as `all`.

## Coordinate-based editing

The preview coordinate display uses:

```text
unit:   PDF point
origin: bottom-left
```

Coordinates are relative to the visible page after applying its CropBox and rotation. Text, images, shapes, page numbers, and the reference size for inserted pages use this same visible area.

Text and image overlay tools can use coordinates selected by clicking the PDF preview. Image overlay can also use a dragged preview box for position and size. Text overlay can use a dragged preview box for position and wrap width.

PDF loading, edits, and Undo run one at a time. A failed preview load preserves the previously opened document. Downloads use the PDF already loaded in the browser, so an open edited document remains downloadable after its server-side job expires.

Once a PDF is open, or while loading/editing/Undo is in progress, the Edit page requests the browser's leave confirmation before refresh, tab close, or navigation. An empty Edit page does not prompt. The browser controls the confirmation wording.

### Insert shapes

1. Select **Shapes** in Edit Tools and choose Circle, Rectangle, Triangle, Pentagon, Star, or Rounded rectangle.
2. Drag on the PDF preview to set the shape's page, position, width, and height. Clicking sets only its bottom-left position; the dimensions can also be entered manually.
3. Set the fill and border colors and their separate alpha values (`0` is transparent; `1` is opaque). Each also has a **Transparent** checkbox. Border width is adjustable; `0` removes it.
4. Click **Add Shape**. Undo and Download PDF work as for other edit tools.

Circles remain round and centered inside the selected box. Other shapes fit the box. Borders stay inside it, and rounded rectangles use a corner radius proportional to their size. Shapes are stored as PDF vectors. [Example](docs/design/shapes-preview.png).

The `overlay_shape` API operation accepts `shape`, `page`, `x`, `y`, `width`, `height`, `fill_color`, `fill_opacity`, `stroke_color`, `stroke_opacity`, and `stroke_width`. Colors accept `null`, `"transparent"`, or `#RGB`, `#RGBA`, `#RRGGBB`, and `#RRGGBBAA`; an embedded color alpha is multiplied by its separate opacity value.

### Freehand drawing

1. Select **Pen**, then set its color, width (`0.1–100 pt`), alpha (`0–1`), and texture: Ink, Pencil, Marker, or Dry brush. The brush sample updates immediately.
2. Draw directly on the preview with a mouse, touch, or stylus. A tap makes a dot. Each stroke keeps the settings used when it started.
3. Switch pages, zoom, or tools as needed; pending strokes stay aligned with their pages.
4. Click **Apply Drawing** to save all pending pages to the PDF together. **Download PDF** also applies pending strokes before downloading.

**Undo stroke** and the main **Undo** button remove the latest pending stroke. **Clear pending** removes the unapplied drawing. After Apply Drawing, the main Undo restores the PDF before that batch was applied. Apply or clear pending strokes before opening another PDF or applying another edit tool.

Brushes are saved as PDF vectors using the same presets as the live preview. Pencil scatters irregular graphite particles; Dry brush uses uneven, wandering bristles with variable paint loading and gaps. Each new stroke gets its own fixed texture pattern, which remains stable through zoom, redraw, and PDF output. Marks follow distance along the stroke rather than mouse-event spacing. Ink and Marker keep their smooth and flat tips. Width stays consistent in PDF points at every zoom. A lower alpha makes translucent marker strokes. Pending drawing remains in browser memory until applied; the Edit leave warning also protects this work. [Preview](docs/design/pen-preview.png) · [Texture comparison](docs/design/pen-texture-comparison.png).

The `overlay_drawing` API operation accepts a `strokes` list. Each stroke contains `page`, `points` (`[[x,y], ...]` in visible page coordinates), `color`, `width`, `opacity`, and `texture` (`ink`, `pencil`, `marker`, or `dry_brush`). Colors support the same hex/transparent formats as shapes. Point centers must be inside the visible page; ink at its edges is clipped. A batch supports up to 200 strokes, 5,000 points per stroke, and 30,000 points in total.

An optional per-stroke `seed` (unsigned 32-bit integer) reproduces a particular grain/bristle pattern. The browser generates and preserves this value; API callers that omit it receive a deterministic pattern derived from the stroke's first point and page. Texture detail is bounded for very long/thin strokes, and completed preview strokes are cached during drawing.

## Storage model

APDF uses temporary storage under:

```text
app/data/
├── clients/   # browser-session source cache
└── jobs/      # generated output jobs
```

Default expiration:

```text
Job outputs:          2 hours
Client source cache:  6 hours
```

## Environment variables

### Assemble output mode

Set **`APDF_ASSEMBLE_RESULT_CODE`** in `docker-compose.yml` or the Compose `.env` file:

| Value | Build behavior |
| --- | --- |
| `false` (default) | Return the assembled PDF immediately. No job or result code is created, and the lookup form is hidden. Temporary output is removed after transfer. |
| `true` | Always save a result job and open its page with a code and download link. The lookup form is visible. Results use the configured job expiration. |

The setting applies to all Assemble builds, regardless of file size or page count. These modes are separate; there is no automatic size-based switch. Both preserve the uploaded source list. Edit downloads and existing job links continue to work. The offline browser and desktop apps always build locally and do not use this Docker setting.

For example, put `APDF_ASSEMBLE_RESULT_CODE=true` in `.env`, then apply it:

```bash
docker compose up -d --build apdf
```

Set it back to `false` and recreate the container to return to direct downloads. `docker compose restart` alone does not apply changed environment variables. `APDF_MAX_INLINE_BYTES` and `APDF_MAX_INLINE_PAGES` now apply only to Edit job metadata, not Assemble routing.

```text
APDF_ASSEMBLE_RESULT_CODE
APDF_JOB_EXPIRE_SECONDS
APDF_CLIENT_EXPIRE_SECONDS
APDF_MAX_INLINE_BYTES
APDF_MAX_INLINE_PAGES
APDF_CODE_LENGTH
APDF_CODE_ALPHABET
APDF_DATA_DIR
APDF_FONTS_DIR
APDF_ACCESS_LOG_DIR
APDF_LOG_TZ
```

## Fonts

For Korean text overlay, place a supported Korean font in `fonts/`.

Recommended:

```text
fonts/NotoSansKR-Regular.ttf
```

Also supported:

```text
fonts/NotoSansCJKkr-Regular.otf
```

## Tool icons

The eleven Edit tool icons are stored under:

```text
app/static/icons/
```

Filenames:

```text
tool-blank.png
tool-image-page.png
tool-append.png
tool-rotate.png
tool-page-number.png
tool-delete.png
tool-move.png
tool-text.png
tool-image-overlay.png
tool-shapes.png
tool-pen.png
```

The set uses transparent 192×192 PNGs, displayed at 48×48 on desktop and 32×32 on small screens, with matching folded white paper, soft blue edges, and cobalt action symbols. The set was generated with the built-in Imagegen tool; the blank-page master served as the style reference for the other icons. Only sizing, transparent padding, and lossless PNG optimization were applied after generation.

The exact generation prompts and delivery settings are saved in [docs/design/edit-tool-icons.json](docs/design/edit-tool-icons.json). See [docs/design/edit-tools-preview.png](docs/design/edit-tools-preview.png) for the complete set on normal and selected backgrounds.

## PDF.js

The Edit page expects:

```text
app/static/pdfjs/pdf.mjs
app/static/pdfjs/pdf.worker.mjs
```

## Smoke check

Docker Compose runs the smoke checker once on startup through the `smoke` service.
The debug directory is mounted into the smoke container, and the latest smoke output is saved at:

```text
debug/.log
```

View smoke logs:

```bash
docker compose logs smoke
```

Run smoke manually on the host:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf --expect-legacy-removed
```

## Current routes

```text
GET  /
GET  /assemble
GET  /edit
GET  /job/{code}
POST /lookup
GET  /download/{code}/{filename}
POST /delete-job/{code}

GET    /api/clients/{client_id}/sources
POST   /api/clients/{client_id}/sources
DELETE /api/clients/{client_id}/sources
DELETE /api/clients/{client_id}/sources/{source_id}

POST /compose
POST /edit/apply
```

Legacy standalone endpoints such as `/merge`, `/extract`, `/delete`, `/rotate`, `/split`, `/overlay/text`, and `/overlay/image` are not part of the current UI workflow.

## Notes

- APDF is intended for trusted internal networks.
- Uploaded source files and generated outputs expire automatically.
- Undo history is temporary and browser-side.
- Result codes are convenient access codes, not strong authentication.
