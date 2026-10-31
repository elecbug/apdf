# Testing guide

[Documentation index](README.md)

Run checks against disposable data and profiles. Server smoke/browser suites create sources and jobs and may delete their generated results. Never point them at a shared production workspace. Use the development setup in [Development](DEVELOPMENT.md) and select checks appropriate to the changed behavior.

## Fast checks

With the Python environment activated:

```bash
python -m unittest discover -s tests -v
```

With npm dependencies installed:

```bash
npm run test:local
npm run test:desktop
```

| Tests | Behavior covered |
| --- | --- |
| `tests/test_pdf_logic.py` | Page geometry, transformations, structural edits, text/image/numbering, invalid inputs and document restrictions. |
| `tests/test_shapes.py` | Six shapes, bounds, borders, transparency, colors and rotated/cropped placement. |
| `tests/test_drawing.py` | Stroke validation, seeded nonperiodic textures, limits, vector output, clipping and page geometry. |
| `tests/test_source_uploads.py` | Failed upload-batch rollback while preserving existing files. |
| `tests/test_compose_modes.py` | Mode enforcement, no-code direct output, temporary cleanup, stored success/failure jobs, configuration and selected UI. |
| `local-app/tests/*.test.mjs` | Local plans/API adapter and the static launcher's GET/HEAD-only boundary. |
| `desktop/tests/*.test.mjs` | App protocol origin/path/method restrictions and allowed local resource URLs. |

Counts change as coverage grows; use the runner's reported result rather than a historical fixed count.

## HTTP smoke checks

Start a disposable Python server in one terminal:

```bash
APDF_DATA_DIR=/tmp/apdf-smoke-data \
APDF_ACCESS_LOG_DIR=/tmp/apdf-smoke-data/logs \
uvicorn app.main:app --host 127.0.0.1 --port 8765
```

In another terminal with project Python dependencies available:

```bash
python tools/apdf_smoke_check.py \
  --base-url http://127.0.0.1:8765 \
  --pdf tools/test.pdf \
  --expect-legacy-removed
```

The checker covers pages/controls, source APIs, selected Assemble transport and lookup availability, edit operations, result/download contracts and removed legacy routes. It detects the current Assemble mode. `--debug` prints unexpected-crash tracebacks; `--keep-jobs` retains generated jobs for inspection. The Docker smoke service runs the same script through `tools/run_smoke.sh` and writes `debug/.log`.

## Both Assemble modes in a browser

Start two servers in separate terminals, with the Python environment activated. The direct server deliberately sets the old thresholds below the fixture size/page count:

```bash
APDF_ASSEMBLE_RESULT_CODE=false \
APDF_MAX_INLINE_BYTES=1 APDF_MAX_INLINE_PAGES=1 \
APDF_DATA_DIR=/tmp/apdf-test-direct \
APDF_ACCESS_LOG_DIR=/tmp/apdf-test-direct/logs \
uvicorn app.main:app --host 127.0.0.1 --port 8775
```

```bash
APDF_ASSEMBLE_RESULT_CODE=true \
APDF_DATA_DIR=/tmp/apdf-test-code \
APDF_ACCESS_LOG_DIR=/tmp/apdf-test-code/logs \
uvicorn app.main:app --host 127.0.0.1 --port 8776
```

Prepare Chromium once and run the suite:

```bash
npx playwright install chromium
APDF_TEST_PYTHON=python3 node tests/browser_assemble_modes.cjs \
  http://127.0.0.1:8775 http://127.0.0.1:8776
```

It verifies mode-specific controls, source ordering/ranges, actual downloaded PDF text, error recovery, direct download without result requests, code-page navigation without automatic download, and lower-case code lookup. Run the HTTP smoke checker against both addresses as well. Threshold changes must not silently switch modes.

## Server Edit browser checks

Against the disposable server on port 8765:

```bash
APDF_TEST_PYTHON=python3 APDF_TEST_PDFJS=node_modules/pdfjs-dist \
  node tests/browser_logic.cjs http://127.0.0.1:8765
APDF_TEST_PYTHON=python3 APDF_TEST_PDFJS=node_modules/pdfjs-dist \
  node tests/browser_shapes.cjs http://127.0.0.1:8765
APDF_TEST_PYTHON=python3 APDF_TEST_PDFJS=node_modules/pdfjs-dist \
  node tests/browser_pen.cjs http://127.0.0.1:8765
APDF_TEST_PDFJS=node_modules/pdfjs-dist \
  node tests/browser_leave.cjs http://127.0.0.1:8765
```

The optional PDF.js package override injects the matching core and worker into these tests, so the test server does not need staged preview assets. This does not test whether a deployed image actually ships its own PDF.js files; check that separately when changing packaging. Use `APDF_PLAYWRIGHT_MODULE` only when those scripts need a separately installed Playwright module.

The suites cover concurrent preview rendering, failed-load preservation, page/zoom state, coordinates, pixels, Undo, file-replacement protection, source operation locking, browser-storage restrictions, shapes, pen previews versus PDF pixels, and leave-warning cancellation/acceptance.

## Offline web integration

```bash
npm run build:local
npm run preview:local
```

In another terminal:

```bash
APDF_TEST_PYTHON=python3 npm run test:local:browser
```

The suite uses the built app at port 4173, waits for offline readiness, disables network access and reloads. It then exercises every tool, Korean text, shapes/brushes, PDF download contents, pending-stroke download, Undo, leave protection, local source persistence, failed-batch rollback, clearing sources and narrow layouts. It checks for processing API/external requests. Test the production build; Vite dev mode intentionally has no offline service worker.

## Desktop integration and packaged executables

```bash
npm run build:desktop
APDF_TEST_PYTHON=python3 npm run test:desktop:browser
```

This reuses the local workflow against a real Electron window and custom protocol. It additionally checks disabled Node exposure, sandbox preferences, native save interception, close cancellation/confirmation, and source/order/range restoration after completely restarting the application. Fixtures and the test profile are temporary.

On a restricted Linux test host, add `APDF_TEST_NO_SANDBOX=1` to the test command. This is a test-launch workaround, not a reason to disable the product's sandbox. The Linux harness uses Electron's headless Ozone mode.

After building a Linux package, test its actual executable instead of the staged app:

```bash
APDF_TEST_PYTHON=python3 \
APDF_DESKTOP_EXECUTABLE="$PWD/desktop/releases/linux-unpacked/apdf-local" \
npm run test:desktop:browser
```

Use a matching executable path on another platform. Creating a Windows/macOS artifact on a build host does not establish that native dialogs, permissions and startup work on that target; run platform validation before release.

## Output and selecting checks

Browser suites write screenshots under `docs/design`; some overwrite existing preview files. Inspect image diffs before committing. Compare behavior and pixels rather than expecting byte-identical PDF files, whose metadata/serialization may vary.

| Changed area | Useful checks |
| --- | --- |
| Docs only | Relative links, example JSON/shell syntax, commands/settings cross-check against source |
| PDF service or brush math | Python regressions, corresponding Edit browser suite, offline integration |
| Assemble setting/transport | Mode unit tests, both smoke runs, mode browser suite, local build |
| Preview/UI lifecycle | Edit browser suites and offline/native workflow as applicable |
| Runtime assets/worker | Production offline build and network-disabled integration |
| Desktop main/protocol/package | Protocol unit tests, native integration and packaged-executable validation |

Stop only the test servers/processes you started after verification. Test success in one edition does not replace checks for another changed runtime boundary.
