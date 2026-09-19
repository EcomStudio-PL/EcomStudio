# Performance baseline — the before-picture

`npm run perf:baseline -- <base-url>` → `scripts/perf-baseline.mjs`

Diagnostic only. It measures and prints; it asserts nothing and fails nothing.
It exists so that an optimisation in Prompt #2 can be **proved** rather than
claimed.

## Chrome DevTools MCP — not installed

The MCP/plugin is not in this account's plugin catalog, so installing it is an
operator action:

```
/plugin marketplace add ChromeDevTools/chrome-devtools-mcp
/plugin install chrome-devtools-mcp@chrome-devtools-plugins
```

Restart Claude Code, then confirm it appears under `/skills`. If a Chrome
DevTools MCP was ever added manually, remove that entry first — two identical
servers is the failure mode the guide warns about.

Caveat worth repeating: the MCP can read the contents of the Chrome session it
drives. Do not run it in a browser profile logged into a bank, personal mail, or
a production admin panel. Use a dedicated profile.

Until then, `scripts/perf-baseline.mjs` covers the measuring half via CDP
through the Playwright dependency that is already installed.

## Recorded baseline

**Conditions: LOCAL / ESTIMATED.** Production build (`next start`) served from
localhost, loopback network, no latency, no throttling. Absolute timings are
therefore optimistic and are **not** comparable to field data.

### Wire bytes vs decoded bytes — read this before quoting a number

These are two different figures and they differ by roughly 3x, because the
responses are gzipped (Lighthouse `uses-text-compression` scores 1).

- **wire** — what the connection actually pays for, after compression.
- **decoded** — what the parser and memory pay for, after decompression.

An earlier version of this document printed the DECODED figure under the
heading "Transfer" and claimed the pages "ship 294 KB of HTML". That was wrong:
294 KB is the decoded size; the wire cost of that document is 89.5 KB. The
script now reports both, labelled, and the numbers below are corrected.

Commit `d2a955f` + fixes, 2026-09-19.

| Route | Viewport | TTFB | LCP | CLS | HTML wire | HTML decoded | Total wire | Total decoded | Reqs |
|---|---|---|---|---|---|---|---|---|---|
| `/` | desktop 1280 | 121 ms | 320 ms | 0.023 | **89.5 KB** | 294.5 KB | **749.3 KB** | 1575.0 KB | 28 |
| `/regulamin` | desktop 1280 | 31 ms | 152 ms | 0.000 | **80.1 KB** | 248.3 KB | **710.2 KB** | 1485.8 KB | 26 |

Wire bytes by type, `/`:

```
script      237.4 KB
image       214.8 KB
font        174.7 KB
document     89.5 KB
stylesheet   31.6 KB
fetch         1.3 KB
```

These match Lighthouse's own `resource-summary` for the same build
(script 237.4 KB, document 89.5 KB), which is the cross-check that caught the
original error.

Largest chunks, wire / decoded:

```
54.4 KB /  188.4 KB  /_next/static/chunks/1336-…js
54.3 KB /  169.0 KB  /_next/static/chunks/4bd1b696-…js
46.3 KB /  170.1 KB  /_next/static/chunks/1255-…js
14.7 KB /   62.4 KB  /_next/static/chunks/44530001-…js
11.2 KB /   30.8 KB  /_next/static/chunks/app/layout-…js
10.2 KB /   32.4 KB  /_next/static/chunks/8720-…js
```

## What the numbers say about P0-03

**The structural finding holds; the impact is smaller on the wire than first stated.**

`/regulamin` is a static legal document — text, no product data, no
personalisation. Decoded, it is 248.3 KB. `/` is 294.5 KB. The difference
between a marketing homepage and a page of terms is only ~46 KB, so roughly
**248 KB is constant per-page overhead rather than content**. `pl.json` is
237,997 bytes. That is the shape P0-03 describes, and it is confirmed.

But state the cost correctly in both currencies:

- **Wire:** ~80 KB per page, compressed. Real, repeated on every navigation
  that is not cached, and worth removing — but not the 248 KB it first looked
  like. JSON with repetitive keys compresses very well.
- **Decoded / parse / memory:** the full ~238 KB, on every page, on every
  device. This is the cost that does not compress away, and on a low-end phone
  it is the one that hurts.

The earlier claim of "294 KB shipped" overstated the network cost by ~3.3x.
The fix is still worth doing; the justification is parse and memory cost first,
bandwidth second.

### Measured after the fix (2026-09-19, same production build, same machine)

`lib/i18n/scopes.ts` splits the dictionary by surface, so a public page now
carries the 21 namespaces it renders instead of all 87.

| Route | wire before | wire after | decoded before | decoded after |
|---|---|---|---|---|
| `/` | 89.9 KB | **48.9 KB** | 294.5 KB | **165.6 KB** |
| `/regulamin` | 80.5 KB | **39.4 KB** | 246.9 KB | **118.0 KB** |
| `/polityka-prywatnosci` | 80.5 KB | **39.4 KB** | 247.1 KB | **118.2 KB** |

