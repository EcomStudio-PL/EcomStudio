/**
 * THE MOBILE MENU, DRIVEN THROUGH REAL ROUTES IN A REAL BROWSER.
 *
 * `npm run test:nav` proves the RULE over every route in the product. It
 * cannot prove the rule is wired to the component — that the section really
 * renders expanded, that exactly one row really carries the highlight, and
 * that closing and reopening the menu does not quietly reset either.
 *
 * This does. It mounts the real `CustomerDrawer` and moves between routes with
 * `history.pushState`, which Next 15 feeds into `usePathname()`, so the
 * component computes from the same pathname a navigation would give it. Then
 * it reads the DOM: `aria-current="page"` for the highlight and
 * `aria-expanded` on the section headings.
 *
 * The sequence is the one from the brief, per route: go to the route, open the
 * menu, look, close it, open it again, look again — because the original bug
 * only showed itself on the SECOND open.
 *
 * Run:  npm run test:drawer -- <base-url>
 * Needs the temporary /probe-tmp/drawer route.
 */
import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) { console.error("usage: npm run test:drawer -- <base-url>"); process.exit(2); }

const WIDTHS = [375, 390, 414, 430];

/** route → the label that must be the only highlighted one. */
const CASES = [
  { route: "/retusz", section: "EDYTUJ", label: "Retusz" },
  { route: "/tools/editor", section: "EDYTUJ", label: "Edycja" },
  { route: "/tools/resize", section: "EDYTUJ", label: "Zmiana rozmiaru" },
  { route: "/tools/compress", section: "EDYTUJ", label: "Kompresja" },
  { route: "/tools", section: "EDYTUJ", label: "Wszystkie narz" },
  { route: "/prompts", section: "TWORZENIE", label: null },
  { route: "/home", section: null, label: null },
  { route: "/library", section: null, label: null },
  { route: "/settings", section: null, label: null },
];

let failed = 0;
const note = (ok, line) => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

// The probe route is temporary and deleted before the commit. Without it there
// is no drawer to mount, so say so and stop rather than failing as if the menu
// were broken. `npm run test:nav` still covers the rule itself, everywhere.
const PROBE = "/probe-tmp/drawer";
if (!(await fetch(`${BASE}${PROBE}`).then((r) => r.ok).catch(() => false))) {
  console.log(`SKIPPED: ${BASE}${PROBE} is not served.`);
  console.log("Recreate the probe route to run this; `npm run test:nav` covers the logic meanwhile.");
  process.exit(0);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

/** Open the drawer and read back what it is showing. */
async function readDrawer(page) {
  await page.click("[data-probe-open]");
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(260);
  const state = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const rows = [...dialog.querySelectorAll('a[aria-current="page"]')]
      .map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim().slice(0, 40) }));
    // Each section heading is a button with aria-expanded; its label is the
    // group caption, and what follows it in the DOM is its rows.
    const sections = [...dialog.querySelectorAll("button[aria-expanded]")].map((b) => ({
      title: b.textContent.trim(),
      expanded: b.getAttribute("aria-expanded") === "true",
      // rows that belong to this heading = the links in its sibling panel
      lit: b.parentElement
        ? [...b.parentElement.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute("href"))
        : [],
    }));
    return { rows, sections, pathname: location.pathname };
  });
  // Closed the way a seller closes it. The panel covers the page while it is
  // open, so anything outside the dialog is unclickable by design.
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5000 });
  return state;
}

