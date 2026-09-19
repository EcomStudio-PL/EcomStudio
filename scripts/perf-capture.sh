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
  # KILL THE PROCESS GROUP, not the npm wrapper.
  #
  # `npm run start` forks `sh -c next start`, which forks `next-server`. $! is
  # npm's pid, and killing it leaves the grandchild holding the port — verified:
  # a SIGTERM to the npm pid left the port still answering 200, and this machine
  # accumulated four orphaned next-server processes that way. Every capture then
  # left a stale server bound to the port for the next one to measure.
  if [ -n "${SERVER_PID:-}" ]; then
    kill -- "-${SERVER_PID}" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap stop_server EXIT

echo "==> stopping anything already on :${PORT}"
# A leftover server from an earlier capture is the failure mode this guards, so
# not being ABLE to clear the port has to be fatal. This used to be wrapped in
# `command -v fuser` and silently did nothing where fuser is absent (macOS,
# alpine, slim CI images) — which turned the guard off exactly where it was
# needed and let a stale server be measured with a clean bill of health.
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -ti "tcp:${PORT}" | xargs -r kill 2>/dev/null || true
else
  echo "perf-capture: neither fuser nor lsof is available, so the port cannot be" >&2
  echo "cleared and a stale server would be measured silently. Refusing to run." >&2
  exit 2
fi
sleep 1
if curl -sf -o /dev/null "${BASE}/regulamin" 2>/dev/null; then
  echo "perf-capture: something is STILL serving on :${PORT} after the kill." >&2
  echo "Refusing to measure it — it is not this build." >&2
  exit 2
fi

echo "==> building"
npm run build >/dev/null

echo "==> starting a server from THIS build"
# setsid gives the server its own process group so stop_server can take the
# whole tree down; the log is kept because `next start` failing with
# EADDRINUSE used to vanish into /dev/null while the readiness probe happily
# succeeded against the server that was already there.
SERVER_LOG="$(mktemp)"
if command -v setsid >/dev/null 2>&1; then
  setsid env PORT="$PORT" npm run start >"$SERVER_LOG" 2>&1 &
else
  PORT="$PORT" npm run start >"$SERVER_LOG" 2>&1 &
fi
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "${BASE}/regulamin"; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "perf-capture: the server exited before it answered. Its log:" >&2
    cat "$SERVER_LOG" >&2
    exit 1
  fi
  sleep 1
done
if ! curl -sf -o /dev/null "${BASE}/regulamin"; then
  echo "server never came up on ${BASE}; its log:" >&2
  cat "$SERVER_LOG" >&2
  exit 1
fi

# AND IT IS SERVING THE BUILD WE JUST MADE.
#
# Everything above is circumstantial: a process started, a port answered. This
# is the only step that actually ties the two together. Next stamps its build
# id into the HTML, so comparing it with .next/BUILD_ID catches a stale server
# no matter how it survived.
BUILD_ID="$(cat .next/BUILD_ID 2>/dev/null || true)"
if [ -n "$BUILD_ID" ]; then
  if ! curl -s "${BASE}/regulamin" | grep -qF "$BUILD_ID"; then
    echo "perf-capture: the server on :${PORT} is NOT serving build ${BUILD_ID}." >&2
    echo "That is a stale server — exactly the thing that produced a fictional" >&2
    echo "161 KB saving once already. Refusing to measure it." >&2
    exit 2
  fi
  echo "    serving build ${BUILD_ID}"
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
