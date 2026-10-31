# APDF Local

For an app that requires **no Node.js, Python, separate browser, or server setup**, use the [desktop distribution](../desktop/README.md). It includes every runtime and works offline from its first launch. The commands below are for the browser/static-server variant.

APDF's existing editor and assembler as a local, offline web app. React owns the application shell. Shared editor controllers and templates provide the tools. Shared Python PDF services run in a Pyodide Web Worker; PDF.js renders previews. No PDF processing API or Python server is used.

## Run

Install Node.js 22.12+ and a current browser, then run from the repository root:

```bash
npm ci
npm run local
```

Open **http://127.0.0.1:4173**. The first build downloads pinned dependencies, a Korean font, and the browser Python runtime. All runtime assets are then bundled locally; opening and using the app requires no internet access. The local HTTP process serves static app files and accepts only GET/HEAD requests. PDFs enter the app through browser file selection or drag and drop.

Wait for **Ready for offline use** in the footer before stopping the local server. Then reloads, PDF editing, and assembly work offline in that browser. Use **Install app** when your browser offers installation. The offline cache and stored PDFs belong to that address, port, and browser profile. Browsers can evict site data; keep downloaded originals and results.

To change the port on macOS/Linux:

```bash
APDF_LOCAL_PORT=4174 npm run preview:local
```

On PowerShell, set `$env:APDF_LOCAL_PORT = '4174'` before the command. `npm run preview:local` serves an existing build. `npm run dev:local` runs Vite for development; service worker caching is disabled there.

## Portable distribution

```bash
npm run package:local
```

This creates `local-app/releases/apdf-local.zip`. Extract it, run `node start.mjs`, and open the local address. The recipient needs Node and a browser; Python, Docker, npm installation, and internet are unnecessary. Opening `index.html` directly through `file://` does not support workers and service workers; use the included launcher or a static HTTP server on localhost.

`local-app/dist` is also a complete static distribution. Relative asset paths allow hosting under a subdirectory. Localhost and HTTPS support offline caching. No hosting or publishing is configured.

## Files and privacy

- All 11 edit tools are included: blank/image pages, append, rotate, page numbers, delete/move pages, text, images, six shapes, and four freehand brushes.
- Korean text uses bundled Nanum Gothic. Existing PDF fonts are preserved.
- Edit files, pending strokes, and Undo history stay in memory. Download before leaving; the editor displays the native refresh/leave warning. Reloading does not restore an edit session.
- Assemble stores source PDFs in IndexedDB. Order and page ranges use localStorage. **Clear Sources** deletes those source files; clearing site data also removes them.
- Generated results download directly. There are no remote uploads, result codes, accounts, analytics, or runtime CDN dependencies. The content security policy limits connections to the local origin.
- Large PDFs consume device memory. Password protected PDFs follow the existing engine's restrictions.

## Verification

```bash
npm run test:local
npm run build:local
npm run preview:local
# In another terminal (Python dependencies from app/requirements.txt are needed for test fixtures):
APDF_TEST_PYTHON=python3 npm run test:local:browser
```

Install the test browser once with `npx playwright install chromium` if needed. Browser checks disconnect the network, reload the app, exercise every edit tool, extract text from downloaded PDFs, and verify Korean text, all shapes and brushes, Undo, pending drawing downloads, leave warnings, source persistence/ranges, failed batch rollback, clearing sources, and mobile layout. They reject external requests or PDF API calls. Test screenshots are saved under `docs/design/local-app-*.png`.

The FastAPI app remains available through the original Docker/Python commands. Both modes use `app/services/pdf` and `app/static/pen-brush-presets.json`, avoiding separate brush and PDF implementations. `prepare.mjs` packages these services and renders shared Jinja-compatible templates at build time using Nunjucks, so building the local app itself does not require Python. Generated runtime assets, dependency caches, and distribution archives are ignored by Git; versions are pinned in `package-lock.json`.