for (const w of WIDTHS) {
  console.log(`\n══ ${w}px ══`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/probe-tmp/drawer`, { waitUntil: "networkidle", timeout: 60000 });

  for (const c of CASES) {
    // Arrive at the route exactly as a navigation would leave us.
    await page.evaluate((r) => window.history.pushState(null, "", r), c.route);
    await page.click("[data-probe-sync]");
    await page.waitForTimeout(120);

    const first = await readDrawer(page);
    // …and again, because the bug only appeared on the second open.
    const second = await readDrawer(page);

    const ok = (s) => s.rows.length === 1;
    note(ok(first) && ok(second),
      `${c.route}: exactly one row lit — 1st open ${first.rows.length}, 2nd open ${second.rows.length}` +
      (first.rows.length ? ` (${first.rows.map((r) => r.href).join(" + ")})` : ""));

    if (c.label) {
      const hit = first.rows[0]?.text ?? "";
      note(hit.includes(c.label), `${c.route}: the lit row is "${c.label}" — got "${hit}"`);
      if (c.route !== "/tools") {
        note(!first.rows.some((r) => r.href === "/tools"),
          `${c.route}: „Wszystkie narzędzia” stays dark`);
      }
    }

    if (c.section) {
      const sec = second.sections.find((s) => s.title.toUpperCase().startsWith(c.section));
      note(Boolean(sec?.expanded),
        `${c.route}: ${c.section} expanded on the SECOND open — ${sec ? sec.expanded : "section missing"}`);
      note(Boolean(sec && sec.lit.length === 1),
        `${c.route}: …and the highlight is inside it (${sec?.lit.join(",") || "none"})`);
    }

    // No section may open without holding the lit row.
    const strays = second.sections.filter((s) => s.expanded && s.lit.length === 0 && !/GŁÓWNE|OBRAZ|KONTO/i.test(s.title));
    note(strays.length === 0,
      `${c.route}: no collapsible section opens empty (${strays.map((s) => s.title).join(", ") || "none"})`);
  }

  /* A manual collapse is respected, and expires when the route changes. */
  await page.evaluate(() => window.history.pushState(null, "", "/tools/resize"));
  await page.click("[data-probe-sync]");
  await page.waitForTimeout(120);
  await page.click("[data-probe-open]");
  await page.waitForSelector('[role="dialog"]');
  await page.waitForTimeout(240);
  const heading = await page.evaluateHandle(() =>
    [...document.querySelectorAll('[role="dialog"] button[aria-expanded]')]
      .find((b) => b.getAttribute("aria-expanded") === "true" && b.parentElement.querySelector('a[aria-current="page"]')));
  await heading.asElement()?.click();
  await page.waitForTimeout(200);
  const collapsed = await page.evaluate(() =>
    ![...document.querySelectorAll('[role="dialog"] button[aria-expanded]')]
      .some((b) => b.getAttribute("aria-expanded") === "true" && b.parentElement.querySelector('a[aria-current="page"]')));
  note(collapsed, "a manual collapse of the active section is respected");
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5000 });

  await page.evaluate(() => window.history.pushState(null, "", "/tools/compress"));
  await page.click("[data-probe-sync]");
  await page.waitForTimeout(120);
  const afterNav = await readDrawer(page);
  note(afterNav.rows.length === 1 && afterNav.rows[0].href === "/tools/compress",
    `…and the next route takes over again (${afterNav.rows.map((r) => r.href).join(",") || "nothing lit"})`);

  /* back / forward */
  await page.goBack().catch(() => {});
  await page.click("[data-probe-sync]").catch(() => {});
  await page.waitForTimeout(160);
  const back = await readDrawer(page);
  note(back.rows.length === 1, `back → one row lit at ${back.pathname} (${back.rows.map((r) => r.href).join(",")})`);
  await page.goForward().catch(() => {});
  await page.click("[data-probe-sync]").catch(() => {});
  await page.waitForTimeout(160);
  const fwd = await readDrawer(page);
  note(fwd.rows.length === 1, `forward → one row lit at ${fwd.pathname} (${fwd.rows.map((r) => r.href).join(",")})`);

  await ctx.close();
}

/**
 * A COLD PAGE LOAD REMEMBERS NOTHING — which is the whole point.
 *
 * The drawer keeps no persisted state, so "after a refresh" means "from a
 * browser that has never rendered this component". Reloading the tool route
 * itself is not available here (it is behind auth, and this sandbox cannot
 * reach Supabase), so the probe page is reloaded instead and the route is
 * re-entered from scratch: a genuinely fresh JS context, same answer expected.
 */
console.log("\n══ cold load (refresh / direct URL) ══");
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const enter = async (route) => {
    await page.evaluate((r) => window.history.pushState(null, "", r), route);
    await page.click("[data-probe-sync]");
    await page.waitForTimeout(140);
    return readDrawer(page);
  };

  await page.goto(`${BASE}/probe-tmp/drawer`, { waitUntil: "networkidle", timeout: 60000 });
  const warm = await enter("/tools/resize");

  // A new document: nothing of the previous render survives. `goto` rather
  // than `reload`, because pushState left /tools/resize in the history entry
  // and reloading that would ask the server for a page behind auth.
  await page.goto(`${BASE}/probe-tmp/drawer`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(250);
  const cold = await enter("/tools/resize");

  note(warm.rows.length === 1 && cold.rows.length === 1
    && warm.rows[0].href === cold.rows[0].href,
    `a fresh document lights the same single row (${warm.rows[0]?.href} → ${cold.rows[0]?.href})`);
  const sec = cold.sections.find((x) => x.title.toUpperCase().startsWith("EDYTUJ"));
  note(Boolean(sec?.expanded), `…and EDYTUJ is expanded on that cold load (${sec?.expanded})`);

  // Entering a different route first must not leave anything behind.
  await page.goto(`${BASE}/probe-tmp/drawer`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(250);
  await enter("/prompts");
  const afterOther = await enter("/tools/resize");
  note(afterOther.rows.length === 1 && afterOther.rows[0].href === "/tools/resize",
    `arriving via another route changes nothing (${afterOther.rows.map((r) => r.href).join(",")})`);

  await ctx.close();
}

await browser.close();
console.log(failed === 0 ? "\nAll drawer probes passed." : `\n${failed} drawer probe(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
