# APDF

APDF is a lightweight internal-network PDF utility server for assembling and editing PDF files.

It is designed for short-lived internal use, not as a long-term document storage system.

## What APDF can do

APDF currently provides two main workflows:

* **Assemble PDFs**

  * Upload multiple PDF files into a browser-session source cache.
  * Select page ranges from uploaded sources.
  * Build a new PDF from the selected ranges in order.
  * Download the generated PDF using a result code.

* **Edit a PDF**

  * Load a PDF file in the Edit page.
  * Preview the PDF in the browser.
  * Inspect PDF point coordinates by moving the pointer over the preview.
  * Click the preview while using **Add Text** to fill the target page and coordinates automatically.
  * Queue edit operations.
  * Apply edits and continue previewing the edited result.
  * Undo the last applied edit batch while the page remains open.
  * Download the edited PDF directly.

Current edit operations include:

* Insert blank pages
* Insert PNG/JPEG/WebP images as PDF pages
* Rotate selected pages
* Delete selected pages
* Move selected pages
* Add text at PDF preview coordinates
* Undo the last applied edit batch

## Run

Start APDF with Docker Compose:

```bash
docker compose up -d --build
```

Open APDF in a browser:

```text
http://SERVER_IP:8000
```

## Restart

Restart the running service:

```bash
docker compose restart
```

After code changes, rebuild and restart:

```bash
docker compose up -d --build
```

## Basic usage

### 1. Assemble PDFs

Open the Assemble page:

```text
http://SERVER_IP:8000/assemble
```

Steps:

1. Click **Add PDFs to Sources**.
2. Select one or more PDF files.
3. In **Source PDFs**, set the first and last page numbers.
4. Click **Add** to add that page range to the Assembly list.
5. Repeat until the Assembly list contains all desired ranges.
6. Reorder or remove Assembly items if needed.
7. Click **Build PDF**.
8. Open the result page and download the generated PDF.

Page numbers are 1-based.

### 2. Edit a PDF

Open the Edit page:

```text
http://SERVER_IP:8000/edit
```

Steps:

1. Click **Choose PDF to Edit**.
2. Select a PDF file.
3. Preview the PDF in the left panel.
4. Move the pointer over the preview to inspect PDF coordinates. Click the preview to pin the current coordinate until the pointer leaves the preview.
5. Choose an operation in the right panel:

   * **Blank Page**
   * **Insert Image**
   * **Rotate Pages**
   * **Delete Pages**
   * **Move Pages**
   * **Add Text**
6. Configure the operation.
7. Click the operation add button to add it to the edit queue.
8. Click **Apply Edits**.
9. The preview updates to the edited PDF.
10. Click **Undo** to restore the previous preview state if needed.
11. Click **Download PDF** to download the latest edited result.

The Edit page is designed for iterative editing. After applying edits, the edited PDF becomes the new current preview target. Undo history is browser-memory state and is reset when a new PDF is loaded or the page is refreshed. Text insertion uses PDF point coordinates with the origin at the bottom-left of the target page.

## Smoke check

APDF includes a lightweight endpoint smoke checker for verifying that the current URL, JSON, and multipart contracts still work after refactoring.

Run APDF first:

```bash
docker compose up -d --build
```

Then run the checker with a small PDF file:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf
```

The checker covers the current public workflow endpoints:

```text
GET    /
GET    /assemble
GET    /edit
GET    /api/clients/{client_id}/sources
POST   /api/clients/{client_id}/sources
DELETE /api/clients/{client_id}/sources/{source_id}
DELETE /api/clients/{client_id}/sources
POST   /compose
POST   /edit/apply
GET    /job/{code}
POST   /lookup
GET    /download/{code}/{filename}
POST   /delete-job/{code}
```

For `/edit/apply`, it checks blank-page insertion, image-page insertion, rotation, page deletion, page movement, text overlay, and a combined edit queue.

If legacy standalone endpoints have been removed, this optional check verifies they return `404`:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf --expect-legacy-removed
```

## Result codes

Generated outputs are stored as short-lived jobs.

A result code can be used to reopen a generated result:

1. Enter the result code in the top-right input box.
2. Click **Open**.
3. Download or delete the result from the result page.

Result codes are not intended as permanent links.

## Storage model

APDF uses two short-lived storage areas:

```text
app/data/
├── clients/   # browser-session source cache
└── jobs/      # generated output jobs
```

### Browser-session source cache

The Assemble page uses a browser-session source cache:

1. The browser creates and stores `apdf_client_id` in `localStorage`.
2. Uploaded source PDFs are stored under:

```text
app/data/clients/<client_id>/sources/
```

3. If the user reloads the page or goes back to the page, APDF restores the source list while the server-side cache is still alive.
4. The browser cannot repopulate file inputs after reload, so APDF restores the uploaded source list from the server-side cache instead.

This cache is temporary and browser-bound.

### Job output storage

Generated outputs are stored as jobs under:

```text
app/data/jobs/
```

Jobs are accessed by result code and expire automatically.

## Default expiration

Default expiration values:

```text
Job outputs:          2 hours
Client source cache:  6 hours
```

These values can be changed with environment variables.

## Environment variables

```text
APDF_JOB_EXPIRE_SECONDS       Job output lifetime in seconds
APDF_CLIENT_EXPIRE_SECONDS    Browser-session source cache lifetime in seconds
APDF_MAX_INLINE_BYTES         Inline processing size threshold
APDF_MAX_INLINE_PAGES         Inline processing page threshold
APDF_CODE_LENGTH              Result code length
APDF_CODE_ALPHABET            Characters used for result codes
APDF_DATA_DIR                 Data directory path
APDF_FONTS_DIR                Font directory path
APDF_ACCESS_LOG_DIR           Access log directory path
APDF_LOG_TZ                   Log timezone
```

## PDF.js files

The Edit page uses PDF.js for browser-side PDF preview.

The expected static file paths are:

```text
app/static/pdfjs/pdf.mjs
app/static/pdfjs/pdf.worker.mjs
```

If the Dockerfile uses `pdfjs-dist`, these files can be copied automatically during image build.

## Notes

* APDF is intended for internal-network use.
* APDF is not a long-term document management system.
* Uploaded source files and generated outputs expire automatically.
* For sensitive documents, use APDF only on a trusted internal network.
* Result codes are convenient access codes, not strong authentication.
* Delete generated jobs manually when they are no longer needed.
