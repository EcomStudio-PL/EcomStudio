/**
 * THE MOBILE MENU, DRIVEN THROUGH REAL ROUTES IN A REAL BROWSER.
 *
 * `npm run test:nav` proves the active-route RULE over every route in the
 * product and `npm run test:credits` proves the meter's arithmetic. Neither can
 * prove either one is WIRED to the component — that the section really renders
 * expanded, that one row really carries the highlight, that the bar really
 * turns red at 95 %, that the buttons really point at pages that exist.
 *
 * This does. It mounts the real `CustomerDrawer` with real account shapes and
 * moves between routes with `history.pushState`, which Next 15 feeds into
 * `usePathname()`, so the component computes from the same pathname a
 * navigation would give it. Then it reads the DOM and the COMPUTED styles.
 *
 * What it measures, in order:
 *   A. ONE CARD. Name, plan badge, balance, meter and both buttons share a
 *      single surface — not four boxes that happen to be adjacent.
 *   B. THE METER. Its colour and width at 0 / 10 / 60 / 80 / 95 / 100 % of a
 *      REAL plan allowance, read back as computed pixels, plus the no-limit
 *      case which must stay neutral and show no percentage.
 *   C. THE STRUCTURE. Four sections, all collapsed, no "Tworzenie", no
 *      "Gotowy generator", no empty heading and no gap where one used to be.
 *   D. THE ROUTE. The section holding the current page opens itself and
 *      exactly one row inside it lights up — on the second open too, because
 *      that is where the original defect lived.
 *   E. THE BOTTOM BAR. Sign-out, flags and the theme pill on one line, one
 *      height, inside the panel, above the safe area.
 *   F. ADMIN. The row exists for an admin and does not for a customer.
 *   G. GEOMETRY, at eight phone widths: nothing overflows, nothing is
 *      truncated, the list scrolls, the bar does not.
 *
 * Run:  npm run test:drawer -- <base-url>
 * Needs the temporary /probe-tmp/drawer route; skips cleanly without it.
 */
import { chromium } from "playwright";

const BASE = process.argv[2];
if (!BASE) { console.error("usage: npm run test:drawer -- <base-url>"); process.exit(2); }

const PROBE = "/probe-tmp/drawer";
if (!(await fetch(`${BASE}${PROBE}`).then((r) => r.ok).catch(() => false))) {
  console.log(`SKIPPED: ${BASE}${PROBE} is not served (temporary probe route).`);
  console.log("Recreate it to run this; `npm run test:nav` and `npm run test:credits` cover the logic meanwhile.");
  process.exit(0);
}

/** 320 and 360 are the floors; 393/412 are the Pixel and the common Android. */
const WIDTHS = [320, 360, 375, 390, 393, 412, 414, 430];

/** route → the section that must open itself, and the row that must light up. */
const CASES = [
  { route: "/retusz", section: "NARZĘDZIA", label: "Retusz" },
  { route: "/tools/editor", section: "NARZĘDZIA", label: "Edycja" },
  { route: "/tools/resize", section: "NARZĘDZIA", label: "Zmiana rozmiaru" },
  { route: "/tools/compress", section: "NARZĘDZIA", label: "Kompresja" },
  { route: "/tools", section: "NARZĘDZIA", label: "Wszystkie narz" },
  { route: "/k/moda", section: "OBRAZY", label: "Moda" },
  { route: "/k/ecommerce", section: "OBRAZY", label: "E-commerce" },
  { route: "/home", section: "GŁÓWNE", label: "Strona główna" },
  { route: "/library", section: "GŁÓWNE", label: "Biblioteka" },
  { route: "/settings", section: "GŁÓWNE", label: "Ustawienia" },
  { route: "/support", section: "GŁÓWNE", label: "Pomoc" },
  { route: "/wideo", section: "WIDEO", label: null },
];

