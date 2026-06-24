# APDF Smoke Checker

`apdf_smoke_check.py` is a lightweight endpoint smoke/contract checker for APDF.

It is intended to be run after route/service refactoring to confirm that the current browser-facing contracts still work. It uses only the Python standard library.

## Run

Start APDF first:

```bash
docker compose up -d --build
```

Run the checker:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf
```

## Checked endpoints

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

## Checked edit operations

`/edit/apply` is checked with these operation payloads:

```text
insert_blank
insert_image_page
rotate
delete_pages
move_pages
combined queue
```

The checker verifies that each edit call returns `ok=true`, that the reported job is `done`, and that `/download/{code}/edited.pdf` returns a valid PDF response. For page-count-changing edits, it also checks the `Pages: N -> M` transition in the job message.

## Optional legacy removal check

If the legacy standalone form endpoints were intentionally removed, run:

```bash
python tools/apdf_smoke_check.py --base-url http://127.0.0.1:8000 --pdf tools/test.pdf --expect-legacy-removed
```

This checks that these old endpoints return `404`:

```text
/merge
/extract
/delete
/rotate
/split
/overlay/text
/overlay/image
```

## Useful options

```text
--keep-jobs    Do not delete generated jobs after each check. Useful for manual inspection.
--fail-fast    Stop at the first failed step.
--debug        Print a traceback if the checker crashes.
--timeout N    HTTP timeout in seconds.
```
