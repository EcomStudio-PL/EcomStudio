# Playwright smoke harness

`npm run test:smoke -- <base-url>` → `scripts/smoke-probe.mjs`

## Why no `@playwright/test`, and no new dependency

The implementation guide asks for `@playwright/test`. Installing it here was
tried and rejected, for a concrete reason rather than a stylistic one:

```
next@15.5.23 declares  peerOptional @playwright/test@^1.51.1
this repo declares     playwright@^1.49.1 (devDependency; lockfile pins 1.49.1)
```

Pinning `@playwright/test` to 1.49.1 fails peer resolution against Next.
Installing `^1.51.1` instead satisfies Next but puts a second, newer Playwright
core beside the existing one — and the browser build this environment provides
(`chromium-1194`) is matched to 1.49.1. A test runner expecting a different
browser revision is a flaky suite, which is worse than no suite.

So the harness is built on the `playwright` package the repo **already has**,
following the convention the existing `scripts/*-probe.mjs` files established.
Net dependency change: **zero**. Net lockfile change: **zero**.

`@playwright/cli` + Skills, as described in the guide, is a *global/agent-level*
install and not a repo dependency. That part remains available to the operator
and does not conflict with this.

## What it checks

All of it is reachable by an anonymous visitor. Nothing logs in, submits a form,
uploads, spends a credit or calls an AI provider.

- `/`, `/regulamin`, `/polityka-prywatnosci` → 200, non-trivial body, **no
  console errors**, **no failed requests**
- `/robots.txt` and `/sitemap.xml` → 200, non-empty, robots points at a sitemap
  and does not carry a bare `Disallow: /`
- Layout fits at 320 / 375 / 430 / 768 px **with the CSS clip backstop neutralised** (see below)
- A theme class resolves and the body background is not transparent
- `/?auth=login` presents a password field and a `role="dialog"` — the dialog
  opens; nothing is typed into it

DOM sizes are **recorded, not asserted**, and they are DECODED sizes — not wire
bytes. Thresholds belong to Lighthouse CI; real transfer sizes belong to
`npm run perf:baseline`.

## Three corrections worth keeping

All three were bugs in the TEST, not the product. Recorded so nobody "fixes"
the app to satisfy a bad check.

**1. The public surface is dark-only, on purpose.**
Measured on 2026-09-19: `documentElement.className` is `"dark"` under *both*
`prefers-color-scheme` values, on `/` and `/regulamin`, with body background
`rgb(13, 8, 19)` in both. The natural assertion — "light and dark must differ" —
is therefore wrong for these routes. The light/dark contract belongs to the
authenticated app shell, which this harness cannot reach. The check now asserts
that *a* theme resolves, which is what is actually true and still worth guarding.

**2. The auth dialog is client-mounted.**
It does not exist at `waitUntil: "load"`. Asserting immediately reported "no
password field" on a page that has one. The check now waits for the selector —
waiting *is* the assertion. The same fix was applied to the console-error and
failed-request checks: those now settle on `networkidle` first, because React
hydration mismatches — the most common console-error class in a Next app —
are thrown after `load` and were being missed entirely.

**3. The horizontal-overflow check could not fail.**
The obvious assertion is `documentElement.scrollWidth <= clientWidth`. In this
repo it is worthless: `app/globals.css` sets `overflow-x: clip` on both `html`
and `body` (the "RESPONSIVE FLOOR" backstop), and `clip` removes the scrolling
box, clamping `scrollWidth` to `clientWidth` no matter what overruns.

Measured with this repo's own Chromium — a 3000px child in a 320px viewport
reports `scrollWidth` 3008 without the rule and **320 with it**. Four of the
advertised checks were passing unconditionally.

The check now neutralises `overflow-x` and `max-width` for the duration of the
measurement, which asks the question worth asking: does the layout *fit*, or is
it merely being clipped? Clipped overflow is still broken — the content is cut
off, just silently. Mutation-tested after the fix: injecting a 3000px element
into the live page now fails the check.

## What is deliberately NOT covered — REQUIRED MANUAL STEP

The authenticated half of the matrix is not implemented, because it needs a
dedicated test account and this project has none:

- login / logout / re-login of an existing user
- client dashboard
- library listing and history
- a tool page
- credits and plan (read only)
- admin smoke — needs a **separate**, non-personal admin account

**Do not unblock this with a personal or operator account.** Browser automation
can read anything that session can read. **Do not point it at production data.**

To unblock: create a test account with throwaway data, put its credentials in
the environment (never in this repo), and extend `scripts/smoke-probe.mjs`.

## Environment

The browser is resolved in this order:

1. `PLAYWRIGHT_CHROMIUM_PATH`, if set
2. the container path `/opt/pw-browsers/chromium_headless_shell-1194/...`, if present
3. Playwright's own resolution

The existing probe scripts hardcode (2), which is correct in this container and
wrong on a CI runner. The smoke probe does not, so it is portable.