let failed = 0;
const note = (ok, line) => { if (!ok) failed++; console.log(`${ok ? "✓" : "✗"} ${line}`); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

/* ── reading the menu ─────────────────────────────────────────────────────── */

const READ = () => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return null;
  const panel = dialog.querySelector(".drawer-panel");
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const n = (v) => Math.round(v * 10) / 10;
    return { l: n(r.left), r: n(r.right), t: n(r.top), b: n(r.bottom), w: n(r.width), h: n(r.height) };
  };
  const rgbVar = (name) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const [a, b, c] = v.split(/\s+/).map(Number);
    return `rgb(${a}, ${b}, ${c})`;
  };

  const avatar = [...panel.querySelectorAll("span")]
    .find((s) => String(s.className).includes("brand-gradient"));
  const upgrade = panel.querySelector('a[href="/plan"]');
  const topUp = panel.querySelector('a[href="/credits"]');
  // The account card is the DEEPEST element holding the avatar and both
  // buttons — `querySelectorAll` is document order, so ancestors come first.
  const card = [...panel.querySelectorAll("div")]
    .filter((d) => avatar && upgrade && topUp && d.contains(avatar) && d.contains(upgrade) && d.contains(topUp))
    .pop() ?? null;

  // The meter: a short, wide, clipped span with exactly one child.
  const track = card ? [...card.querySelectorAll("span")].find((s) => {
    const r = s.getBoundingClientRect();
    return s.children.length === 1 && getComputedStyle(s).overflow === "hidden" && r.height > 0 && r.height <= 12 && r.width > 40;
  }) : null;
  const fill = track?.firstElementChild ?? null;
  const fs = fill ? getComputedStyle(fill) : null;

  const texts = card ? [...card.querySelectorAll("span, p")].map((e) => e.textContent.trim()) : [];
  const usedLine = texts.find((x) => /^Wykorzystano/.test(x)) ?? null;
  const ratioLine = texts.find((x) => /^\s*[\d  ., ]+\s*\/\s*[\d  ., ]+\s*$/.test(x)) ?? null;
  const noLimit = texts.some((x) => /bez miesięcznego limitu/i.test(x));

  // Section headings only. The language trigger also carries `aria-expanded`,
  // and it is not a section — hence both filters.
  const sections = [...panel.querySelectorAll("nav button[aria-expanded]:not([aria-haspopup])")].map((b) => ({
    title: b.textContent.trim(),
    expanded: b.getAttribute("aria-expanded") === "true",
    top: Math.round(b.getBoundingClientRect().top),
    rows: b.parentElement ? [...b.parentElement.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [],
    lit: b.parentElement
      ? [...b.parentElement.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute("href"))
      : [],
  }));

  // The panel's last child is the footer SLOT; the bar itself is what the menu
  // puts in it, and its controls are that row's children.
  const bar = panel.lastElementChild;
  const barRow = bar?.firstElementChild ?? null;
  const barKids = barRow ? [...barRow.children].map((e) => ({ tag: e.tagName.toLowerCase(), ...box(e) })) : [];
  const signOut = bar?.querySelector('form[action="/auth/sign-out"] button') ?? null;
  const flagBtn = bar?.querySelector("button[aria-haspopup='menu']") ?? null;
  const themeBtns = bar ? [...bar.querySelectorAll("button[aria-pressed]")] : [];

  const labelSpans = [upgrade, topUp, signOut]
    .filter(Boolean)
    .map((el) => [...el.querySelectorAll("span")].find((s) => s.textContent.trim().length > 0))
    .filter(Boolean)
    .map((s) => ({ text: s.textContent.trim(), clipped: s.scrollWidth > s.clientWidth + 1 }));

  const nav = panel.querySelector("nav");

  return {
    pathname: location.pathname,
    panel: box(panel),
    card: box(card),
    cardRadius: card ? Math.round(parseFloat(getComputedStyle(card).borderRadius)) : 0,
    cardHoldsBadge: Boolean(card && [...card.querySelectorAll("span")].some((s) => /^(Free|Pro|Agency|Starter|Enterprise)$/i.test(s.textContent.trim()))),
    cardHoldsClose: Boolean(card?.querySelector("button[aria-label]")),
    avatar: box(avatar),
    meter: fill ? {
      bg: fs.backgroundColor,
      shadow: fs.boxShadow,
      widthPct: Math.round((fill.getBoundingClientRect().width / track.getBoundingClientRect().width) * 1000) / 10,
      trackW: Math.round(track.getBoundingClientRect().width),
    } : null,
    usedLine, ratioLine, noLimit,
    tone: {
      success: rgbVar("--success"), caution: rgbVar("--caution"),
      warning: rgbVar("--warning"), danger: rgbVar("--danger"), accent: rgbVar("--accent"),
    },
    sections,
    lit: [...panel.querySelectorAll('a[aria-current="page"]')].map((a) => ({
      href: a.getAttribute("href"), text: a.textContent.trim().slice(0, 40),
    })),
    hrefs: [...panel.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    linkText: [...panel.querySelectorAll("a")].map((a) => a.textContent.trim()),
    admin: Boolean(panel.querySelector('a[href="/admin"]')),
    bar: box(bar),
    barKids,
    signOut: box(signOut),
    flag: box(flagBtn),
    theme: themeBtns.map((b) => ({ ...box(b), pressed: b.getAttribute("aria-pressed") === "true" })),
    labelSpans,
    nav: box(nav),
    navScroll: nav ? { h: nav.clientHeight, sh: nav.scrollHeight } : null,
    panelOverflow: { sw: panel.scrollWidth, cw: panel.clientWidth },
    docOverflow: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
    headerPadTop: Math.round(parseFloat(getComputedStyle(panel.firstElementChild.firstElementChild).paddingTop)),
    barPadBottom: bar ? Math.round(parseFloat(getComputedStyle(bar).paddingBottom)) : 0,
    dark: document.documentElement.classList.contains("dark"),
  };
};

const open = async (page) => {
  await page.click("[data-probe-open]");
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(280);
};
const shut = async (page) => {
  await page.keyboard.press("Escape");
  await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5000 });
};
const readOpen = async (page) => { await open(page); const s = await page.evaluate(READ); await shut(page); return s; };
const goRoute = async (page, route) => {
  await page.evaluate((r) => window.history.pushState(null, "", r), route);
  await page.click("[data-probe-sync]");
  await page.waitForTimeout(120);
};
const pick = async (page, key) => {
  await page.click(`[data-probe-case="${key}"]`);
  await page.waitForTimeout(80);
};
/** Open every section, so what each one CONTAINS can be read. */
const SHUT_HEADINGS = '[role="dialog"] nav button[aria-expanded="false"]:not([aria-haspopup])';
const expandAll = async (page) => {
  for (let i = 0; i < 8; i++) {
    const shutHeadings = await page.$$(SHUT_HEADINGS);
    if (!shutHeadings.length) break;
    await shutHeadings[0].click();
    await page.waitForTimeout(110);
  }
};

