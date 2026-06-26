# APDF Smoke Check v4

This smoke checker targets the current APDF routing model after the Python split and Edit utility updates.

It verifies:

- Core HTML pages
- Edit page UI control IDs, including Preview Zoom controls
- Browser-session source cache APIs
- `/compose`
- `/edit/apply` operations:
  - `insert_blank`
  - `insert_image_page`
  - `rotate`
  - `delete_pages`
  - `move_pages`
  - combined operation queue
- Job result page
- PDF download endpoint
- Optional removal of legacy standalone endpoints

## Usage

Run APDF first:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then run:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf test.pdf
```

To also verify that legacy endpoints are removed:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf test.pdf --expect-legacy-removed
```

Preview Zoom is a frontend-only feature. The checker therefore verifies that the Edit page exposes the expected zoom control IDs rather than sending a backend request.
