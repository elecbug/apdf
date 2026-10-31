# Extension and maintenance guide

[Documentation index](README.md)

Implement shared PDF behavior once in the Python services, then connect it through the existing UI and transports. Keep server, local web and desktop differences at their boundaries. [Architecture](ARCHITECTURE.md) describes ownership; [PDF specification](PDF_SPEC.md) defines current contracts.

## Add an edit operation

1. Define the operation name, required fields, defaults, numeric limits, attachment rules and failure behavior in `PDF_SPEC.md`.
2. Implement validation and PDF work under `app/services/pdf`. Add dispatch in `editor.py` and update `SUPPORTED_EDIT_OPERATION_TYPES`.
3. Update `SUPPORTED_EDIT_TYPES` in `app/routes/edit.py`. If the operation needs an image/PDF attachment, also update attachment-ID collection, validation and staging there.
4. Preserve the service signature accepting paths and operation dictionaries. Avoid importing FastAPI, server cache/job modules, or host-only packages into the shared PDF services.
5. Add the tool's controls under `app/templates/partials/edit/tools`, include them in `control_pane.html`, and add its toolbar button and icon.
6. Register required element IDs in `app/static/js/edit/dom.js`. Add the action/controller and connect it from `app.js` using the existing apply pipeline.
7. Keep busy controls, pending-pen restrictions, snapshots, preview replacement, status, Undo and Download consistent. Do not update the current PDF or push Undo before a replacement preview succeeds.
8. Add meaningful Python behavior tests and browser checks, update smoke operation coverage, and rebuild offline editions.

The local worker calls the same `apply_edit_operations`. Its generic attachment mapping already handles the existing image/PDF attachments; extend `engine.js`, `pdf-worker.js` or `bridge.py` only if the new operation requires a genuinely different transport.

## Geometry and interaction requirements

- Use visible, rotation-adjusted page dimensions. Put overlay transformations in `_merge_visible_overlay`, not scattered in each operation.
- Use PDF points in stored operations. Screen pixels and zoom belong only to pointer/preview conversion.
- Test all four right-angle rotations, nonzero CropBox origins, reversed drag directions, page edges and fit-width on a narrow viewport.
- Keep preview load/render race protection and destroy replaced/failed PDF.js loading tasks. Use the loading-task lifecycle compatible with the installed PDF.js versions.
- Invalid input must leave the current preview, source files, pending strokes and Undo state recoverable.

## Change shapes

Update the engine's supported shape names and vector construction in `shapes.py`, then the shape selector and any shape-specific controller behavior. Preserve paint parsing through `paint.py`, independent fill/stroke alpha, border inset, bounds validation, and transparent/no-border cases. Add geometry tests and actual PDF-rendered browser pixel checks.

A UI-only new option is not enough: both server and offline generation must recognize it. Conversely, changing a service default does not automatically change an explicitly populated form default.

## Change pen textures

| Concern | Source |
| --- | --- |
| Preset labels, layers, surface parameters | `app/static/pen-brush-presets.json` |
| Python procedural geometry and seeded noise | `app/services/pdf/brush_texture.py` |
| Python validation and PDF drawing | `app/services/pdf/drawing.py` |
| JavaScript procedural geometry | `app/static/js/edit/pen-texture.js` |
| Canvas brush rendering | `app/static/js/edit/pen-brushes.js` |
| Capture, per-stroke settings, pending state and caching | `app/static/js/edit/pen.js` |

The JSON preset file is shared. Python and JavaScript geometry are separate implementations and must remain equivalent: keep seed arithmetic, noise, spacing, path construction, alpha and width conventions aligned. A fixed seed must remain stable under redraw and zoom. Equivalent gestures must not change density simply because mouse events arrived at a different frequency.

Bound texture detail and respect drawing limits. The browser caches completed strokes; invalidate the appropriate cache when their geometry changes. Compare live overlays with the PDF renderer for dots, curves, thin/long strokes, transparency, page edges and all textures. Do not replace the pen with periodically repeated dash patterns if the intended material is irregular graphite or bristle texture.

## Change Assemble behavior

The server switch is authoritative. `compose_direct` returns bytes without a job; `compose_with_result_code` returns the stored result reference. Keep those contracts separate rather than reintroducing automatic size-based routing.

Update together:

- Configuration parsing, Docker defaults and Compose interpolation.
- `/compose` validation and its two processing paths.
- Shared Jinja context, lookup visibility, button/help text.
- `app/static/js/assemble/build.js` response handling.
- The injected local API path, which must continue returning a local `File` without HTTP uploads.
- Mode unit tests, both-mode smoke checks and `browser_assemble_modes.cjs`.

The server browser currently persists source order but not ranges across full navigation. Offline editions persist both. A change to restoration should deliberately update each storage format, handle existing stored values, and document migration behavior.

## Change storage or settings

Treat source cache deletion, result deletion, edit-session memory and app asset caches as distinct lifecycles. Do not use the service-worker cache to persist PDF documents. IndexedDB upgrades need an explicit version/migration plan; existing user profiles must remain readable or receive a documented migration path.

Server stores use JSON files without a multi-process transaction layer. Adding parallel workers, durable queues, authentication or multi-user ownership requires a design change, not just a new launch flag. Define its data model, failure semantics, cleanup and API changes before implementing it.

For a new setting, document default, units, accepted values, edition scope, precedence and when it is read in `CONFIGURATION.md`. Docker environment updates need container recreation; browser/desktop build inputs need rebuilding their distributions.

## Change assets and dependencies

Edit `local-app/app-icon.svg` for favicon/native icon changes and run `npm run icons`. The generator writes browser SVG/ICO/touch icons and PNG/ICO/ICNS native assets. The 11 toolbar PNGs have a separate established visual set; reference `docs/design/edit-tool-icons.json` when maintaining it.

Update dependency pins and lockfiles deliberately. PDF.js core and worker must match; Docker's PDF.js pin differs from the local app's npm version. Browser Python packages come from `prepare.mjs` plus Pyodide's package lock, not directly from the server's requirements file. Test CPython and WebAssembly when adding imports or changing fonts/images; a package working on the host does not prove it works in Pyodide.

Retain bundled licenses and notices when vendoring dependencies. Rebuild the offline asset list whenever runtime files change. Check offline first launch/reload, then package and test the native executable; changing only generated `.build` or `dist` files will be lost on regeneration.

## Documentation and delivery

Update API/operation examples, configuration, test instructions and user-visible limitations as part of the change. The server version in `app/main.py` and desktop/local version in `package.json` are separate fields; update the relevant one for a release. Do not imply a generated package has been run on another OS/CPU until that variant has actually been verified.
