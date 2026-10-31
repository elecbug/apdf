# APDF documentation

These English guides describe the current implementation, including configurable Assemble output modes, the offline web app, and the desktop app. Last reviewed against the working tree on **2026-10-31**. They describe implemented behavior; planned extensions are identified explicitly.

## Choose a guide

| Your task | Document |
| --- | --- |
| Choose an edition, assemble PDFs, edit, draw, save, or recover work | [User guide](USER_GUIDE.md) |
| Install development dependencies and run from source | [Development guide](DEVELOPMENT.md) |
| Understand components, ownership, storage, and data flows | [Architecture](ARCHITECTURE.md) |
| Configure Assemble modes, paths, expiration, logging, or ports | [Configuration reference](CONFIGURATION.md) |
| Integrate with the Python server over HTTP | [HTTP API reference](API.md) |
| Understand exact PDF operations, coordinates, colors, and limits | [PDF operation specification](PDF_SPEC.md) |
| Add tools, change brushes, or modify shared code | [Extension and maintenance guide](EXTENDING.md) |
| Run unit, browser, offline, desktop, and smoke checks | [Testing guide](TESTING.md) |
| Deploy Docker, distribute the static app, or package desktop builds | [Deployment and release guide](DEPLOYMENT.md) |
| Diagnose failures and understand operational limitations | [Troubleshooting](TROUBLESHOOTING.md) |

## Suggested reading paths

- **Users:** User guide, then Troubleshooting as needed.
- **Operators:** Configuration, Deployment, Architecture's storage and logging sections, then Testing.
- **Developers:** Development, Architecture, PDF specification, API, Extending, then Testing.

## Editions at a glance

| Edition | Where PDF processing happens | End-user requirements | Result codes |
| --- | --- | --- | --- |
| Python/Docker server | Server filesystem and Python process | Browser and access to the running server | Configurable for Assemble |
| APDF Local web/PWA | Browser worker with bundled Python/WebAssembly | Browser; initially a localhost/HTTPS app origin | Never |
| APDF Local desktop | Bundled Electron renderer and worker | Matching OS/CPU application package | Never |

The portable **web ZIP** still uses a Node launcher to serve static files. The **desktop package** includes its runtime and does not require Node.js, Python, Docker, a separate browser, or a localhost server on the user's machine.

## Source of truth and document upkeep

Executable behavior is defined by the source files linked from these documents. Update the relevant guide when changing configuration, API responses, operation validation, storage, UI state, dependencies, or packaging. Keep examples consistent across server, local web, and desktop editions without assuming their transport or persistence is identical.

The root [README](../README.md), [local web guide](../local-app/README.md), [desktop guide](../desktop/README.md), and [smoke-check guide](../tools/README.md) remain useful entry points. The documents here provide the shared English reference. [Design artifacts](design/) are screenshots and icon-generation references, not a separate implementation specification.
