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
localhost, loopback network, no latency, no throttling, warm cache disabled per
fresh context. Absolute timings are therefore optimistic and are **not**
comparable to field data. The *byte counts* and *request counts* are real and
are the numbers worth tracking.

Commit `195728d`, 2026-09-19.

| Route | Viewport | TTFB | LCP | CLS | HTML | Requests | Transfer |
|---|---|---|---|---|---|---|---|
| `/` | desktop 1280 | — | — | — | 294.6 KB | 28 | 1574.8 KB |
| `/` | mobile 390 | 44 ms | 228 ms | 0.0007 | 294.6 KB | 28 | 1574.8 KB |
| `/regulamin` | desktop 1280 | 108 ms | 276 ms | 0 | 248.2 KB | 26 | 1485.9 KB |
| `/regulamin` | mobile 390 | 33 ms | 176 ms | 0 | 248.3 KB | 26 | 1485.9 KB |

Transfer by type, `/` mobile:

```
script      744.4 KB
document    287.6 KB
image       210.7 KB
font        170.5 KB
stylesheet  161.7 KB
fetch         0.0 KB
```

Largest chunks (identical across all four runs):

```
188.4 KB  /_next/static/chunks/1336-6196dec0c548c4f2.js
170.1 KB  /_next/static/chunks/1255-d3668eefd1b4a69b.js
169.0 KB  /_next/static/chunks/4bd1b696-100b9d70ed4e49c1.js
 62.4 KB  /_next/static/chunks/44530001-a26648c04669f22e.js
 32.4 KB  /_next/static/chunks/8720-1a27e2f69afa3d88.js
 30.8 KB  /_next/static/chunks/app/layout-defff713c92d7eca.js
```

## What the numbers already say

**The HTML floor corroborates P0-03 independently.** `/regulamin` is a static
legal document — text, no product data, no personalisation — and it ships
**248 KB of HTML**. `/` ships 294 KB. The difference between a marketing
homepage and a page of terms is only ~46 KB, which means roughly **248 KB is
constant per-page overhead**, not content. That is the shape you would expect if
the full i18n dictionary is serialised into every response, which is exactly
what the audit's P0-03 describes. Two independent measurements now agree:
the production login page at 251,861 chars, and this.

**Zero duplicate requests in the browser.** Worth stating plainly, because it
narrows the search. The audit's duplicate-fetch findings (P1-34 on
`/admin/newsletter`, P1-28 on middleware re-validating `/api/*`) are
**server-side**; the public surface does not re-fetch anything client-side.
Nobody should go looking for a client-side duplicate-request problem here.

**CLS is effectively zero and LCP is early** on these routes, under ideal
conditions. If Lighthouse or field data later shows poor LCP, the cause is
network and payload — not layout instability or a late-discovered hero.

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
