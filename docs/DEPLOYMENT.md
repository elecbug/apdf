# Deployment and release guide

[Documentation index](README.md)

Choose the server, static web/PWA, or desktop distribution deliberately. They share PDF behavior but have different requirements, storage, network boundaries and release artifacts.

## Docker server

Prerequisites are Docker/Compose access and writable host data directories. From the repository root:

```bash
docker compose up -d --build
```

Open `http://SERVER_IP:8000`. The multi-stage image installs PDF.js using Node, then copies its core/worker into the final Python image. Node is not needed in that final image. The `apdf` service mounts `./data:/app/data` and `./fonts:/app/fonts:ro`; preserve these separately from the container image when needed.

The `smoke` service starts after the configured health check passes, runs once, and writes `debug/.log`. Inspect results using:

```bash
docker compose logs apdf
docker compose logs smoke
docker compose up smoke
```

Choose Assemble mode using [Configuration](CONFIGURATION.md), for example `.env` containing `APDF_ASSEMBLE_RESULT_CODE=true`. Recreate the service after environment changes:

```bash
docker compose up -d --build apdf
```

The supplied port mapping publishes port 8000 on the host. The server has no built-in accounts, ownership checks, rate limits or TLS termination. Use the intended trusted-network boundary; a public deployment requires an appropriate access-control/proxy design. If the service is only for that host, bind the published address to `127.0.0.1` rather than assuming the existing mapping does that.

The default Uvicorn command has one process. Do not increase worker count or share the filesystem stores between replicas without addressing concurrent JSON/file updates. There is no database-backed job queue. PDF files, fonts, available memory, temporary space and request timeouts affect throughput.

## Operations, retention and logs

- Client sources expire after inactivity; jobs expire from creation. Cleanup is request-driven, not a periodic scheduler. Direct Assemble outputs are temporary and are removed after transfer.
- Access logs are separate from job/source expiry. Implement log retention outside the application if required; the app does not automatically rotate away old daily files.
- The actual access writer includes raw path parameters, potentially codes/client IDs/filenames. Control log access and proxy-provided IP headers accordingly. See [Architecture](ARCHITECTURE.md).
- Back up original/downloaded documents independently. These caches are temporary working data, not a document archive. If retaining server state, preserve both PDF files and matching JSON metadata from a consistent point in time.
- Clearing an application cache does not delete files already saved to a user's Downloads folder.

The health check verifies HTTP reachability. A release should also pass smoke and relevant browser checks; it can be healthy while a specific PDF/font/preview feature is broken.

## Static local web/PWA

On a build machine with Node.js 22.12+:

```bash
npm ci
npm run build:local
```

`local-app/dist` is the complete static distribution, including Pyodide, PDF libraries, PDF.js, CMaps/fonts/WASM assets, the Korean font, manifest, licenses and generated service worker. First build downloads pinned inputs; the finished app has no runtime CDN dependency.

Serve the existing build locally:

```bash
npm run preview:local
```

The launcher binds `127.0.0.1:4173`, serves GET/HEAD only, and does not process or accept PDF uploads. `APDF_LOCAL_PORT` selects another port. Keep the same address/port/profile when relying on browser storage. Relative paths support subdirectory hosting. Use localhost or HTTPS for service-worker support; direct `file://` opening is unsupported.

Wait for **Ready for offline use** before stopping the launcher. Asset precaching must finish once for that browser origin. The service worker caches app files, while PDFs are stored separately in IndexedDB. Browser eviction or clearing site data removes that persistence; it is not equivalent to a native application's bundled first launch.

### Portable web ZIP

```bash
npm run package:local
```

The result is `local-app/releases/apdf-local.zip`. Extract it and run `node start.mjs`. The recipient needs Node and a browser, but no npm installation, Python, Docker or internet connection for the prepared bundle. If the requirement is **no separately installed runtime**, distribute the desktop app instead.

## Desktop packages

The build machine needs Node/npm and downloads build/runtime inputs. End users need only the OS/CPU package and normal OS desktop facilities.

```bash
npm ci
npm run package:desktop
```

The default packages the current host platform/architecture. Explicit multi-architecture commands are:

```bash
npm run package:desktop:win
npm run package:desktop:linux
npm run package:desktop:mac
```

Use a Mac for macOS DMG creation and native signing. The package pipeline builds the local app, stages `desktop/.build/app`, and packages it with Electron into `desktop/releases`. The default artifact template is `APDF-Local-${version}-${os}-${arch}.${ext}`.

| Target | Distribution | End-user action |
| --- | --- | --- |
| Windows | Portable EXE and ZIP | Open portable EXE, or extract the entire ZIP and open `APDF Local.exe`. |
| Linux | `tar.gz` | Extract all files and open `apdf-local` in a supported graphical desktop. |
| macOS | DMG and ZIP | Move/open the bundled `.app`. |

`x64` refers to Intel/AMD 64-bit; `arm64` covers compatible ARM64 systems. Retain the surrounding files when distributing an unpacked app. NSIS portable launchers can use an x86 wrapper around a different payload architecture; inspect the actual packaged application and builder output when checking architecture.

The desktop app serves its own `apdf://app/` origin and does not start an HTTP server. It includes its browser and PDF runtime, works offline immediately, and uses a persistent OS app-data profile. Native downloads go through the OS save dialog. An EXE/app update does not itself migrate or back up profile data.

### Signing and native-host behavior

The current Windows configuration does not Authenticode-sign executables. macOS uses ad-hoc signing (`identity: "-"`), without Developer ID notarization. Target operating systems may show origin/trust checks. Developer ID, notarization and Windows signing require a separate release identity/credential setup; they are not performed by this repository's current workflow.

On Windows hosts the builder can apply executable resources/icons while leaving signing disabled. Linux-to-Windows builds skip resource editing to avoid Wine; the portable launcher and application window still use APDF icons. Treat native-host validation and signing status as release facts, not assumptions from successful cross-compilation.

## CI and release verification

[Desktop apps](../.github/workflows/desktop.yml) is triggered manually or by `desktop-v*` tags. It defines Linux, Windows and macOS runners, installs Node 24, runs fast checks, builds desktop assets, runs the Linux native PDF workflow, packages x64/arm64 targets and uploads build artifacts with 14-day retention. It does not automatically publish a public release or supply signing identities.

Before distributing a release:

1. Update the appropriate version: server `APP_VERSION` in `app/main.py`, local/desktop `version` in `package.json`; maintain the lockfile as needed.
2. Build from the intended source state and pass the relevant [Testing](TESTING.md) commands.
3. Inspect actual artifact contents for the PDF engine, runtime, fonts, licenses, icons and matching PDF.js worker.
4. Launch the packaged executable on the intended OS/CPU, test save dialogs/leave warnings and process restart, and verify offline use without a development server.
5. Record the tested platforms, signing status and any remaining unverified targets when sharing artifacts.

Do not claim Windows/macOS execution was verified merely because artifacts were produced on Linux. Existing screenshots under `docs/design` illustrate behavior; they are not independent evidence for every release build.
