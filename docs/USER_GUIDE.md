# User guide

[Documentation index](README.md)

## Choose and open an edition

| Edition | Start here |
| --- | --- |
| Server | Open the address supplied by the operator, normally `http://SERVER_IP:8000`. Files are uploaded to that server for processing. |
| Local web | Open `http://127.0.0.1:4173` after starting the static launcher. PDF processing stays in the browser. |
| Desktop | Open the Windows portable EXE, the extracted Linux executable, or the macOS app matching your OS and CPU. All runtime components are included. |

For desktop archives, extract and retain the complete application folder. The desktop edition works offline from its first launch. The local web edition can reload offline after its footer says **Ready for offline use**; keep the same browser profile, address, and port. Installation through **Install app** is available only when the browser offers it. See [Deployment](DEPLOYMENT.md) for starting and distributing each edition.

## Assemble PDFs

1. Open **Assemble**.
2. Click **Add PDFs to Sources** or drag PDFs onto Sources. Multiple PDFs can be added together.
3. Use the up/down arrows to set document order.
4. Enter inclusive **First** and **Last** page numbers for each source. Page numbers start at 1.
5. Remove unwanted sources, then click the Build button.

The output contains each selected range in the displayed source order. Build preserves the source list. **Remove** deletes one cached source; **Clear Sources** removes all cached sources for this workspace. Neither action deletes your original file from its original folder or an already downloaded PDF.

### Server output modes

The operator chooses the mode; there is no per-user mode selector.

| Setting | What happens after Build |
| --- | --- |
| `APDF_ASSEMBLE_RESULT_CODE=false` (default) | **Build PDF** downloads the PDF immediately. No result code or stored result job is created. The code lookup form is hidden. |
| `APDF_ASSEMBLE_RESULT_CODE=true` | **Build & Get Result Code** opens a result page. Download from that page and retain the code to reopen it before expiration. |

There is no automatic switch based on PDF size or page count. The code mode still builds the PDF during the request; a result page is not a background task queue.

In code mode, enter a saved code in the header and click **Open**. **Delete Now** deletes that stored result; it does not delete cached source PDFs. Sources and results have separate expiration rules. See [Configuration](CONFIGURATION.md).

The local web and desktop editions always build locally and use direct downloads or native save dialogs. They do not issue result codes.

## Edit a PDF

1. Open **Edit** and choose a PDF or drop one onto **Edit PDF**.
2. Use the page controls and zoom selector to inspect the preview. **Fit width** adapts a wide page to the preview pane.
3. Select a tool from the horizontal toolbar and configure its details.
4. Click that tool's action button. A successful operation replaces the current preview.
5. Use **Undo** to restore a previous committed PDF, up to the current in-memory history limit of 20 snapshots.
6. Click **Download PDF** to keep the current result. Desktop opens a native PDF save dialog.

The browser requests leave confirmation when a PDF is loaded or an operation is busy. Desktop shows **Stay / Leave**. This is a warning, not automatic saving: reload, closing, or leaving Edit discards its current PDF, pending drawing, and Undo history. An empty, idle editor does not prompt.

Downloads use the current PDF in browser memory. An already loaded edited PDF can still be downloaded after its server result has expired.

## Available tools

| Tool | Use |
| --- | --- |
| Blank | Insert an empty page before/after a page or at the end; choose the reference size, A4, or Letter. |
| Img Page | Insert PNG, JPEG, or WebP as a new page with Fit, Fill, or Original sizing. |
| Append | Insert all pages from another PDF at the selected position. |
| Rotate | Rotate selected pages in 90-degree increments. |
| Page Numbers | Set the first page, starting number, position, format, and numbering style. |
| Delete | Delete selected pages; deleting every page is rejected. |
| Move | Move selected pages before/after another page or to the end. |
| Text | Add text with color, alpha, size, optional wrapping width, and bold/italic/underline. |
| Image | Place an image onto a page with dimensions, opacity, and an optional aspect-ratio lock. |
| Shapes | Add circle, rectangle, triangle, pentagon, star, or rounded rectangle. |
| Pen | Draw with Ink, Pencil, Marker, or Dry brush. |

Edit page selections accept expressions such as `all`, `2`, `2,4-6`, `10-`, or `-4`. An empty selection means all pages. Move preserves the document order of selected pages; it does not interpret `5,2` as a custom reorder command. The move destination cannot be inside the moved selection.

## Place text, images, and shapes

Coordinates are in PDF points, with `(0, 0)` at the bottom-left of the **visible, rotated page**. One point is 1/72 inch. Preview zoom does not change the PDF coordinate system.

- Click to fill position fields. Drag a box to fill a region for the active tool.
- Text dragging sets the first baseline position and optional wrap width; text lines continue downward. Use a higher Y coordinate for text near the top.
- Image and shape dragging sets their bottom-left position, width, and height. Numeric fields can be adjusted afterward.
- A circle remains round and centered inside the box. Other shapes use the box's dimensions.
- Shapes have independent fill and border colors, alpha values, and transparent switches. Alpha `0` is invisible and `1` is opaque. Border width `0` removes the border.

For Text, `Ctrl+B/I/U` or `Cmd+B/I/U` toggles styling while editing its text field. These add new PDF content; they do not edit text already embedded in the original PDF.

## Draw with the pen

1. Select **Pen**, choose color, width, alpha, and texture, and inspect the brush sample.
2. Draw using mouse, touch, or stylus. A tap makes a dot.
3. Change pages, zoom, or tools as needed; pending strokes stay associated with their pages.
4. Click **Apply Drawing** to commit the pending batch. **Download PDF** also applies pending strokes before downloading.

Each stroke retains the settings used when it started. Pencil and Dry brush retain a fixed, irregular texture pattern through redraw, zoom, and PDF output. The pen does not currently vary width from stylus pressure.

**Undo stroke** or the main **Undo** removes the latest pending stroke. **Clear pending** removes only unapplied strokes. Once committed, main Undo restores the PDF before that drawing batch. Apply or clear pending strokes before opening a different PDF or using another edit action.

## What survives a reload?

| State | Server | Local web | Desktop |
| --- | --- | --- | --- |
| Cached Assemble PDFs | On the server until cache expiration/deletion; identified by browser localStorage | Browser IndexedDB | Electron profile IndexedDB |
| Assemble order | Browser localStorage when available | Browser localStorage | Electron profile localStorage |
| Assemble page ranges | Current page memory; recheck after navigation/reload | Persisted when storage is available | Persisted when storage is available |
| Current Edit PDF, pending pen strokes, Undo | Memory only | Memory only | Memory only |
| Downloaded files | Your chosen download location | Your chosen download location | Your chosen save location |

Clearing browser site data can detach the browser from its server cache or delete local source PDFs. Private browsing, storage restrictions, eviction, and a changed address/port/profile affect restoration. Desktop uses a separate profile from your normal browser.

Password entry, OCR, editing existing PDF text, and restoring an unsaved Edit session are not implemented. Large files are limited by available device/server memory and storage; see [Troubleshooting](TROUBLESHOOTING.md).
