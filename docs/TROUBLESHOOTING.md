# Troubleshooting

[Documentation index](README.md)

Identify the edition first. Server errors involve HTTP/Python and temporary server stores; local web errors involve the static origin, service worker or browser worker; desktop errors additionally involve Electron and its profile. Keep the original PDF and capture the failing action/status without posting document contents unnecessarily.

## Assemble and result codes

| Symptom | Check and action |
| --- | --- |
| Build uses the wrong mode | Inspect `docker compose config`; check shell overrides and `.env`. Recreate the container after changing `APDF_ASSEMBLE_RESULT_CODE`. Restart alone preserves the old environment. |
| Editing the Dockerfile default has no effect | Compose explicitly overrides the image environment. Set the Compose variable or its `.env` input. |
| A client cannot parse `/compose` as JSON | Direct mode returns PDF bytes. Branch on HTTP status/content type; only code mode returns a successful JSON job reference. Errors remain JSON. |
| Lookup form is missing | It is intentionally hidden when Assemble result-code mode is off. Local web/desktop never provide result codes. |
| A saved code is unavailable | The job may have expired, been deleted, or belong to a different server/data volume. Codes are normalized to uppercase; they are not permanent archives. |
| Source list disappears | Check cache expiration, Clear/Remove actions, browser localStorage/site data and the current server or origin/profile. Closing a normal browser does not intentionally reset a persisted server client ID, but storage restrictions can. |
| Page ranges changed after returning to server Assemble | The server browser persists source order, not page ranges across full navigation. Recheck ranges. Offline editions persist both when storage is available. |
| A batch upload fails | One invalid PDF rejects the newly submitted batch. Existing cached sources should remain. Check filename extension and whether the PDF parses without a supplied password. |
| Build or editing controls are disabled | Wait for the active operation. This prevents overlapping source mutation or file replacement. Inspect the status/error if it never finishes. |

Neither an Assemble result page nor Edit's `mode` metadata implies a background queue. Long operations can exceed browser/proxy timeouts; there is no resumable processing protocol.

## PDF preview, geometry and fonts

| Symptom | Check and action |
| --- | --- |
| Edit preview module returns 404 | The native Python server needs PDF.js at `app/static/pdfjs`. Stage assets as in [Development](DEVELOPMENT.md), or use the Docker build that supplies them. |
| PDF.js reports a worker/version mismatch | Core and worker must come from the same package/version. Check stale caches and `APDF_TEST_PDFJS` overrides. Docker and npm pins currently differ. |
| A position appears inverted or rotated | Coordinates are relative to the visible rotated page's bottom-left, in points. Do not supply screen pixels or add CropBox offsets a second time. Run rotated/cropped geometry tests. |
| Image/shape is rejected near an edge | Its full rectangle must fit; a visible shape border must also be narrower than both dimensions. Pen marks are clipped at edges but their centers must be inside. |
| Text is clipped or lower lines disappear | Y is the first baseline. Lines move down. The engine validates the start/wrap width, not the entire glyph or multiline height. Reposition, reduce size or wrap appropriately. |
| Korean text is missing or replaced | Verify a compatible font registers successfully. The server can fall back to Helvetica if candidates fail, even if a system Noto package is installed. Prefer a known supported TTF; offline builds bundle Nanum Gothic. |
| PDF asks for a password / fails to open | There is no password-entry flow. The engine only attempts an empty password. Use an accessible, nonempty PDF. |
| A large PDF becomes slow or exhausts memory | Reduce preview zoom or process smaller documents/batches. Undo stores up to 20 PDFs; offline processing is limited by device memory. There is no automatic streaming edit session or OCR service. |

Some document-level PDF features are not guaranteed through page rewriting. Compare representative documents when signatures, forms, outlines, metadata or unusual encodings matter; retain originals.

## Pen and unsaved work

