# APDF Smoke Check v7

This smoke checker targets the current APDF routing model after the Python split and Edit utility updates.

It verifies:

- Core HTML pages
- Edit page UI control IDs, including drag-and-drop target, Preview Zoom, coordinate inspector, Append PDF, Add Text, Add Image, and Undo controls
- Browser-session source cache APIs
- `/compose`
- `/edit/apply` operations:
  - `insert_blank`
  - `insert_image_page`
  - `append_pdf`
  - `rotate`
  - open range syntax such as `1-`, `-1`, `all`, and empty-as-all behavior
  - `delete_pages`
  - `move_pages`
  - `overlay_text`
  - `overlay_image`
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

Preview Zoom, the coordinate inspector, and Undo are frontend-only features. The current Edit UI applies one operation immediately from the selected tool detail panel, while `/edit/apply` still accepts an operation list. Text/image overlays and Append PDF are tested through `/edit/apply`; automatic coordinate filling and drag-and-drop targets are verified by checking the page control IDs. The checker therefore verifies that the Edit page exposes the expected control IDs as well as backend edit contracts.
