/**
 * Lighthouse CI — regression guard for the PUBLIC pages only.
 *
 * WHAT IS AUDITED, AND WHAT IS DELIBERATELY NOT
 * Only routes an anonymous visitor can reach. The client dashboard, library,
 * tool panels and admin are all excluded on purpose: auditing them requires a
 * logged-in session, and pointing a Lighthouse run at a real account puts a
 * customer's data into a report artifact. There is no test account yet
 * (see docs/tooling/playwright.md), so the private surface stays unmeasured
 * rather than measured unsafely.
 *
 * WHY THE THRESHOLDS LOOK LIKE THIS
 * They are set from a measured baseline, not from aspiration. Performance,
 * accessibility and best-practices are WARN — they report, they do not block.
 * Turning on a hard performance gate before the P0/P1 remediation would fail
 * every PR for a reason everyone already knows about (P0-03: the whole i18n
 * dictionary is serialised into each page), which trains people to ignore the
 * gate.
 *
 * SEO is the one ERROR, because SEO regressions are silent, cheap to avoid,
 * and this project depends on organic reach. The threshold is set just under
 * the measured value so it catches a real drop without flapping on variance.
 *
 * Tighten these AFTER remediation, not before.
 */
const CHROME_PATH =
  process.env.CHROME_PATH ||
  process.env.LHCI_CHROME_PATH ||
  undefined;

module.exports = {
  ci: {
    collect: {
      // `next start`, never `next dev`. Dev-server numbers are meaningless
      // here: no minification, no chunking, on-demand compilation.
      startServerCommand: "npm run start",
      startServerReadyPattern: "Ready in",
      startServerReadyTimeout: 60000,
      url: [
        "http://localhost:3000/",
        "http://localhost:3000/regulamin",
        "http://localhost:3000/polityka-prywatnosci",
      ],
      // Three runs, median reported. A single Lighthouse run varies enough to
      // produce a different verdict on identical code.
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
        chromePath: CHROME_PATH,
        chromeFlags: "--no-sandbox --disable-dev-shm-usage",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.8 }],
        "categories:accessibility": ["warn", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        // Set from the measured baseline. See docs/tooling/lighthouse.md.
        "categories:seo": ["error", { minScore: 0.9 }],
      },
    },
    upload: {
      // Never temporary-public-storage. These reports describe a pre-launch
      // app with known unpatched findings; they are not for a public bucket.
      target: "filesystem",
      outputDir: "./lhci_reports",
    },
  },
};