- If opening a new file or applying another tool is blocked, **Apply Drawing** or **Clear pending** first.
- Main Undo removes a pending stroke before undoing a committed PDF. After committing, it restores the pre-batch snapshot.
- A cancelled pointer/touch gesture should not create a committed stroke. Use the pen browser checks when changing event handling.
- Grain should remain stable under zoom and differ between new strokes. Check per-stroke seeds, shared presets, both texture algorithms and cache invalidation if that changes.
- A leave dialog does not save work. Reloaded Edit sessions cannot recover their previous PDF, strokes or Undo stack. A server job may still exist, but it does not restore pending client drawing.
- Download should commit pending drawing first. If Apply fails, pending strokes should remain available for retry; do not discard them while investigating.

## Offline web app

| Symptom | Check and action |
| --- | --- |
| Opening `index.html` directly fails | Use a localhost/HTTPS static server; workers and service-worker behavior through `file://` are unsupported. |
| Offline reload fails | Wait for **Ready for offline use** while all bundled assets are reachable. Dev mode intentionally does not install the production service worker. |
| Sources/cache appear empty after changing ports | Browser storage belongs to the origin/profile. Return to the original address and port. Desktop has its own independent profile. |
| Runtime or `engine/app.zip` is missing | Rebuild and distribute the entire `local-app/dist` output. Do not upload only HTML/JS or exclude WASM/wheel/font files. |
| Runtime tries an external dependency / initialization fails | All required packages must be vendored by preparation. The worker rejects external fetches; fix the bundle rather than adding a runtime CDN fallback. |
| An update appears stale | Ensure the full new build, including `sw.js`, was served and installation completed. Cache versions derive from bundled assets. Clear app/site data only after preserving necessary source files; it also affects PDFs in browser storage. |
| Storage is unavailable or full | Allow site storage, leave private mode if appropriate, free space, or use another profile. Order preferences degrade gracefully, but local source persistence requires IndexedDB. |

The web ZIP's Node launcher is a static-file server. If the user must install no runtime, use the desktop package. A build requiring internet once is different from an end-user runtime requiring internet; prepared distributions bundle their runtime inputs.

## Desktop

| Symptom | Check and action |
| --- | --- |
| App cannot start on the target machine | Match OS/CPU and extract the whole archive. Linux also needs a supported graphical desktop and standard OS libraries. A package is not one binary that runs on every OS. |
| Windows/macOS shows an origin/trust check | Current Windows builds are unsigned; macOS uses ad-hoc signing without notarization. Review the distribution/signing status in [Deployment](DEPLOYMENT.md). |
| App opens with an unexpected source list | Inspect the user profile location; test `APDF_DESKTOP_DATA_DIR` overrides and the persistent `APDF Local` app-data directory. |
| A second launch focuses an existing window | The app uses a single-instance lock. This is expected; different development profiles are used for isolated tests. |
| A popup or remote link does not open | Desktop intentionally denies external navigation and arbitrary windows. Only its bundled license view is allowed. |
| Native close/save automation fails in CI | Use the Electron-specific harness, not assumptions about browser dialogs. The test suite intercepts native dialogs/save paths and uses temporary profiles. |
| Linux automated tests fail to create sandboxed processes | In a restricted test host only, use `APDF_TEST_NO_SANDBOX=1`. Do not make that the application's shipped default. |

## Server operation and logs

`permission denied` on the Docker socket is host access configuration, not a PDF failure. Run Docker under an account with the intended daemon permissions. The documentation and application tests do not prove an image build completed if daemon access was unavailable.

If audit files are missing, verify `APDF_ACCESS_LOG_DIR` is writable and `APDF_LOG_TZ` exists in the environment. Changing only `APDF_DATA_DIR` does not move the actual log writer. Logging errors are swallowed by middleware; check the directory directly. Logs include raw path parameters despite a narrower middleware comment. Their expiry is not managed by PDF cache cleanup.

When reporting a reproducible defect, include edition, source/package version, OS/CPU, action, relevant settings, status/HTTP error, page rotation/CropBox details when relevant, and which [tests](TESTING.md) reproduce it. Use a minimal synthetic PDF whenever possible. Distinguish a code defect from an unavailable Docker daemon, missing asset, old running image, expired cache or unverified target build.
