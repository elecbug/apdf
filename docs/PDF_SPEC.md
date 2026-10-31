# PDF operation specification

[Documentation index](README.md) · [HTTP transport](API.md)

The specification below covers the shared service in [app/services/pdf](../app/services/pdf/), used by both CPython and the offline worker. JSON examples are individual entries in the `operations` array. Use JSON numbers and booleans with the documented types; avoid depending on incidental Python coercion.

## Document and coordinate invariants

- Input PDFs must have at least one page. The engine tries an empty password for encrypted files; PDFs requiring a supplied password are unsupported.
- Page numbers are 1-based. Edit operations execute sequentially against the evolving page list.
- Distances are PDF points, 1/72 inch. Coordinates are measured from the bottom-left of the upright visible page after CropBox and rotation.
- The engine derives the visible box from the intersection of MediaBox and CropBox, falling back to MediaBox for an invalid intersection. Width/height swap at rotations 90 and 270 degrees.
- Overlays are drawn upright and transformed back into the original page coordinate system. Do not apply an additional rotation/CropBox offset in callers.
- Numeric geometry and opacity must be finite. Image/shape rectangles must fit within visible page bounds. Text validates its starting position and optional wrap width, but does not guarantee every rendered glyph or subsequent line remains inside the page.
- Composition and editing rewrite pages through `PdfWriter`. Preserve original files; document-level features such as signatures, metadata, forms, and outlines are not a preservation guarantee of this application.

For a browser canvas rectangle with top-left `(left, top)` and size `(cw, ch)`, pointer `(px, py)` maps to visible PDF dimensions `(pw, ph)` as:

```text
x = (px - left) / cw * pw
y = (1 - (py - top) / ch) * ph
```

PDF.js viewport geometry, device scaling, preview layout and the controller's active rendered page must remain consistent. See [pdf-preview.js](../app/static/js/edit/pdf-preview.js) and `_merge_visible_overlay` in [editor.py](../app/services/pdf/editor.py).

## Page selection and insertion

`pages` expressions accept `all`, empty-as-all, individual page numbers, comma-separated entries and inclusive ranges. `10-` means through the last page; `-4` means from page 1. The parser returns sorted, deduplicated indices. Reversed ranges, out-of-range values, and a bare `-` are rejected.

For insertion, `position` is `before`, `after`, or `end`. `page` is required for before/after and is not required for end. Reference size means the selected page's visible dimensions, or the last page's dimensions when inserting at the end.

## Structural operations

| Type | Fields and defaults | Important rules |
| --- | --- | --- |
| `insert_blank` | `position: "after"`, `size: "same"`, `page` | `size` is `same`, `a4`, or `letter`. |
| `insert_image_page` | Required `image_id`; `position: "after"`, `fit: "fit"`, `page` | New page uses reference dimensions. `fit` is `fit`, `fill`, or `original`. |
| `append_pdf` | Required `pdf_id`; `position: "after"`, `page` | Inserts all pages of the attachment in its existing order. |
| `rotate` | `pages: ""`, `angle: 90` | Allowed angles: 90, 180, 270 and their negative equivalents. |
| `delete_pages` | `pages: ""` | Rejects deleting all pages. |
| `move_pages` | `pages: ""`, `position: "after"`, `target_page` | Target required unless `end`; must not be in the moved selection. Original selected-page order is retained. |

```json
[
  {"type":"insert_blank","position":"end","size":"a4"},
  {"type":"rotate","pages":"2-3","angle":90},
  {"type":"move_pages","pages":"2-3","position":"before","target_page":1}
]
```

Image pages apply EXIF orientation. `fit` contains the whole image; `fill` covers the page and may crop overflow; `original` uses image DPI, with a 72-DPI fallback. Image-page transparency is flattened onto white. Image overlays use a separate path that preserves supported image transparency.

## Page numbers

```json
{"type":"page_numbers","start_page":1,"start_number":1,"position":"bottom-center","format":"-NN-","numbering_style":"decimal"}
```

| Field | Default and constraints |
| --- | --- |
| `start_page` | `1`; within the current PDF. Numbering continues through the final page. |
| `start_number` | `1`; nonnegative for decimal; at least 1 for alphabetic/Roman styles. |
| `position` | `bottom-center`; top/bottom plus left/center/right, or `top-alternate-left`, `top-alternate-right`, `bottom-alternate-left`, `bottom-alternate-right`. |
| `format` | `N`; each run of `N` inserts the label. Decimal `NN` pads to two digits. Escape a literal N with `\N` (JSON `"\\N"`). |
| `numbering_style` | `decimal`, `upper-alpha`, `lower-alpha`, `upper-roman`, or `lower-roman`. |

Alternating positions begin relative to `start_page`, not the original document's page parity. Alphabetic numbering continues through `Z` to `AA`; Roman conversion follows the implementation and is not a locale-aware formatter.

## Text overlay

