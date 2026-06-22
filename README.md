# APDF

APDF is a lightweight internal PDF utility server for laboratory use.

## Features

- Merge PDFs
- Split PDF by ranges
- Extract pages
- Delete pages
- Rotate pages
- Text overlay by coordinates
- Image overlay by coordinates
- 8-character job code based retrieval
- Automatic expiration cleanup

## Run with Docker

```bash
docker compose up -d --build
```

Open:

```text
http://SERVER_IP:8080
```

## Korean font

The Docker image installs `fonts-noto-cjk`. You may also mount custom fonts into `./fonts`.

Preferred optional filename:

```text
fonts/NotoSansKR-Regular.ttf
```

## Notes

- This is an internal utility, not a document management system.
- Do not expose it directly to the public Internet.
- For sensitive documents, place it behind Nginx Basic Auth and avoid logging filenames or document contents.
