# APDF

APDF is a lightweight internal-network PDF utility server.

## Current UI model

APDF uses a browser-session source cache:

1. The browser creates/stores `apdf_client_id` in `localStorage`.
2. PDFs are uploaded to `/data/clients/<client_id>/sources/`.
3. The source list is restored with the same browser after Back/reload while the cache is alive.
4. The Assembly panel sends a `source_id` + page range plan to `/compose`.
5. The generated result is stored as a normal Job and can be downloaded by result code.

This is intentionally not a long-term document store.

## Features

- Upload PDFs into browser-session source cache
- Restore source rows after Back/reload
- Assemble arbitrary page ranges from stored sources
- Result-code based download
- Existing utility endpoints for merge, extract, delete, rotate, split, text overlay, and image overlay

## Run

```bash
docker compose up -d --build
```

Open:

```text
http://SERVER_IP:8080
```

## Restart

```bash
docker compose restart
```

After code changes:

```bash
docker compose up -d --build
```

## Storage

```text
app/data/
├── clients/   # browser-session source cache
└── jobs/      # generated output jobs
```

Default expiration:

- Job outputs: 2 hours
- Client source cache: 6 hours

Environment variables:

```text
APDF_JOB_EXPIRE_SECONDS
APDF_CLIENT_EXPIRE_SECONDS
APDF_MAX_INLINE_BYTES
APDF_MAX_INLINE_PAGES
APDF_CODE_LENGTH
APDF_CODE_ALPHABET
```