```json
{"type":"overlay_text","page":1,"x":36,"y":300,"text":"Review copy","font_size":14,"color":"#2d63c8","opacity":0.8,"bold":true,"italic":false,"underline":false,"max_width":180}
```

Required fields are `page`, `x`, `y` and nonblank `text`. Defaults are font size 14, black, opacity 1, and all style flags false. Font size is an integer from 1 to 300. Color accepts `#RGB` or `#RRGGBB`; text does not use the shape/pen RGBA parser. Opacity is 0–1.

`(x, y)` is the first line's baseline origin. Newline/wrapped lines advance downward with line spacing `font_size * 1.25`. Optional `max_width` must be positive, and `x + max_width` must fit the visible width. Font selection is automatic, not a per-operation font picker. Styles are rendered by the overlay implementation; there are no separately selectable bold/italic font files in this API.

The server tries known filenames in `APDF_FONTS_DIR`, then system Noto locations, and falls back to Helvetica when registration fails. Supported candidates include `NotoSansKR-Regular.ttf`, `NanumGothic-Regular.ttf`, `NotoSansCJKkr-Regular.otf`, and `NotoSansCJK-Regular.ttc`; a candidate must actually be supported by ReportLab's font loader. The local build bundles Nanum Gothic. See [Troubleshooting](TROUBLESHOOTING.md) for missing glyphs.

## Image overlay

```json
{"type":"overlay_image","image_id":"stamp_image","page":1,"x":36,"y":36,"width":144,"height":72,"opacity":0.5}
```

`page`, `image_id`, `x`, `y`, `width`, and `height` are required. Dimensions must be positive, coordinates nonnegative, and the full rectangle must fit. Opacity defaults to 1 and must be 0–1. The UI's aspect-ratio lock changes submitted dimensions; it is not an additional API property.

## Shape overlay

```json
{"type":"overlay_shape","shape":"star","page":1,"x":36,"y":36,"width":120,"height":100,"fill_color":"#2d63c880","fill_opacity":0.5,"stroke_color":"#183b7a","stroke_opacity":1,"stroke_width":2}
```

| Field | Default and constraints |
| --- | --- |
| `shape` | `rectangle`; also `circle`, `triangle`, `pentagon`, `star`, `rounded_rectangle`. |
| `page`, `x`, `y`, `width`, `height` | Required; full rectangle inside the visible page. |
| `fill_color`, `fill_opacity` | `#2d63c8`, `1`. |
| `stroke_color`, `stroke_opacity` | `#183b7a`, `1`. |
| `stroke_width` | `2`; nonnegative. If the border is visible, it must be smaller than both dimensions. |

Shape and pen colors accept `null`, `"transparent"`, `#RGB`, `#RGBA`, `#RRGGBB`, and `#RRGGBBAA`. Embedded alpha multiplies the separate opacity, which must independently be 0–1. In the example, fill alpha is `(128/255) * 0.5`. A transparent paint, zero alpha, or zero border width suppresses the corresponding drawing.

Borders are inset to stay inside the selected box. Circles use the smaller drawable dimension and remain centered. Rounded rectangles use a radius of 18% of the smaller drawable dimension. Triangle, pentagon and star vertices are generated as PDF vector paths. Both paints may be invisible; this is accepted and produces no visible mark.

## Freehand drawing

```json
{
  "type":"overlay_drawing",
  "strokes":[
    {"page":1,"points":[[36,100],[60,110],[90,100]],"color":"#2d63c8","width":4,"opacity":0.8,"texture":"pencil","seed":123456}
  ]
}
```

| Property | Contract |
| --- | --- |
| `strokes` | Required nonempty array; maximum 200 strokes per operation. |
| `page` | Required integer, not a boolean; within the current PDF. |
| `points` | 1–5,000 `[x,y]` pairs per stroke; maximum 30,000 supplied points in the batch. |
| `width` | Default 3; 0.1–100 points. |
| `color`, `opacity` | Default `#2d63c8`, `1`; shared RGBA/transparent rules. |
| `texture` | Default `ink`; `ink`, `pencil`, `marker`, or `dry_brush`. |
| `seed` | Optional integer 0–4,294,967,295, not a boolean. |

Point centers must lie inside visible page bounds, including the edges. Consecutive duplicates are removed after point-count validation; a single point produces a dot. Marks extending beyond an edge are clipped. Stroke settings and seeds are preserved independently across pages in a batch.

Pencil uses irregular graphite marks; Dry brush uses uneven wandering bristles and gaps. Texture placement follows traveled distance rather than event count. A supplied seed reproduces geometry across JavaScript preview and Python output; omission uses a deterministic seed derived from the first point and page. The browser generates random per-stroke seeds and keeps them stable afterward. Width/texture are explicit settings; pressure sensitivity is not implemented.

Brush presets live in [pen-brush-presets.json](../app/static/pen-brush-presets.json). JavaScript and Python texture algorithms must remain equivalent; see [Extending](EXTENDING.md) and [Testing](TESTING.md).
