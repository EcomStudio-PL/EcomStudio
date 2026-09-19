# Playwright smoke harness

`npm run test:smoke -- <base-url>` → `scripts/smoke-probe.mjs`

## Why no `@playwright/test`, and no new dependency

The implementation guide asks for `@playwright/test`. Installing it here was
tried and rejected, for a concrete reason rather than a stylistic one:

```
next@15.5.23 declares  peerOptional @playwright/test@^1.51.1
this repo has          playwright@1.49.1  (devDependency)
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
- No horizontal overflow at 320 / 375 / 430 / 768 px
- A theme class resolves and the body background is not transparent
- `/?auth=login` presents a password field and a `role="dialog"` — the dialog
  opens; nothing is typed into it

Page weights are **recorded, not asserted**. Thresholds belong to Lighthouse CI.

## Two corrections worth keeping

Both assertions failed on first run, and in both cases the test was wrong, not
the product. Recording them so nobody "fixes" the app to satisfy a bad check.

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
waiting *is* the assertion.

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