Both currencies, stated separately on purpose: ~41 KB less transferred and
~129 KB less to decode and parse on `/`; ~51% off both on the legal pages. The
signed-in app and `/admin` keep about four fifths of the dictionary, because
that is what those surfaces genuinely render — splitting them further means
per-route providers, which is a larger change than this phase allows.

An earlier revision of this table claimed 40.6 KB / 142.0 KB for `/`. Those
figures were real, but they were measured against a manifest that was missing
nine namespaces, so four screens rendered humanised English. The numbers above
are from the corrected manifest. Bytes bought with a broken page are not a
saving.

Hydrated `document.body.innerText` is byte-identical before and after on all
three routes, which is the check that matters: a missing namespace does not
throw, it silently prints a humanised key.

**Zero duplicate requests in the browser.** The audit's duplicate-fetch
findings (P1-34, P1-28) are **server-side**; the public surface does not
re-fetch anything client-side.

**CLS is effectively zero and LCP is early** under ideal conditions. If field
data later shows poor LCP, the cause is network and payload — not layout
instability.

## What this baseline cannot tell you

- Nothing about authenticated routes. `/home`, `/library`, the tool panels and
  admin are all behind auth, and there is no test account (see
  `docs/tooling/playwright.md`). The heaviest screens in the product are
  therefore **unmeasured**.
- Nothing about real-world latency. Loopback hides TTFB, which is precisely
  where the fra1↔eu-central-1 round trips and the middleware `getUser()` hop
  (P1-28) would show up.
- Nothing about cache behaviour across navigations — single cold loads only.

## Re-running after a change

**Use `npm run perf:capture -- <out.json>`, not `perf:baseline` by hand.**

`perf:baseline` points a browser at whatever is listening on the port, which is
fine right up until the thing listening was started from a *different build*
than the one now on disk. `perf:capture` owns the whole sequence instead — stop
the port, build, start a server from **that** build, measure, and assert that
no request failed.

That guard is not hypothetical. During Stage 3 an early run reported a **161 KB**
saving on `/regulamin`. It was false: `npm run build` had been run under a live
`next start`, the server kept serving the previous build's HTML, and the chunks
whose content hashes had changed were no longer on disk. A refused request
transfers no bytes, so the page read as far lighter than it was. The real
saving is **66 KB**.

The numbers, from the artifacts (an earlier version of this page got them
wrong, and the correction is the useful part):

| run | JS wire | requests | failed |
| --- | --- | --- | --- |
| baseline, static import | 281,733 B | 32 | — |
| the bad run | 116,875 B | **30** | ~12 |
| honest AFTER | 214,272 B | 32 | 0 |

Two things follow. First, **it was not one 46 KB chunk** — a deliberate
reproduction of the same state recorded *twelve* failed chunk requests, which
is the only way a 165 KB apparent saving is arithmetically possible. Second,
**the request count did drop**, 32 → 30, so a stable request count was never
the reassurance to look for here. Both claims appeared in the original
write-up and both were wrong; an independent review caught them.

Three things now make the mistake hard to publish:

- `perf-baseline.mjs` records failed requests — including transport-level ones
  (reset, refused, empty, blocked) that never produce an HTTP status and so
  fire no `response` event at all. Benign `ERR_ABORTED` cancellations, which
  Next emits routinely when it tears down in-flight RSC prefetches, are
  excluded: a request the page *stopped wanting* is not a request it failed to
  get.
- `perf-delta.mjs` **refuses** to difference a row where either side had a
  failure — or where either side predates the guard and therefore has no
  `failedRequests` field at all. A missing field is treated as *unusable*, not
  as zero failures; reading it as zero left the guard inert on the one file
  that most needed it.
- `perf-capture.sh` refuses to run when it cannot clear the port, kills the
  server's whole process group rather than just the `npm` wrapper, and — the
  step that actually ties it together — **checks that the served HTML carries
  the `BUILD_ID` it just built**. A process starting and a port answering are
  circumstantial; the build id is not.

All of these were mutation-tested: by hiding a chunk on disk, by destroying a
chunk's socket at the transport level, and by pointing the delta tool at the
pre-guard baseline.

## Comparing two runs

```
npm run perf:capture -- /tmp/before.json     # on the old code
npm run perf:capture -- /tmp/after.json      # on the new code
npm run perf:delta -- /tmp/before.json /tmp/after.json
```

`perf:delta` prints a per-metric delta for every route × viewport and excludes
any row it cannot honestly compare: one present in only one run, one whose
redirect status changed (an anonymous hit on a protected route measures the
*redirect*, not the page), or one with a failed request. A mismatch is neither
a pass nor a failure — it means the two runs describe different things.

Compare byte counts and request counts first. Treat timing deltas under ~20% as
noise at this sample size; LCP in particular moves in both directions between
identical builds here, so it is reported and not claimed.

## Guarding a specific payload

`npm run test:publicbundle -- <base-url>` asserts that no JS chunk fetched by
`/`, `/regulamin` or `/polityka-prywatnosci` contains the Supabase auth client
(P1-27). It is a **browser** probe, not a build-manifest check, and that
distinction is the point: a `next/dynamic` wrapper removes a module from the
manifest while the browser still downloads it, so a manifest check goes green
for a change that saves nothing. This one reads the contents of every chunk the
page actually fetched, so it also survives content-hash renames.