/* ══ A–F, once, on a representative phone ═══════════════════════════════════ */

{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${PROBE}`, { waitUntil: "networkidle", timeout: 60000 });
  await goRoute(page, "/credits");

  console.log("\n══ A. ONE ACCOUNT CARD ══");
  const a = await readOpen(page);
  note(Boolean(a.card), "the avatar, the plan badge, the balance and both buttons share one card");
  note(a.cardRadius >= 12, `…and it is a card, not a bare strip (radius ${a.cardRadius}px)`);
  note(a.cardHoldsBadge, "the plan badge is inside it, under the name");
  note(a.cardHoldsClose, "the X lives in the card's own corner");
  note(Boolean(a.avatar) && a.avatar.l < a.card.l + 30, `the avatar is on the left (${a.avatar?.l} vs card ${a.card?.l})`);
  note(a.card.t >= a.panel.t, "the card is inside the panel");
  note(!a.linkText.some((x) => /@/.test(x)) && !/@/.test(a.usedLine ?? ""),
    "no loose e-mail line hanging beside the name");

  console.log("\n══ B. THE METER ══");
  const METER = [
    { key: "free", pct: 0, tone: "success", label: "a fresh Free account — 0 %, green" },
    { key: "pro-10", pct: 10, tone: "success", label: "Pro at 10 % — green" },
    { key: "pro-60", pct: 60, tone: "caution", label: "Pro at 60 % — yellow" },
    { key: "pro-80", pct: 80, tone: "warn", label: "Pro at 80 % — orange" },
    { key: "pro-95", pct: 95, tone: "critical", label: "Pro at 95 % — red" },
    { key: "free-empty", pct: 100, tone: "critical", label: "an empty wallet — 100 %, red" },
    { key: "admin", pct: 20, tone: "success", label: "Agency at 20 % — green" },
  ];
  const TONE_VAR = { success: "success", caution: "caution", warn: "warning", critical: "danger" };
  for (const m of METER) {
    await pick(page, m.key);
    const s = await readOpen(page);
    const want = s.tone[TONE_VAR[m.tone]];
    note(Boolean(s.meter), `${m.label}: the bar is drawn`);
    if (!s.meter) continue;
    note(s.meter.bg === want, `${m.label}: fill is ${s.meter.bg} (expected ${want})`);
    note(s.meter.shadow !== "none", `${m.label}: it carries its own glow`);
    // 0 % keeps a 3 % floor so the track never reads as "no data".
    const wantW = Math.max(3, m.pct);
    note(Math.abs(s.meter.widthPct - wantW) <= 1.5,
      `${m.label}: fill is ${s.meter.widthPct}% of the track (expected ${wantW}%)`);
    note((s.usedLine ?? "").includes(`${m.pct}%`),
      `${m.label}: the label says "${s.usedLine}"`);
    note(Boolean(s.ratioLine), `${m.label}: used/total is shown ("${s.ratioLine}")`);
  }
  {
    await pick(page, "nolimit");
    const s = await readOpen(page);
    note(!s.meter, "a plan with no monthly limit draws no bar at all");
    note(s.noLimit, `…and says so instead of inventing a percentage`);
    note(!s.usedLine, "…with no percentage anywhere");
  }
  await pick(page, "free");

  console.log("\n══ C. THE STRUCTURE ══");
  await open(page);
  const c = await page.evaluate(READ);
  const titles = c.sections.map((s) => s.title.toUpperCase());
  note(titles.length === 4, `four sections: ${titles.join(" · ")}`);
  note(titles.join("|").includes("GŁÓWNE") && titles.join("|").includes("OBRAZY")
    && titles.join("|").includes("NARZĘDZIA") && titles.join("|").includes("WIDEO"),
    "…named GŁÓWNE / OBRAZY / NARZĘDZIA / WIDEO");
  note(!titles.some((x) => /TWORZENIE/.test(x)), "no „Tworzenie” heading");
  note(!titles.some((x) => /EDYTUJ/.test(x)), "no „Edytuj” heading — it is „Narzędzia” now");
  note(!c.linkText.some((x) => /Gotowy generator/i.test(x)), "no „Gotowy generator” row");
  note(!c.hrefs.includes("/prompts"), "…and nothing routes to the old generator entry from here");
  note(c.sections.every((s) => !s.expanded),
    `on /credits — a route no section owns — everything is collapsed (${c.sections.filter((s) => s.expanded).length} open)`);
  // A removed section leaves a hole; collapsed headings sit one after another.
  const gaps = c.sections.slice(1).map((s, i) => s.top - c.sections[i].top);
  note(gaps.every((g) => g > 0 && g < 46), `no gap where a section used to be (${gaps.join(", ")}px between headings)`);

  /* …and now with every section open, so what they HOLD can be read. */
  await expandAll(page);
  const all = await page.evaluate(READ);
  await shut(page);
  note(all.sections.every((s) => s.expanded && s.rows.length > 0),
    `every section holds rows (${all.sections.map((s) => `${s.title}:${s.rows.length}`).join(" ")})`);
  note(all.hrefs.filter((h) => h === "/tools").length === 1, "„Wszystkie narzędzia” appears exactly once");
  const main = all.sections.find((s) => s.title.toUpperCase().startsWith("GŁÓWNE"));
  for (const want of ["/home", "/library", "/support", "/settings"]) {
    note(Boolean(main?.rows.includes(want)), `GŁÓWNE carries ${want}`);
  }
  note(!all.linkText.some((x) => /Gotowy generator/i.test(x)) && !all.hrefs.includes("/prompts"),
    "…and with everything open there is still no „Gotowy generator”");
  const tools = all.sections.find((s) => s.title.toUpperCase().startsWith("NARZĘDZIA"));
  note(tools?.rows.length === 5, `NARZĘDZIA keeps all five entries (${tools?.rows.join(" ")})`);

  console.log("\n══ D. THE ROUTE DECIDES ══");
  for (const t of CASES) {
    await goRoute(page, t.route);
    const first = await readOpen(page);
    const second = await readOpen(page);
    note(first.lit.length === 1 && second.lit.length === 1,
      `${t.route}: exactly one row lit — 1st open ${first.lit.length}, 2nd ${second.lit.length}` +
      (first.lit.length ? ` (${first.lit.map((r) => r.href).join(" + ")})` : ""));
    const sec = second.sections.find((s) => s.title.toUpperCase().startsWith(t.section));
    note(Boolean(sec?.expanded), `${t.route}: ${t.section} opens itself on the SECOND open`);
    note(Boolean(sec && sec.lit.length === 1), `${t.route}: …and the highlight is inside it (${sec?.lit.join(",") || "none"})`);
    note(second.sections.filter((s) => s.expanded).length === 1,
      `${t.route}: no other section opens (${second.sections.filter((s) => s.expanded).map((s) => s.title).join(", ")})`);
    if (t.label) {
      const hit = first.lit[0]?.text ?? "";
      note(hit.includes(t.label), `${t.route}: the lit row is "${t.label}" — got "${hit}"`);
    }
    note(second.sections.every((s) => !s.expanded || s.rows.length > 0),
      `${t.route}: no section opens empty`);
  }

  /* A manual collapse is respected, and expires when the route changes. */
  await goRoute(page, "/tools/resize");
  await open(page);
  const heading = await page.evaluateHandle(() =>
    [...document.querySelectorAll('[role="dialog"] button[aria-expanded]')]
      .find((b) => b.getAttribute("aria-expanded") === "true"));
  await heading.asElement()?.click();
  await page.waitForTimeout(200);
  const collapsed = await page.evaluate(() =>
    ![...document.querySelectorAll('[role="dialog"] button[aria-expanded]')]
      .some((b) => b.getAttribute("aria-expanded") === "true"));
  note(collapsed, "a manual collapse of the active section is respected");
  await shut(page);
  await goRoute(page, "/tools/compress");
  const afterNav = await readOpen(page);
  note(afterNav.lit.length === 1 && afterNav.lit[0].href === "/tools/compress",
    `…and the next route takes over again (${afterNav.lit.map((r) => r.href).join(",") || "nothing lit"})`);

  console.log("\n══ E. THE BOTTOM BAR ══");
  const e = await readOpen(page);
  note(e.barKids.length === 3, `three controls on one line (${e.barKids.map((k) => k.tag).join(", ")})`);
  const mids = e.barKids.map((k) => k.t + k.h / 2);
  note(Math.max(...mids) - Math.min(...mids) < 1, `…sharing a centre line (spread ${(Math.max(...mids) - Math.min(...mids)).toFixed(1)}px)`);
  const hs = [...new Set(e.barKids.map((k) => Math.round(k.h)))];
  note(hs.length === 1 && hs[0] === 44, `…and one height (${hs.join("/")}px)`);
  note(Boolean(e.signOut) && e.signOut.h >= 44, `sign-out clears the 44px touch minimum (${e.signOut?.h}px)`);
  note(Boolean(e.flag) && e.flag.w >= 44 && e.flag.h >= 44, `…so does the flag (${e.flag?.w}×${e.flag?.h})`);
  note(e.theme.every((t) => t.h >= 40), `…and each half of the theme pill (${e.theme.map((t) => t.h).join("/")}px)`);
  note(e.theme.length === 2 && e.theme.filter((t) => t.pressed).length === 1,
    `the theme pill shows two options with one active (${e.theme.filter((t) => t.pressed).length})`);
  note(e.bar.b <= e.panel.b + 0.5, `the bar sits inside the panel (${e.bar.b} <= ${e.panel.b})`);
  note(e.barPadBottom >= 12, `it keeps a floor under itself for the home indicator (${e.barPadBottom}px with zero insets)`);
  note(e.headerPadTop >= 12, `…and the card clears the status bar (${e.headerPadTop}px with zero insets)`);

  /* The flag picker: flags only, opening upwards. */
  await open(page);
  await page.click('[role="dialog"] button[aria-haspopup="menu"]');
  await page.waitForTimeout(220);
  const picker = await page.evaluate(() => {
    const menu = document.querySelector('[role="dialog"] [role="menu"]');
    if (!menu) return null;
    const trigger = document.querySelector('[role="dialog"] button[aria-haspopup="menu"]');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    return {
      count: items.length,
      allFlags: items.every((i) => i.querySelector("svg")),
      anyText: items.some((i) => i.textContent.trim().length > 0),
      named: items.every((i) => (i.getAttribute("aria-label") ?? "").length > 1),
      above: menu.getBoundingClientRect().bottom <= trigger.getBoundingClientRect().top + 1,
      inside: menu.getBoundingClientRect().left >= document.querySelector(".drawer-panel").getBoundingClientRect().left - 1,
      row: menu.getBoundingClientRect().width < 200,
    };
  });
  note(picker?.count === 3, `the picker offers three languages (${picker?.count})`);
  note(picker?.allFlags && !picker?.anyText, "flags only — no „Polski / English / Deutsch” list");
  note(picker?.named, "…each still named for a screen reader");
  note(picker?.above, "it opens upwards, out of the bar");
  note(picker?.inside && picker?.row, "…as a small row inside the panel");
  await shut(page);

  /* The theme toggle drives the existing theme, nothing new. */
  await pick(page, "pro-60");
  await open(page);
  const before = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await page.click('[role="dialog"] button[aria-pressed="false"]');
  await page.waitForTimeout(260);
  const after = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  note(before !== after, `the theme pill switches the real theme (dark ${before} → ${after})`);
  // THE METER FOLLOWS THE THEME. Its colours are tokens, not literals, so the
  // yellow on a light panel is the light yellow — checked here rather than
  // assumed, because a hard-coded hex would pass every other assertion above.
  // The wait is the bar's own 500ms colour transition: read sooner and what
  // comes back is an interpolated value that belongs to neither theme.
  await page.waitForTimeout(700);
  const light = await page.evaluate(READ);
  note(light.meter.bg === light.tone.caution,
    `…and the bar re-reads its colour for the new theme (${light.meter.bg} = --caution)`);
  await page.click('[role="dialog"] button[aria-pressed="false"]');
  await page.waitForTimeout(260);
  const back = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  note(back === before, `…and back again (dark ${back})`);
  await shut(page);

  console.log("\n══ F. THE ADMIN ROW ══");
  // On /home, GŁÓWNE opens itself — which is where the admin row lives.
  await goRoute(page, "/home");
  await pick(page, "admin");
  const admin = await readOpen(page);
  note(admin.admin, "an admin sees „Panel admina”");
  const inMain = admin.sections.find((s) => s.title.toUpperCase().startsWith("GŁÓWNE"));
  note(Boolean(inMain?.rows.includes("/admin")), "…inside GŁÓWNE, with the other places");
  await pick(page, "free");
  const cust = await readOpen(page);
  note(!cust.admin, "a customer does not — the row is not rendered at all");

  await ctx.close();
}

/* ══ G. GEOMETRY AT EVERY PHONE WIDTH ══════════════════════════════════════ */

for (const w of WIDTHS) {
  console.log(`\n══ G. ${w}px ══`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: 740 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${PROBE}`, { waitUntil: "networkidle", timeout: 60000 });
  await pick(page, "pro-60");
  await goRoute(page, "/tools/resize");
  await open(page);
  const s = await page.evaluate(READ);

  note(s.panelOverflow.sw <= s.panelOverflow.cw + 1,
    `${w}: nothing overflows the panel sideways (${s.panelOverflow.sw} <= ${s.panelOverflow.cw})`);
  note(s.docOverflow.sw <= s.docOverflow.cw + 1,
    `${w}: …and the page gains no horizontal scroll (${s.docOverflow.sw} <= ${s.docOverflow.cw})`);
  note(s.panel.l >= -0.5 && s.panel.r <= w + 0.5, `${w}: the panel is on screen (${s.panel.l} → ${s.panel.r})`);
  note(s.card.r <= s.panel.r - 8, `${w}: the card keeps its gutter (${s.card.r} <= ${s.panel.r - 8})`);
  note(s.meter.trackW > 60, `${w}: the meter is wide enough to read (${s.meter.trackW}px)`);
  const clipped = s.labelSpans.filter((l) => l.clipped);
  note(clipped.length === 0,
    `${w}: no button label is cut off (${clipped.map((l) => l.text).join(", ") || "none"})`);
  note(s.bar.b <= s.panel.b + 0.5 && s.bar.t >= s.nav.b - 0.5,
    `${w}: the bottom bar is below the list and inside the panel`);
  note(s.lit.length === 1, `${w}: one row lit (${s.lit.map((r) => r.href).join(",")})`);

  /* The LIST scrolls; the card and the bar do not move with it. */
  const scrolled = await page.evaluate(() => {
    const panel = document.querySelector(".drawer-panel");
    const nav = panel.querySelector("nav");
    const cardTop = panel.firstElementChild.getBoundingClientRect().top;
    const barTop = panel.lastElementChild.getBoundingClientRect().top;
    const before = nav.scrollTop;
    nav.scrollTop = nav.scrollHeight;
    const after = nav.scrollTop;
    return {
      moved: after - before,
      room: nav.scrollHeight - nav.clientHeight,
      cardMoved: Math.abs(panel.firstElementChild.getBoundingClientRect().top - cardTop),
      barMoved: Math.abs(panel.lastElementChild.getBoundingClientRect().top - barTop),
    };
  });
  if (scrolled.room > 1) {
    note(scrolled.moved > 0, `${w}: the list scrolls on its own (${scrolled.moved}px of ${scrolled.room}px)`);
  } else {
    note(true, `${w}: the whole menu fits without scrolling (${scrolled.room}px of overflow)`);
  }
  note(scrolled.cardMoved < 1 && scrolled.barMoved < 1,
    `${w}: the card and the bar stay put while it does (${scrolled.cardMoved} / ${scrolled.barMoved})`);

  await shut(page);
  await ctx.close();
}

await browser.close();
console.log(failed === 0 ? "\nAll drawer probes passed." : `\n${failed} drawer probe(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
