# Development guide

[Documentation index](README.md)

All commands start from the repository root unless stated otherwise. POSIX shell examples use `python3`; on Windows use an available Python executable, the virtual environment's `Scripts` paths, and PowerShell environment assignment.

## Choose the development target

| Target | Development prerequisites | Runtime for end users |
| --- | --- | --- |
| Server APIs / Jinja UI | Python 3.12 is the Docker baseline; `app/requirements.txt` | Running server plus browser |
| Server Edit preview assets | Node/npm to stage PDF.js, or the Docker build | Browser; Node is not in the final Python image |
| Local web / desktop source builds | Node.js 22.12+ and npm; project Node CI uses 24 | Local web needs a browser; desktop bundles its runtime |
| Browser fixture generation | Python project dependencies plus Playwright | Test-only requirement |
| Docker deployment | Docker daemon and Compose access | Docker on the server host |

Dependency pins describe the repository's supported build, not a claim that each package is the latest upstream release. Python dependencies are in `app/requirements.txt`; JavaScript pins and the resolved graph are in `package.json` and `package-lock.json`.

## Python server

```bash
python3 -m venv venv
. venv/bin/activate
python -m pip install -r app/requirements.txt
APDF_DATA_DIR=/tmp/apdf-dev-data \
APDF_ACCESS_LOG_DIR=/tmp/apdf-dev-data/logs \
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open `/assemble`; `/docs` is FastAPI's interactive API explorer. Use separate temporary data directories for experiments and tests so they do not share real source caches or jobs. `APDF_DATA_DIR` alone does not relocate the audit writer; set `APDF_ACCESS_LOG_DIR` too.

For a native Python server, Edit also needs matching PDF.js core/worker assets under `app/static/pdfjs`. Docker generates them automatically. To stage the installed npm version for development:

```bash
npm ci
mkdir -p app/static/pdfjs
cp node_modules/pdfjs-dist/build/pdf.mjs app/static/pdfjs/pdf.mjs
cp node_modules/pdfjs-dist/build/pdf.worker.mjs app/static/pdfjs/pdf.worker.mjs
```

These copied vendor files are generated development assets; do not accidentally commit them as application source. Server browser tests can inject a PDF.js package with `APDF_TEST_PDFJS` instead. The Dockerfile pins its own PDF.js version; always keep each core and worker pair on the same version.

PowerShell equivalents for the server include:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r app/requirements.txt
$env:APDF_DATA_DIR = "$env:TEMP\apdf-dev-data"
$env:APDF_ACCESS_LOG_DIR = "$env:TEMP\apdf-dev-data\logs"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Use `New-Item -ItemType Directory -Force app/static/pdfjs` and `Copy-Item` to stage PDF.js on PowerShell. Python modules read environment settings at import; recreate/restart the process after configuration changes.

## Local web app

```bash
npm ci
npm run dev:local
```

Use Vite's printed localhost URL. `prepare:local` vendors the runtime and renders shared template partials before Vite starts. Vite's development server does not register the production offline service worker. If changing a shared Jinja partial, rerun preparation/restart the dev command; changing generated `src/generated/workspaces.js` directly is not a source change.

For the actual offline build:

```bash
npm run build:local
npm run preview:local
```

Open `http://127.0.0.1:4173` and wait for **Ready for offline use** before testing offline reloads. `npm run local` builds and starts the static launcher in one command. Builds download required pinned inputs on first use and reuse `local-app/.cache` afterward. Completed distributions have no runtime CDN requirement.

The local build packages the shared Python services; it does not execute a host Python interpreter. Python is needed only for Python work or browser-test fixtures.

## Desktop app

```bash
npm ci
npm run desktop
```

This builds the local web assets, stages them and the Electron shell in `desktop/.build/app`, obtains the Electron runtime if missing, and starts the staged app. The renderer's `apdf:` protocol selects desktop behavior and skips service-worker registration; all assets are already packaged.

Keep real profiles separate during experiments:

```bash
APDF_DESKTOP_DATA_DIR=/tmp/apdf-desktop-dev npm run desktop
```

Do not reuse the real user's profile for automated checks. Native save dialogs and close prompts belong to the Electron main process; PDF manipulation remains in the renderer's worker. See [Deployment](DEPLOYMENT.md) for package commands and host requirements.

## Files to edit and regenerate

| Change | Source to edit | Rebuild/refresh |
| --- | --- | --- |
| PDF operation logic | `app/services/pdf/*.py` | Python server restart; local and desktop rebuilds |
| Tool controls | `app/templates/partials/edit`, shared DOM/controller modules | Server template/static refresh; local preparation and rebuild |
| Brush parameters | `app/static/pen-brush-presets.json` | Server restart and offline builds |
| Brush geometry | Python `brush_texture.py` and JS `pen-texture.js` | Both runtime editions and preview/PDF comparisons |
| App/favicon design | `local-app/app-icon.svg` | `npm run icons`, then relevant app builds |
| Shared visual layout | `app/static/css` | Server refresh; offline rebuild |
| Native menus/protocol/windows | `desktop/*.cjs` | `npm run build:desktop`, then package again |
| Dependency/runtime versions | Pin files and vendor preparation | Fresh build, offline checks, licenses and platform validation |

The server serves unbundled ESM with version query strings. Update the appropriate entry/import version and template script reference when needed to invalidate stale browser modules. Local Vite builds instead produce hashed chunks and a regenerated service-worker cache version.

Generated directories are `node_modules`, `local-app/public`, `local-app/dist`, `local-app/.cache`, `local-app/src/generated`, `local-app/releases`, `desktop/.build`, and `desktop/releases`. The existing `.gitignore` files exclude these. Do not edit generated bundles to implement features.

Before shipping a change, use the relevant [Testing](TESTING.md) checks and the compatibility steps in [Extending](EXTENDING.md). A successful source build is not evidence that every packaged OS/CPU variant has been run.
