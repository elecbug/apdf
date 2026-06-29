#!/bin/sh
set -eu

BASE_URL="${APDF_SMOKE_BASE_URL:-http://apdf:8000}"
PDF_PATH="${APDF_SMOKE_PDF:-/smoke/test.pdf}"
LOG_PATH="${APDF_SMOKE_LOG:-/debug/.log}"
TIMEOUT="${APDF_SMOKE_TIMEOUT:-30}"
WAIT_SECONDS="${APDF_SMOKE_WAIT_SECONDS:-60}"
EXPECT_LEGACY_REMOVED="${APDF_SMOKE_EXPECT_LEGACY_REMOVED:-1}"

mkdir -p "$(dirname "$LOG_PATH")"

{
  echo "=== APDF smoke check ==="
  echo "base_url=$BASE_URL"
  echo "pdf=$PDF_PATH"
  echo "started_at=$(date -Iseconds)"
  echo
} > "$LOG_PATH"

end_time=$(( $(date +%s) + WAIT_SECONDS ))
while :; do
  if python - "$BASE_URL" <<'PY' >/dev/null 2>&1
import sys
import urllib.request

base_url = sys.argv[1].rstrip("/")
urllib.request.urlopen(base_url + "/assemble", timeout=2).read(1)
PY
  then
    break
  fi

  if [ "$(date +%s)" -ge "$end_time" ]; then
    echo "APDF server was not ready within ${WAIT_SECONDS}s" >> "$LOG_PATH"
    cat "$LOG_PATH"
    exit 2
  fi

  sleep 1
done

set +e
if [ "$EXPECT_LEGACY_REMOVED" = "1" ] || [ "$EXPECT_LEGACY_REMOVED" = "true" ] || [ "$EXPECT_LEGACY_REMOVED" = "TRUE" ]; then
  python /smoke/apdf_smoke_check.py \
    --base-url "$BASE_URL" \
    --pdf "$PDF_PATH" \
    --timeout "$TIMEOUT" \
    --expect-legacy-removed \
    >> "$LOG_PATH" 2>&1
else
  python /smoke/apdf_smoke_check.py \
    --base-url "$BASE_URL" \
    --pdf "$PDF_PATH" \
    --timeout "$TIMEOUT" \
    >> "$LOG_PATH" 2>&1
fi
status=$?
set -e

{
  echo
  echo "finished_at=$(date -Iseconds)"
  echo "exit_code=$status"
} >> "$LOG_PATH"

cat "$LOG_PATH"
exit "$status"
