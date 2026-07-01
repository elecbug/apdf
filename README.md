# APDF

APDF is a lightweight internal-network PDF utility server for assembling and editing PDF files.

It is designed for short-lived internal use, not as a long-term document storage system.

## Features

### Assemble

- Upload PDFs into a browser-session source cache by choosing files or dragging PDFs onto the source list.
- Select page ranges directly in the source list.
- Reorder or remove source PDFs.
- Build a new PDF from the current source list.
- Small synchronous results download immediately after Build.

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
- Add text overlay with optional wrap width, color, and B/I/U styling
- Add image overlay

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
7. Small synchronous results download immediately. Larger/background results open the result page.

Page numbers are 1-based.

### Edit a PDF

1. Open `/edit`.
2. Click **Choose PDF to Edit** or drag a PDF onto the Edit PDF section.
3. Select a PDF.
4. Choose a tool from the tool carousel.
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

Text and image overlay tools can use coordinates selected by clicking the PDF preview. Image overlay can also use a dragged preview box for position and size. Text overlay can use a dragged preview box for position and wrap width.

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

```text
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

Tool icons can be placed under:

```text
app/static/icons/
```

Recommended filenames:

```text
tool-blank.png
tool-image-page.png
tool-append.png        # optional; current UI may reuse another document icon
tool-rotate.png
tool-delete.png
tool-move.png
tool-text.png
tool-image-overlay.png
```

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
