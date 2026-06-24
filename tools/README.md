# APDF Smoke Check v2

This checker targets the split APDF Python routing model.

It treats these routes as the active public contract:

- `GET /`
- `GET /assemble`
- `GET /edit`
- `GET /api/clients/{client_id}/sources`
- `POST /api/clients/{client_id}/sources`
- `DELETE /api/clients/{client_id}/sources/{source_id}`
- `DELETE /api/clients/{client_id}/sources`
- `POST /compose`
- `POST /edit/apply`
- `GET /job/{code}`
- `POST /lookup`
- `GET /download/{code}/{filename}`
- `POST /delete-job/{code}`

The old standalone form endpoints are no longer part of the default smoke test:

- `POST /merge`
- `POST /extract`
- `POST /delete`
- `POST /rotate`
- `POST /split`
- `POST /overlay/text`
- `POST /overlay/image`

## Run

Start APDF first:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Then run:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf
```

## Optional removed-route check

After deleting the legacy endpoints, you can also assert that they now return `404`:

```bash
python tools/apdf_smoke_check.py \
  --base-url http://127.0.0.1:8000 \
  --pdf tools/test.pdf \
  --expect-legacy-removed
```

## What `/edit/apply` now tests

The checker tests the active edit contract through `/edit/apply` only:

- `insert_blank`
- `insert_image_page`
- `rotate`
- `delete_pages`
- combined operation queue

For each edit test, it verifies:

1. JSON response is `ok: true`.
2. `download_url` returns a real PDF.
3. `/job/{code}` reports `Status: done`.
4. `/download/{code}/edited.pdf` returns a real PDF.
5. When the job message includes `Pages: N -> M`, the expected page-count delta is checked.

The script uses only Python standard-library modules.
