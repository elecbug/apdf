# HTTP API reference

[Documentation index](README.md)

This reference applies to the **Python server**. APDF Local web and desktop do not expose these processing endpoints; their local adapter uses similar method names inside the app. Examples use `http://127.0.0.1:8000` and placeholder IDs. Replace source IDs and result codes with values returned by your server.

FastAPI also provides `/docs` and `/openapi.json`. Some request bodies are parsed manually, so the operation and response details below are more explicit than the generated schema.

## Conventions

- Page numbers are 1-based and ranges are inclusive.
- Send JSON with `Content-Type: application/json`; upload files with multipart form data.
- API clients should use a stable client ID containing 8–80 ASCII letters, digits, `_` or `-`, such as a UUID. The server sanitizes IDs; they are cache identifiers, not credentials.
- Source IDs are generated uppercase strings. Result codes are separate job identifiers and normalize to uppercase on lookup.
- Typical errors are HTTP 400 with `{"ok":false,"error":"..."}` for composition/editing or `{"detail":"..."}` for source and job routes. Missing required form fields can produce FastAPI's HTTP 422 response.
- No application authentication is implemented. Restrict access at the deployment boundary as appropriate for the server's trusted-network use.

## Route summary

| Method | Path | Response |
| --- | --- | --- |
| GET | `/` | 303 to `/assemble` |
| GET | `/assemble`, `/edit` | HTML application pages |
| GET | `/api/clients/{client_id}/sources` | JSON source list |
| POST | `/api/clients/{client_id}/sources` | JSON metadata for the newly uploaded batch |
| DELETE | `/api/clients/{client_id}/sources/{source_id}` | JSON success; 404 if missing |
| DELETE | `/api/clients/{client_id}/sources` | JSON success; clears the source cache |
| POST | `/compose` | PDF attachment or JSON result reference, selected by server configuration |
| POST | `/edit/apply` | JSON result reference and download URL |
| GET | `/job/{code}` | HTML result page; 404 if missing/expired |
| POST | `/lookup` | 303 to normalized `/job/{code}` |
| GET | `/download/{code}/{filename}` | PDF attachment; filename must be in job outputs |
| POST | `/delete-job/{code}` | Delete the job if present; 303 to `/` |

The legacy `/merge`, `/extract`, `/delete`, `/rotate`, `/split`, `/overlay/text`, and `/overlay/image` routes are absent. Use the current composition/edit APIs.

## Source files

Upload one or more multipart fields named `files`:

```bash
curl --fail \
  -F 'files=@first.pdf;type=application/pdf' \
  -F 'files=@second.pdf;type=application/pdf' \
  http://127.0.0.1:8000/api/clients/example-client-001/sources
```

Each upload must have a `.pdf` filename and parse as a nonempty PDF. The whole batch is validated before publication. A failed batch removes new staged files and preserves existing sources.

```json
{
  "sources": [
    {
      "source_id": "ABCDEFGHJK",
      "name": "first.pdf",
      "filename": "ABCDEFGHJK.pdf",
      "pages": 3,
      "size": 1620,
      "created_at": "2026-10-31T00:00:00+00:00"
    }
  ]
}
```

GET returns all cached sources using the same item shape; POST returns only newly added items. Metadata `filename` is a storage name, not an original host filesystem path. List/load activity refreshes the cache's last-used marker. Deleting sources does not delete generated results.

## Compose

POST `/compose` with a nonempty `plan`. Each item requires a known source ID and an inclusive `start`/`end` range within that source. List order determines output order. A source can appear multiple times to repeat ranges.

Example `plan.json`:

```json
{
  "client_id": "example-client-001",
  "plan": [
    {"source_id": "ABCDEFGHJK", "start": 2, "end": 3},
    {"source_id": "KLMNPQRSTU", "start": 1, "end": 1}
  ]
}
```

The server selects its configured mode; request fields such as `mode` or `result_code` cannot override it. Both modes execute composition before returning. Validation errors produce HTTP 400 JSON.

### Direct mode: `APDF_ASSEMBLE_RESULT_CODE=false`

