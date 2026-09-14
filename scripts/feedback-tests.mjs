/**
 * THE FEEDBACK ENTRY POINT — the parts that fail silently.
 *
 * "Zgłoś błąd / zaproponuj zmianę" is one small component and one small server
 * action, and both have a failure mode that looks like success:
 *
 *   · THE KIND. The browser sends a string; the server matches it against a
 *     closed set and falls back to "other". If an <option> value and a key of
 *     FEEDBACK_KINDS ever drift apart, every bug report in the world arrives
 *     filed as "INNE" and nothing anywhere says so. So the two lists are
 *     compared, in both directions.
 *   · THE MOUNT. The component is deliberately rendered ONCE, at the end of the
 *     customer layout's <main>. Mounted anywhere else it either disappears from
 *     most screens or shows up on the sign-in page, and the only reason the
 *     fixed bottom navigation cannot cover it is that it inherits THAT
 *     element's `--page-bottom`. Both facts are asserted.
 *   · THE CLEARANCE ITSELF, measured in a browser rather than reasoned about:
 *     `--page-bottom` has to be at least as tall as the dock, or the last thing
 *     on every page sits under it.
 *   · WHAT THE REPORT CARRIES. The brief was explicit — route, viewport,
 *     device, and nothing else. A field quietly added here is personal data
 *     collected without anybody deciding to, so the context type is pinned.
 *
 * The copy itself is not checked here: scripts/i18n-check.mjs already fails on
 * a `feedback.*` key missing from any of pl/en/de.
 *
 * Run:  node scripts/feedback-tests.mjs [base-url]
 * The browser half is skipped (not failed) when no server is given.
 */
import fs from "node:fs";

