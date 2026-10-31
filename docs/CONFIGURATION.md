# Configuration reference

[Documentation index](README.md)

## Server configuration

Server settings are read from environment variables when Python modules import. Restart the process after changing them. Compose reads its project `.env` for interpolation; starting Uvicorn directly does not automatically load that file.

| Variable | Default outside Docker | Behavior |
| --- | --- | --- |
| `APDF_ASSEMBLE_RESULT_CODE` | `false` | `false`: direct PDF response without a job/code; `true`: stored result and code page. |
| `APDF_DATA_DIR` | Repository-root `data` | Parent of server client and job stores. Docker sets `/app/data`. |
| `APDF_FONTS_DIR` | Repository-root `fonts` | Font search directory. Docker sets `/app/fonts`. |
| `APDF_JOB_EXPIRE_SECONDS` | `7200` | Job expiration from creation. |
| `APDF_CLIENT_EXPIRE_SECONDS` | `21600` | Client source-cache inactivity TTL. |
| `APDF_CODE_LENGTH` | `8` | Length of generated job result codes. Source IDs separately use 10 characters. |
| `APDF_CODE_ALPHABET` | `ABCDEFGHJKLMNPQRSTUVWXYZ` | Alphabet for generated source IDs and job codes. |
| `APDF_MAX_INLINE_BYTES` | `10485760` | Edit's inline/job metadata threshold. Does not route Assemble or cap uploads. |
| `APDF_MAX_INLINE_PAGES` | `200` | Edit's inline/job metadata threshold. Edit still returns a download URL. |
| `APDF_ACCESS_LOG_DIR` | `/app/data/logs` | Actual daily access-log directory, independent of `APDF_DATA_DIR`. |
| `APDF_LOG_TZ` | `Asia/Seoul` | IANA timezone used for access-log timestamps and daily filenames. |

Boolean parsing accepts `true/false`, `1/0`, `yes/no`, and `on/off`, ignoring case and surrounding whitespace. Other values fail startup. Prefer `true` and `false` in deployment configuration. Integer environment values are parsed directly; choose positive TTLs and sensible thresholds rather than relying on additional validation.

Keep the default code alphabet unless changes are tested against source-ID normalization and URL handling. Generated source IDs use the same alphabet and are expected to remain path-safe uppercase identifiers.

`LOG_DIR` and `AUDIT_LOG_PATH` in `app/config.py` are not the active access writer's destination settings. The writer in `app/services/audit_log.py` uses `APDF_ACCESS_LOG_DIR` and writes `access-YYYY-MM-DD.jsonl`. When running Python locally with a custom data directory, set the log directory separately to a writable path.

## Switching Assemble modes in Docker Compose

The [Compose file](../docker-compose.yml) contains:

```yaml
APDF_ASSEMBLE_RESULT_CODE: "${APDF_ASSEMBLE_RESULT_CODE:-false}"
```

Create or update `.env` beside `docker-compose.yml`:

```dotenv
APDF_ASSEMBLE_RESULT_CODE=true
```

Apply source and configuration changes:

```bash
docker compose up -d --build apdf
```

Set the value to `false` and recreate the container to return to direct downloads. `docker compose restart` reuses the container's old environment. Shell environment values can override `.env` interpolation; inspect the resolved configuration when the behavior is unexpected:

```bash
docker compose config
```

The Dockerfile also defines a `false` image default. Compose's environment value overrides that default, so editing only the Dockerfile is insufficient when Compose supplies its own value.

| Result-code setting | Response to `/compose` | Header lookup | Retained output |
| --- | --- | --- | --- |
| `false` | `application/pdf` attachment | Hidden | Temporary only; removed after transfer |
| `true` | JSON with `mode: "job"`, `code`, `url` | Visible | Job output until expiration/deletion |

The server setting cannot be overridden by a JSON request parameter. Validation errors are JSON in both modes. Size/page thresholds do not automatically select a different Assemble mode. Edit's job/download endpoints and previously created job links remain available even when the Assemble lookup form is hidden. Local web and desktop builds do not use this setting.

## Docker resources

The default Compose deployment publishes `8000:8000`, mounts `./data` read/write and `./fonts` read-only, and uses the custom `10.230.7.0/24` network. Adjust the network if it overlaps an existing subnet. Docker supplies PDF.js `5.7.284` via the `PDFJS_VERSION` build argument; this is separate from the local app's npm dependency version.

The health check reads the root URL; it checks HTTP reachability rather than every PDF feature. The smoke container waits for a healthy server and performs broader checks. Its output goes to `debug/.log` through the debug mount.

## Local web and desktop settings

| Variable | Default | Scope |
| --- | --- | --- |
| `APDF_LOCAL_PORT` | `4173` | Static web launcher. Binds `127.0.0.1`; accepts ports 1–65535. Changing it changes the browser origin and its storage/cache scope. |
| `APDF_DESKTOP_DATA_DIR` | OS app-data directory plus `APDF Local` | Developer override of Electron's user-data location. Must be an appropriate absolute/relative filesystem path on the current OS. |

Neither setting changes server data paths. Desktop has no localhost port. Local web/desktop asset versions, Python wheels and font inputs are defined by [package.json](../package.json), [package-lock.json](../package-lock.json), and [prepare.mjs](../local-app/scripts/prepare.mjs); they are build inputs, not runtime environment switches.

## Smoke and browser test settings

| Variable | Purpose |
| --- | --- |
| `APDF_SMOKE_BASE_URL`, `APDF_SMOKE_PDF`, `APDF_SMOKE_LOG` | Smoke container target, fixture and report location. Defaults are in `tools/run_smoke.sh`. |
| `APDF_SMOKE_TIMEOUT`, `APDF_SMOKE_WAIT_SECONDS` | Per-request timeout and startup wait; defaults 30 and 60 seconds. |
| `APDF_SMOKE_EXPECT_LEGACY_REMOVED` | Enables removed-endpoint checks in the smoke wrapper; default `1`. |
| `APDF_TEST_PYTHON` | Python executable for browser-test PDF/image fixtures. |
| `APDF_PLAYWRIGHT_MODULE` | Optional module path for the older server browser-test scripts. |
| `APDF_TEST_PDFJS` | PDF.js package directory injected by server preview tests. |
| `APDF_TEST_DESKTOP` | Selects the native harness inside the shared local browser suite; the desktop npm runner sets it. |
| `APDF_DESKTOP_EXECUTABLE` | Packaged Electron executable to test instead of the staged development app. |
| `APDF_TEST_NO_SANDBOX` | Test-host workaround for restricted Linux CI only. Product renderer sandboxing remains enabled by default. |

See [Testing](TESTING.md) for executable examples and [Deployment](DEPLOYMENT.md) for release settings.
