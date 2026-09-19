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
carries the 13 namespaces it renders instead of all 87.

| Route | wire before | wire after | decoded before | decoded after |
|---|---|---|---|---|
| `/` | 89.9 KB | **40.6 KB** | 294.5 KB | **142.0 KB** |
| `/regulamin` | 80.5 KB | **31.2 KB** | 246.9 KB | **94.4 KB** |
| `/polityka-prywatnosci` | 80.5 KB | **31.2 KB** | 247.1 KB | **94.6 KB** |

Both currencies, stated separately on purpose: ~49 KB less transferred and
~152 KB less to decode and parse on `/`; ~61% off both on the legal pages. The
signed-in app and `/admin` keep about three quarters of the dictionary, because
that is what those surfaces genuinely render — splitting them further means
per-route providers, which is a larger change than this phase allows.

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

Same command, same base URL, same build type (`next start`, never `next dev` —
dev server numbers are meaningless for this purpose). Compare byte counts and
request counts first; treat timing deltas under ~20% as noise at this sample
size (single run per cell).