const BASE = process.argv[2];
const read = (p) => fs.readFileSync(p, "utf8");

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`);
}

// ── the kinds ──────────────────────────────────────────────────────────────
const action = read("app/actions/support.ts");
const component = read("components/feedback/feedback-cta.tsx");

const kindsBlock = action.match(/const FEEDBACK_KINDS = \{([\s\S]*?)\} as const;/);
const serverKinds = kindsBlock
  ? [...kindsBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  : [];
const optionValues = [...component.matchAll(/<option value="(\w+)">/g)].map((m) => m[1]);

check("FEEDBACK_KINDS is declared", serverKinds.length > 0);
check(
  "every <option> the form offers is a kind the server knows",
  optionValues.length > 0 && optionValues.every((v) => serverKinds.includes(v)),
  `form: ${optionValues.join(", ")}\n     server: ${serverKinds.join(", ")}`,
);
check(
  "every kind the server knows is offered by the form",
  serverKinds.every((k) => optionValues.includes(k)),
  `server-only kinds: ${serverKinds.filter((k) => !optionValues.includes(k)).join(", ")}`,
);
check(
  "the kind is chosen from the enum, never taken from the request",
  /\.find\(\(k\) => k === input\.kind\) \?\? "other"/.test(action),
  "submitFeedbackAction must not write input.kind through unvalidated",
);
check(
  "an unauthenticated report is refused",
  /if \(!user\) return \{ ok: false, error: "unauthenticated" \};/.test(
    action.slice(action.indexOf("export async function submitFeedbackAction")),
  ),
);
check(
  "a report is a support thread, not a second inbox",
  /return createThreadAction\(subject, body\);/.test(action),
  "it must reuse createThreadAction so /support and /admin/support both see it",
);

// ── what it collects ───────────────────────────────────────────────────────
const ctxType = action.match(/export type FeedbackContext = \{([^}]*)\}/);
const ctxFields = ctxType ? [...ctxType[1].matchAll(/(\w+)\?:/g)].map((m) => m[1]).sort() : [];
check(
  "the report carries exactly route, viewport, agent and locale",
  JSON.stringify(ctxFields) === JSON.stringify(["agent", "locale", "route", "viewport"]),
  `found: ${ctxFields.join(", ")}`,
);
check(
  "nothing identifying is sent from the browser",
  !/context:\s*\{[\s\S]*?(email|userId|user_id|name)\s*[:,]/.test(component),
  "who sent it is the row's own user_id, filled in server-side from the session",
);

// ── the mount ──────────────────────────────────────────────────────────────
// The layout has THREE <main> elements: the work surface, and two
// single-message screens (blocked account, setup failed). The brief excludes
// the latter two by name — "nie trzeba na ekranach jednokomunikatowych" — so
// the one to find is the one carrying the page-bottom token, and the others
// must not have it.
const layout = read("app/(app)/layout.tsx");
const mains = [...layout.matchAll(/<main className="([^"]*)">([\s\S]*?)<\/main>/g)];
const shell = mains.filter((m) => m[1].includes("pb-[var(--page-bottom)]"));
check(
  "exactly one <main> in the customer layout is the work surface",
  shell.length === 1,
  `${mains.length} <main> elements, ${shell.length} carrying --page-bottom`,
);
if (shell.length === 1) {
  check(
    "<FeedbackCTA /> is the last thing inside it",
    /<FeedbackCTA \/>\s*$/.test(shell[0][2].trim()),
    shell[0][2].trim().slice(-140),
  );
}
check(
  "the single-message screens do not get it",
  mains.filter((m) => m[2].includes("<FeedbackCTA")).length === 1,
  "blocked-account and setup-failed screens are excluded by the brief",
);

// ── nothing switches it off ────────────────────────────────────────────────
// It WAS switched off once, on every viewport-locked generator and tool from
// 1024 up, because a full-height workspace left no room after it. That is the
// whole product's desktop, and it was reported from outside before anyone here
// noticed. The room is made now instead; this makes sure nobody makes the same
// trade again by reaching for `display: none`.
const css = read("app/globals.css");
const rules = [...css.matchAll(/([^{}]*\[data-feedback-cta\][^{]*)\{([^}]*)\}/g)]
  // The capture reaches back past the rule's own comment; the selector is
  // what a failure needs to name, so the prose is dropped.
  .map((m) => [m[0], m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim(), m[2]]);
check(
  "no stylesheet rule hides the feedback CTA",
  !rules.some((r) => /display\s*:\s*none|visibility\s*:\s*hidden/.test(r[2])),
  rules.filter((r) => /display\s*:\s*none|visibility\s*:\s*hidden/.test(r[2]))
    .map((r) => `${r[1]} { ${r[2].trim()} }`).join("\n     "),
);
check(
  "no responsive utility hides it either",
  !/(sm|md|lg|xl|2xl):hidden/.test(component.match(/<div data-feedback-cta className="([^"]*)"/)?.[1] ?? ""),
  "a `lg:hidden` on the block is the other way this disappears from a desktop",
);
for (const other of ["app/(auth)/layout.tsx", "app/admin/layout.tsx"]) {
  check(
    `${other} does NOT mount it`,
    !read(other).includes("FeedbackCTA"),
    "sign-in and the admin panel are out of scope per the brief",
  );
}
check(
  "it is one component, used once — not copied into pages",
  [...fs.globSync("{app,components}/**/*.tsx")]
    .filter((f) => f !== "components/feedback/feedback-cta.tsx" && read(f).includes("<FeedbackCTA"))
    .length === 1,
  "exactly one file may render it",
);

// ── the clearance, measured ────────────────────────────────────────────────
if (!BASE) {
  console.log("… dock clearance not measured (pass a base URL to include it)");
} else {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  const px = await page.evaluate(() => {
    const probe = document.createElement("div");
    // Resolve the two tokens by letting the browser do the arithmetic.
    probe.style.cssText = "position:absolute;visibility:hidden;height:var(--page-bottom);width:var(--dock-h)";
    document.body.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { pageBottom: r.height, dock: r.width };
  });
  check(
    "--page-bottom clears the fixed bottom navigation",
    px.pageBottom >= px.dock && px.dock > 0,
    `--page-bottom ${px.pageBottom}px vs --dock-h ${px.dock}px`,
  );
  console.log(`     (--page-bottom ${px.pageBottom}px, dock ${px.dock}px — ${Math.round(px.pageBottom - px.dock)}px of air)`);
  await browser.close();
}

console.log(failed === 0 ? "\nfeedback: all checks passed" : `\nfeedback: ${failed} check(s) failed`);
process.exit(failed > 0 ? 1 : 0);