Success is HTTP 200 with `Content-Type: application/pdf`, attachment filename `assembled.pdf`, and `Cache-Control: no-store`. It is **not JSON**. No job metadata or result code is created. The temporary output is removed after transfer.

```bash
curl --fail \
  -H 'Content-Type: application/json' \
  --data @plan.json \
  --output assembled.pdf \
  http://127.0.0.1:8000/compose
```

### Result-code mode: `APDF_ASSEMBLE_RESULT_CODE=true`

Success is HTTP 200 JSON. It deliberately omits `download_url`, so the browser opens the result page rather than downloading automatically.

```json
{
  "ok": true,
  "code": "ABCDEFGH",
  "mode": "job",
  "url": "/job/ABCDEFGH",
  "filename": "assembled.pdf"
}
```

Open `url` as an HTML page or download `/download/ABCDEFGH/assembled.pdf`. The stored job expires according to the server setting. A processing failure after job creation returns HTTP 400 with `ok: false`, `error`, `code`, and `url`; validation failures before job creation have no code.

Clients supporting both modes must inspect the HTTP status and content type. [requestAssembly](../app/static/js/assemble/build.js) is the browser implementation. `APDF_MAX_INLINE_*` thresholds do not affect this contract.

## Apply edit operations

POST `/edit/apply` uses multipart fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `pdf` | File | Current PDF, with a `.pdf` filename and PDF header. |
| `operations` | String containing JSON | Nonempty array of operation objects. |
| A referenced `image_id` | File | PNG/JPEG/WebP attachment for image insertion or overlay. |
| A referenced `pdf_id` | File | PDF attachment for `append_pdf`. |

Use attachment IDs with 3–80 letters, digits, `_` or `-`. The multipart field name must match its operation's ID. IDs are sanitized by the server; avoid punctuation rather than relying on normalization.

Example text and shape operation batch:

```bash
curl --fail \
  -F 'pdf=@input.pdf;type=application/pdf' \
  -F 'operations=[{"type":"overlay_text","page":1,"x":36,"y":720,"text":"Review copy","font_size":14},{"type":"overlay_shape","shape":"rectangle","page":1,"x":36,"y":36,"width":120,"height":60,"fill_color":"#2d63c8","fill_opacity":0.25}]' \
  http://127.0.0.1:8000/edit/apply
```

Coordinates must fit the actual document. The example's Y coordinate requires a sufficiently tall visible page. A multipart image example is:

```bash
curl --fail \
  -F 'pdf=@input.pdf;type=application/pdf' \
  -F 'stamp_image=@stamp.png;type=image/png' \
  -F 'operations=[{"type":"overlay_image","image_id":"stamp_image","page":1,"x":36,"y":36,"width":72,"height":72,"opacity":0.8}]' \
  http://127.0.0.1:8000/edit/apply
```

Successful edits always return JSON with a downloadable stored job, independent of the Assemble setting:

```json
{
  "ok": true,
  "code": "ABCDEFGH",
  "url": "/job/ABCDEFGH",
  "download_url": "/download/ABCDEFGH/edited.pdf",
  "filename": "edited.pdf"
}
```

Fetch `download_url` separately for the PDF. On failure, HTTP 400 contains `ok: false`, `error`, and the failed job's code/URL. Operations execute in list order against the result of previous operations; page numbers can therefore change between operations. The API accepts a batch even though the UI usually submits one action at a time. See [PDF operation specification](PDF_SPEC.md) for all 11 operation schemas.

## Result pages and deletion

`POST /lookup` accepts URL-encoded form field `code`, strips surrounding whitespace, uppercases it, and redirects. The destination GET performs existence and expiration checks.

```bash
curl -i --data-urlencode 'code=abcdefgh' http://127.0.0.1:8000/lookup
```

`GET /job/{code}` is HTML, not a polling JSON status endpoint. Results use `created`, `done`, and `failed` metadata states; there is no asynchronous worker queue. `GET /download/{code}/{filename}` requires a filename listed in the job's output metadata.

`POST /delete-job/{code}` redirects even if the job is already absent. It removes job inputs, output and metadata, not the client source cache. Old Edit/result URLs can remain usable when Assemble code mode is disabled, because that toggle controls new Assemble behavior and its lookup UI rather than removing shared job routes.
