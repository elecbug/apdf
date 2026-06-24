# APDF Smoke / Contract Checker

This checker verifies the current APDF HTTP contract against a running APDF server.
It uploads a small PDF, calls the source-cache APIs, builds a composed PDF, applies an edit operation, checks job pages/downloads, and optionally checks the legacy form endpoints.

## Run

Start APDF first:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Then run:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf
```

The script uses only the Python standard library. No `requests` or `httpx` dependency is required.

## Useful options

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf --skip-legacy
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf --fail-fast --debug
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf --keep-jobs
```

## Covered endpoints

- `GET /`
- `GET /assemble`
- `GET /edit`
- `GET /api/clients/{client_id}/sources`
- `POST /api/clients/{client_id}/sources`
- `DELETE /api/clients/{client_id}/sources/{source_id}`
- `DELETE /api/clients/{client_id}/sources`
- `POST /compose`
- `POST /edit/apply`
- `POST /lookup`
- `GET /job/{code}`
- `GET /download/{code}/{filename}`
- `POST /delete-job/{code}`
- `POST /merge`
- `POST /extract`
- `POST /delete`
- `POST /rotate`
- `POST /split`
- `POST /overlay/text`
- `POST /overlay/image`

## Notes

The checker validates transport-level and contract-level behavior, not pixel-perfect PDF contents. For generated files it checks that the server returns a downloadable response beginning with `%PDF-`.
