# Lighthouse CI

`npm run lhci` → `lighthouserc.cjs`, plus `.github/workflows/lighthouse.yml` on PRs.

## Measured baseline

Median of 3 runs, desktop preset, against a **production build** (`next start`),
2026-09-19.

| Route | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/` | 0.99 | **0.85** | 1.00 | 1.00 |
| `/regulamin` | 0.99 | 0.93 | 1.00 | 1.00 |
| `/polityka-prywatnosci` | 0.99 | 0.93 | 1.00 | 1.00 |

## Do not trust that 0.99

It is measured over loopback with no throttling. The same pages ship 294 KB of
HTML and 744 KB of JavaScript (see `docs/tooling/perf-baseline.md`); on a real
mobile connection the performance score will be materially lower.

This is exactly the trap the guide warns about — "Lighthouse na dev serverze i
traktowanie wyniku jako produkcyjnego". The build type is right here, but the
*network* is not, so the number is still not a field score. Treat local
performance as a **regression signal only**: a drop from 0.99 to 0.80 means
something changed, while 0.99 itself means nothing about real users.

A real number requires a throttled run or field data (CrUX), and neither is
part of this layer.

## Thresholds, and why

```
performance     warn  >= 0.80
accessibility   warn  >= 0.90
best-practices  warn  >= 0.90
seo             ERROR >= 0.90
```

Only SEO blocks. It is the one category where the measured value (1.00) sits
comfortably above the threshold, where regressions are silent, and where the
cost of a regression is organic traffic this project depends on. 0.10 of
headroom is enough to absorb run-to-run variance without flapping.

Performance stays WARN on purpose until P0-03 is fixed. Setting a hard gate now
would fail PRs for a defect that is already written down, scheduled, and
deliberately not being fixed in this phase.

## Three accessibility findings this surfaced

New — the 2026-09-18 audit did not score accessibility. **Not fixed**, per the
scope of this phase.

| Audit | Weight | What it is |
|---|---|---|
| `meta-viewport` | 10 | `maximumScale: 1` blocks pinch-zoom |
| `list` | 7 | a `<ul>`/`<ol>` contains non-`<li>` children |
| `listitem` | 7 | an `<li>` sits outside a list parent |

**`meta-viewport` is a deliberate decision, not a bug.** `app/layout.tsx:90-95`
sets `maximumScale: 1`, and `components/layout/viewport-lock.tsx` backs it up
for browsers that ignore the meta. The comments there explain the intent — a 1:1
app-like lock. It has a genuine accessibility cost for low-vision users who rely
on pinch-zoom, and that trade-off is now measured rather than implicit. Whether
to keep it is a product call for the owner, not a defect to be quietly
"corrected" by a later agent.

`list` / `listitem` look like ordinary markup slips and are cheap to fix, but
they are still UI changes and therefore out of scope here. They account for the
0.85 vs 0.93 gap between `/` and the legal pages.

## Scope

Public routes only: `/`, `/regulamin`, `/polityka-prywatnosci`.

The dashboard, library, tool panels and admin are **excluded**. Auditing them
needs a logged-in session, and a Lighthouse report is an artifact — pointing it
at a real account writes customer data into CI storage. There is no test account
yet (`docs/tooling/playwright.md`), so the private surface stays unmeasured
rather than measured unsafely.

Reports upload to `filesystem` and then to a GitHub artifact, never to
`temporary-public-storage`. `lhci_reports/` and `.lighthouseci/` are gitignored.

## One CI hazard worth knowing

**`npm run lint` must never go into a workflow.** It resolves to `next lint`,
which in this repo is *interactive*: it prompts for ESLint configuration and
would hang a runner until timeout. This is why the Lighthouse workflow runs
`build` and nothing else before the audit, and it is called out in a comment
there so nobody helpfully adds a lint step later.

## Tightening later

After the P0/P1 work lands, re-measure and move performance from `warn` to
`error` at a threshold just under the new measured value. Do not raise
thresholds while the known findings are still open.
