#!/usr/bin/env bash
#
# ONE MEASUREMENT, FROM A KNOWN STATE.
#
# perf:baseline points a browser at whatever is listening on the port. That is
# fine until the thing listening was started from a DIFFERENT build than the
# one on disk — which is exactly what happened here: `npm run build` was run
# under a live `next start`, the server kept serving HTML from the old build,
# one renamed 46 KB shared chunk 404'd, and the page read as 46 KB lighter
# than it was. A saving that no code change had produced.
#
# So the capture owns the whole sequence instead of trusting the operator to
# remember it: stop anything already serving, build, start a server from THAT
# build, measure, stop it again. The harness now also records failed requests
# and perf-delta.mjs refuses a row that has any, so the same mistake would be
# caught rather than published — but not making it in the first place is
# better.
#
# Usage: bash scripts/perf-capture.sh <out.json> [port]
set -euo pipefail

OUT="${1:?usage: perf-capture.sh <out.json> [port]}"
PORT="${2:-3000}"
BASE="http://127.0.0.1:${PORT}"

stop_server() {
  # Only ever the server this repo starts on this port, never a stray match.
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap stop_server EXIT

echo "==> stopping anything already on :${PORT}"
# A leftover server from an earlier capture is the failure mode this guards.
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
fi
sleep 1

echo "==> building"
npm run build >/dev/null

echo "==> starting a server from THIS build"
PORT="$PORT" npm run start >/dev/null 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "${BASE}/regulamin"; then break; fi
  sleep 1
done
if ! curl -sf -o /dev/null "${BASE}/regulamin"; then
  echo "server never came up on ${BASE}" >&2
  exit 1
fi

echo "==> measuring"
PERF_JSON="$OUT" npm run perf:baseline -- "$BASE"

# A capture that recorded a refused request is not a slow result, it is a
# void one. Say so loudly and exit non-zero so a script cannot go on to
# quote it.
node -e '
const rows = require(process.argv[1]).rows;
const bad = rows.filter((r) => (r.failedRequests ?? 0) > 0);
if (!bad.length) { console.log("\nno failed requests — capture is usable."); process.exit(0); }
console.error(`\n${bad.length} row(s) had FAILED requests. This capture is void:`);
for (const r of bad) console.error(`  ${r.viewport} ${r.route}: ${(r.failedUrls ?? []).join(", ")}`);
process.exit(1);
' "$OUT"
