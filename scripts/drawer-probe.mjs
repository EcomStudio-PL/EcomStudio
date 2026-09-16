/**
 * THE MOBILE MENU, DRIVEN THROUGH REAL ROUTES IN A REAL BROWSER.
 *
 * `npm run test:nav` proves the active-route RULE over every route in the
 * product and `npm run test:credits` proves the meter's arithmetic. Neither can
 * prove either one is WIRED to the component — that the section really renders
 * expanded, that one tile really carries the highlight, that the bar really
 * turns red when 5 % is left, that the buttons really point at pages that
 * exist.
 *
 * This does. It mounts the real `CustomerDrawer` with real account shapes and
 * moves between routes with `history.pushState`, which Next 15 feeds into
 * `usePathname()`, so the component computes from the same pathname a
 * navigation would give it. Then it reads the DOM and the COMPUTED styles.
 *
 * What it measures, in order:
 *   A. THE TWO CARDS. The account card carries the avatar, the name, the plan
 *      badge and a chevron — and NOT the close control, which belongs outside
 *      it. The wallet card carries the balance, the meter and both buttons.
 *   B. THE METER. It draws WHAT IS LEFT and says "Pozostało", never
 *      "Wykorzystano"; its colour still follows depletion, read back as
 *      computed pixels at 100 / 90 / 40 / 20 / 5 / 0 % remaining, plus the
 *      no-limit case which must stay neutral and show no percentage.
 *   C. THE TILES. Every destination is its own bordered tile with an icon
 *      plate, a label and a chevron, all the same height; the five main ones
 *      are always visible, with no heading over them.
 *   D. THE ROUTE. The section holding the current page opens itself and
 *      exactly one tile lights up — on the second open too, because that is
 *      where the original defect lived.
 *   E. THE BOTTOM. Sign-out is a full-width tile, and under it one line with
 *      the language on the left and the theme on the right.
 *   F. ADMIN. The tile exists for an admin and does not for a customer.
 *   G. GEOMETRY, at eight phone widths: nothing overflows, nothing is
 *      truncated, the list scrolls, the bottom does not.
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

/** route → the section that must open itself (null = a main tile), and the
 *  tile that must light up. */
const CASES = [
  { route: "/retusz", section: "NARZĘDZIA", label: "Retusz" },
  { route: "/tools/editor", section: "NARZĘDZIA", label: "Edycja" },
  { route: "/tools/resize", section: "NARZĘDZIA", label: "Zmiana rozmiaru" },
  { route: "/tools/compress", section: "NARZĘDZIA", label: "Kompresja" },
  { route: "/tools", section: "NARZĘDZIA", label: "Wszystkie narz" },
  { route: "/k/moda", section: "OBRAZY", label: "Moda" },
  { route: "/k/ecommerce", section: "OBRAZY", label: "E-commerce" },
  { route: "/wideo", section: "WIDEO", label: "Wideo" },
  { route: "/home", section: null, label: "Strona główna" },
  { route: "/library", section: null, label: "Biblioteka" },
  { route: "/settings", section: null, label: "Ustawienia" },
  { route: "/support", section: null, label: "Pomoc" },
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

  const nav = panel.querySelector("nav");
  const account = nav.querySelector('a[href="/settings"]');
  const avatar = [...nav.querySelectorAll("span")]
    .find((s) => String(s.className).includes("brand-gradient") && s.textContent.trim().length === 1);
  const upgrade = nav.querySelector('a[href="/plan"]');
  const topUp = nav.querySelector('a[href="/credits"]');
  // The wallet card is the OUTERMOST element inside the list that holds both
  // buttons — `querySelectorAll` is document order, so ancestors come first
  // and the first hit is the card rather than the row the buttons sit in.
  const wallet = [...nav.querySelectorAll("div")]
    .find((d) => upgrade && topUp && d.contains(upgrade) && d.contains(topUp)) ?? null;

  // The meter: a short, wide, clipped span with exactly one child.
  const track = wallet ? [...wallet.querySelectorAll("span")].find((s) => {
    const r = s.getBoundingClientRect();
    return s.children.length === 1 && getComputedStyle(s).overflow === "hidden" && r.height > 0 && r.height <= 14 && r.width > 40;
  }) : null;
  const fill = track?.firstElementChild ?? null;
  const fs = fill ? getComputedStyle(fill) : null;

  const walletText = wallet ? wallet.textContent : "";
  const texts = wallet ? [...wallet.querySelectorAll("span, p")].map((e) => e.textContent.trim()) : [];
  const leftLine = texts.find((x) => /^Pozostało/.test(x)) ?? null;
  const pctLine = texts.find((x) => /^\d{1,3}%$/.test(x)) ?? null;
  const noLimit = texts.some((x) => /bez miesięcznego limitu/i.test(x));

  // Section headings only. The language trigger also carries `aria-expanded`,
  // and it is not a section — hence both filters.
  const sections = [...nav.querySelectorAll("button[aria-expanded]:not([aria-haspopup])")].map((b) => ({
    title: b.textContent.trim(),
    expanded: b.getAttribute("aria-expanded") === "true",
    top: Math.round(b.getBoundingClientRect().top),
    rows: b.parentElement ? [...b.parentElement.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [],
    lit: b.parentElement
      ? [...b.parentElement.querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute("href"))
      : [],
  }));

  /** Every navigation tile: the links that are not the account card or a CTA. */
  const CTA = new Set(["/plan", "/credits"]);
  const tiles = [...nav.querySelectorAll("a")]
    .filter((a) => a !== account && !CTA.has(a.getAttribute("href")))
    .map((a) => {
      const cs = getComputedStyle(a);
      const plate = a.querySelector("span[aria-hidden]:not([class*='left-0'])");
      return {
        href: a.getAttribute("href"),
        text: a.textContent.trim(),
        current: a.getAttribute("aria-current") === "page",
        radius: Math.round(parseFloat(cs.borderTopLeftRadius)),
        border: cs.borderTopWidth,
        plate: box(plate),
        chevron: Boolean(a.querySelector("svg.lucide-chevron-right")),
        ...box(a),
      };
    });

  // The panel's last child is the footer SLOT; what the menu puts in it is the
  // sign-out tile and then the preferences row.
  const foot = panel.lastElementChild;
  const footInner = foot?.firstElementChild ?? null;
  const signOut = foot?.querySelector('form[action="/auth/sign-out"] button') ?? null;
  const prefs = footInner ? [...footInner.children].find((e) => !e.matches("form")) : null;
  const prefKids = prefs ? [...prefs.children].map((e) => ({ tag: e.tagName.toLowerCase(), ...box(e) })) : [];
  const flagBtn = prefs?.querySelector("button[aria-haspopup='menu']") ?? null;
  const themeBtns = prefs ? [...prefs.querySelectorAll("button[aria-pressed]")] : [];

  const labelSpans = [upgrade, topUp, signOut]
    .filter(Boolean)
    .map((el) => [...el.querySelectorAll("span")].find((s) => s.textContent.trim().length > 0))
    .filter(Boolean)
    .map((s) => ({ text: s.textContent.trim(), clipped: s.scrollWidth > s.clientWidth + 1 }));

  return {
    pathname: location.pathname,
    panel: box(panel),
    header: box(panel.firstElementChild),
    headerText: panel.firstElementChild.textContent.trim(),
    headerButtons: panel.firstElementChild.querySelectorAll("button").length,
    account: box(account),
    accountRadius: account ? Math.round(parseFloat(getComputedStyle(account).borderTopLeftRadius)) : 0,
    accountHasBadge: Boolean(account && [...account.querySelectorAll("span")]
      .some((s) => /^(Free|Pro|Agency|Starter|Enterprise)$/i.test(s.textContent.trim()))),
    accountHasChevron: Boolean(account?.querySelector("svg.lucide-chevron-right")),
    accountHasClose: Boolean(account?.querySelector("button")),
    avatar: box(avatar),
    avatarRadius: avatar ? getComputedStyle(avatar).borderTopLeftRadius : null,
    avatarGlow: Boolean(avatar?.parentElement
      && [...avatar.parentElement.children].some((c) => getComputedStyle(c).filter.includes("blur"))),
    wallet: box(wallet),
    walletText,
    meter: fill ? {
      bg: fs.backgroundColor,
      shadow: fs.boxShadow,
      widthPct: Math.round((fill.getBoundingClientRect().width / track.getBoundingClientRect().width) * 1000) / 10,
      trackW: Math.round(track.getBoundingClientRect().width),
    } : null,
    leftLine, pctLine, noLimit,
    tone: {
      success: rgbVar("--success"), caution: rgbVar("--caution"),
      warning: rgbVar("--warning"), danger: rgbVar("--danger"), accent: rgbVar("--accent"),
    },
    sections,
    tiles,
    lit: tiles.filter((x) => x.current),
    admin: tiles.some((x) => x.href === "/admin"),
    foot: box(foot),
    signOut: { ...box(signOut), chevron: Boolean(signOut?.querySelector("svg.lucide-chevron-right")) },
    prefKids,
    flag: box(flagBtn),
    flagText: flagBtn?.textContent.trim() ?? "",
    theme: themeBtns.map((b) => ({ ...box(b), pressed: b.getAttribute("aria-pressed") === "true" })),
    labelSpans,
    nav: box(nav),
    navScroll: nav ? { h: nav.clientHeight, sh: nav.scrollHeight } : null,
    panelOverflow: { sw: panel.scrollWidth, cw: panel.clientWidth },
    docOverflow: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
    footPadBottom: foot ? Math.round(parseFloat(getComputedStyle(foot).paddingBottom)) : 0,
    headerPadTop: Math.round(parseFloat(getComputedStyle(panel.firstElementChild.firstElementChild).paddingTop)),
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

  console.log("\n══ A. THE TWO CARDS ══");
  const a = await readOpen(page);
  note(Boolean(a.account), "the account is a card of its own");
  note(a.accountRadius >= 14, `…with a card's corner (${a.accountRadius}px)`);
  note(a.accountHasBadge, "the plan badge sits inside it, under the name");
  note(a.accountHasChevron, "…and it carries a chevron, like the reference");
  note(!a.accountHasClose, "the X is NOT inside the account card any more");
  note(a.headerButtons === 1 && a.headerText === "", "…it lives above it, on its own line");
  note(Boolean(a.avatar) && a.avatar.w >= 44, `the avatar is large (${a.avatar?.w}×${a.avatar?.h})`);
  note(a.avatarRadius === "9999px" || parseFloat(a.avatarRadius) >= 20, `…and round (${a.avatarRadius})`);
  note(a.avatarGlow, "…with a glow behind it");
  note(Boolean(a.wallet) && a.wallet.t > a.account.b, "the wallet is a SECOND card, under the account");
  note(!a.walletText.includes("@"), "no loose e-mail line anywhere in the cards");

  console.log("\n══ B. THE METER ══");
  const METER = [
    { key: "free", left: 100, tone: "success", label: "a fresh Free account — 100 % left, green" },
    { key: "pro-10", left: 90, tone: "success", label: "Pro with 90 % left — green" },
    { key: "pro-60", left: 40, tone: "caution", label: "Pro with 40 % left — yellow" },
    { key: "pro-80", left: 20, tone: "warn", label: "Pro with 20 % left — orange" },
    { key: "pro-95", left: 5, tone: "critical", label: "Pro with 5 % left — red" },
    { key: "free-empty", left: 0, tone: "critical", label: "an empty wallet — 0 % left, red" },
    { key: "admin", left: 80, tone: "success", label: "Agency with 80 % left — green" },
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
    const wantW = Math.max(3, m.left);
    note(Math.abs(s.meter.widthPct - wantW) <= 1.5,
      `${m.label}: fill is ${s.meter.widthPct}% of the track (expected ${wantW}%)`);
    note(s.pctLine === `${m.left}%`, `${m.label}: the figure shown is ${s.pctLine}`);
    note(Boolean(s.leftLine), `${m.label}: and it is labelled "${s.leftLine}"`);
    note(!/Wykorzystano/.test(s.walletText), `${m.label}: the word „Wykorzystano” does not appear`);
  }
  {
    await pick(page, "nolimit");
    const s = await readOpen(page);
    note(!s.meter, "a plan with no monthly limit draws no bar at all");
    note(s.noLimit, "…and says so instead of inventing a percentage");
    note(!s.leftLine && !s.pctLine, "…with no percentage anywhere");
  }
  await pick(page, "free");

  console.log("\n══ C. THE TILES ══");
  await open(page);
  const c0 = await page.evaluate(READ);
  const titles = c0.sections.map((s) => s.title.toUpperCase());
  note(titles.length === 3, `three foldable sections: ${titles.join(" · ")}`);
  note(titles.join("|").includes("OBRAZY") && titles.join("|").includes("NARZĘDZIA") && titles.join("|").includes("WIDEO"),
    "…named OBRAZY / NARZĘDZIA / WIDEO");
  note(!titles.some((x) => /TWORZENIE|EDYTUJ|GŁÓWNE/.test(x)), "no „Tworzenie”, no „Edytuj”, no heading over the main tiles");
  note(c0.sections.every((s) => !s.expanded),
    `on /credits — a route no section owns — all three are collapsed (${c0.sections.filter((s) => s.expanded).length} open)`);
  // The five main destinations are visible without opening anything.
  for (const want of ["/home", "/library", "/settings", "/support"]) {
    note(c0.tiles.some((x) => x.href === want), `${want} is a tile, always visible`);
  }
  note(c0.tiles.every((x) => x.radius >= 14), `every tile is rounded (${[...new Set(c0.tiles.map((x) => x.radius))].join("/")}px)`);
  note(c0.tiles.every((x) => parseFloat(x.border) > 0), "…bordered");
  note(c0.tiles.every((x) => x.plate && x.plate.w >= 32 && x.plate.h >= 32),
    `…and each carries an icon plate (${[...new Set(c0.tiles.map((x) => `${x.plate?.w}×${x.plate?.h}`))].join(" ")})`);
  note(c0.tiles.every((x) => x.chevron), "…and a chevron on the right");
  const heights = [...new Set(c0.tiles.map((x) => Math.round(x.h)))];
  note(heights.length === 1, `all tiles are one height (${heights.join("/")}px)`);
  note(heights[0] >= 52, `…and that height is a comfortable target (${heights[0]}px)`);
  const gaps = c0.tiles.slice(1, 5).map((x, i) => Math.round(x.t - c0.tiles[i].b));
  note(gaps.every((g) => g === gaps[0]), `even spacing between them (${gaps.join(", ")}px)`);

  await expandAll(page);
  const all = await page.evaluate(READ);
  await shut(page);
  note(all.sections.every((s) => s.expanded && s.rows.length > 0),
    `every section holds tiles (${all.sections.map((s) => `${s.title}:${s.rows.length}`).join(" ")})`);
  note(all.tiles.filter((x) => x.href === "/tools").length === 1, "„Wszystkie narzędzia” appears exactly once");
  note(!all.tiles.some((x) => /Gotowy generator/i.test(x.text)) && !all.tiles.some((x) => x.href === "/prompts"),
    "…and with everything open there is still no „Gotowy generator”");
  const tools = all.sections.find((s) => s.title.toUpperCase().startsWith("NARZĘDZIA"));
  note(tools?.rows.length === 5, `NARZĘDZIA keeps all five entries (${tools?.rows.join(" ")})`);
  const allHeights = [...new Set(all.tiles.map((x) => Math.round(x.h)))];
  note(allHeights.length === 1, `tiles inside the sections are the same height too (${allHeights.join("/")}px)`);

  console.log("\n══ D. THE ROUTE DECIDES ══");
  for (const t of CASES) {
    await goRoute(page, t.route);
    const first = await readOpen(page);
    const second = await readOpen(page);
    note(first.lit.length === 1 && second.lit.length === 1,
      `${t.route}: exactly one tile lit — 1st open ${first.lit.length}, 2nd ${second.lit.length}` +
      (first.lit.length ? ` (${first.lit.map((r) => r.href).join(" + ")})` : ""));
    if (t.section) {
      const sec = second.sections.find((s) => s.title.toUpperCase().startsWith(t.section));
      note(Boolean(sec?.expanded), `${t.route}: ${t.section} opens itself on the SECOND open`);
      note(Boolean(sec && sec.lit.length === 1), `${t.route}: …and the highlight is inside it (${sec?.lit.join(",") || "none"})`);
      note(second.sections.filter((s) => s.expanded).length === 1,
        `${t.route}: no other section opens (${second.sections.filter((s) => s.expanded).map((s) => s.title).join(", ")})`);
    } else {
      note(second.sections.every((s) => !s.expanded),
        `${t.route}: it is a main tile, so nothing folds open (${second.sections.filter((s) => s.expanded).map((s) => s.title).join(", ") || "none"})`);
    }
    const hit = first.lit[0]?.text ?? "";
    note(hit.includes(t.label), `${t.route}: the lit tile is "${t.label}" — got "${hit}"`);
  }

  /* A manual collapse is respected, and expires when the route changes. */
  await goRoute(page, "/tools/resize");
  await open(page);
  const heading = await page.evaluateHandle(() =>
    [...document.querySelectorAll('[role="dialog"] nav button[aria-expanded]:not([aria-haspopup])')]
      .find((b) => b.getAttribute("aria-expanded") === "true"));
  await heading.asElement()?.click();
  await page.waitForTimeout(200);
  const collapsed = await page.evaluate(() =>
    ![...document.querySelectorAll('[role="dialog"] nav button[aria-expanded]:not([aria-haspopup])')]
      .some((b) => b.getAttribute("aria-expanded") === "true"));
  note(collapsed, "a manual collapse of the active section is respected");
  await shut(page);
  await goRoute(page, "/tools/compress");
  const afterNav = await readOpen(page);
  note(afterNav.lit.length === 1 && afterNav.lit[0].href === "/tools/compress",
    `…and the next route takes over again (${afterNav.lit.map((r) => r.href).join(",") || "nothing lit"})`);

  console.log("\n══ E. THE BOTTOM ══");
  const e = await readOpen(page);
  note(e.signOut.w > 200, `sign-out is a full-width tile (${e.signOut.w}px wide)`);
  note(e.signOut.h >= 52, `…the same height as a menu tile (${e.signOut.h}px)`);
  note(e.signOut.chevron, "…with an icon, a label and a chevron");
  note(e.prefKids.length === 2, `one line under it, two controls (${e.prefKids.map((k) => k.tag).join(", ")})`);
  const mids = e.prefKids.map((k) => k.t + k.h / 2);
  note(Math.max(...mids) - Math.min(...mids) < 1, `…sharing a centre line (spread ${(Math.max(...mids) - Math.min(...mids)).toFixed(1)}px)`);
  const hs = [...new Set(e.prefKids.map((k) => Math.round(k.h)))];
  note(hs.length === 1 && hs[0] === 44, `…and one height (${hs.join("/")}px)`);
  note(e.flag.l < e.theme[0].l, "language on the left, theme on the right");
  note(e.flag.w <= 110, `the language control stays compact (${e.flag.w}px — "${e.flagText}")`);
  note(!/Polski|English|Deutsch/.test(e.flagText), `…a code, not a word (“${e.flagText}”)`);
  note(e.theme.length === 2 && e.theme.filter((t) => t.pressed).length === 1,
    `the theme pill shows two options with one active (${e.theme.filter((t) => t.pressed).length})`);
  note(e.foot.b <= e.panel.b + 0.5, `the bottom sits inside the panel (${e.foot.b} <= ${e.panel.b})`);
  note(e.footPadBottom >= 12, `it keeps a floor under itself for the home indicator (${e.footPadBottom}px with zero insets)`);
  note(e.headerPadTop >= 8, `…and the top clears the status bar (${e.headerPadTop}px with zero insets)`);

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
  note(picker?.above, "it opens upwards, out of the row");
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
  note(light.meter?.bg === light.tone.caution,
    `…and the bar re-reads its colour for the new theme (${light.meter.bg} = --caution)`);
  await page.click('[role="dialog"] button[aria-pressed="false"]');
  await page.waitForTimeout(260);
  const back = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  note(back === before, `…and back again (dark ${back})`);
  await shut(page);

  console.log("\n══ F. THE ADMIN TILE ══");
  await pick(page, "admin");
  const admin = await readOpen(page);
  note(admin.admin, "an admin sees „Panel admina”");
  note(admin.tiles.find((x) => x.href === "/admin")?.h === admin.tiles[0].h,
    "…as a tile like the others, not a special row");
  await pick(page, "free");
  const cust = await readOpen(page);
  note(!cust.admin, "a customer does not — the tile is not rendered at all");

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
  note(s.account.r <= s.panel.r - 8 && s.wallet.r <= s.panel.r - 8,
    `${w}: both cards keep their gutter (${s.account.r} / ${s.wallet.r} <= ${s.panel.r - 8})`);
  note(s.meter.trackW > 60, `${w}: the meter is wide enough to read (${s.meter.trackW}px)`);
  const clipped = s.labelSpans.filter((l) => l.clipped);
  note(clipped.length === 0,
    `${w}: no button label is cut off (${clipped.map((l) => l.text).join(", ") || "none"})`);
  note(s.tiles.every((t) => t.r <= s.panel.r - 8), `${w}: no tile runs past the panel`);
  note(s.foot.b <= s.panel.b + 0.5 && s.foot.t >= s.nav.b - 0.5,
    `${w}: the bottom is below the list and inside the panel`);
  note(s.lit.length === 1, `${w}: one tile lit (${s.lit.map((r) => r.href).join(",")})`);

  /* The LIST scrolls; the bottom does not move with it. */
  const scrolled = await page.evaluate(() => {
    const panel = document.querySelector(".drawer-panel");
    const nav = panel.querySelector("nav");
    const footTop = panel.lastElementChild.getBoundingClientRect().top;
    const before = nav.scrollTop;
    nav.scrollTop = nav.scrollHeight;
    const after = nav.scrollTop;
    return {
      moved: after - before,
      room: nav.scrollHeight - nav.clientHeight,
      footMoved: Math.abs(panel.lastElementChild.getBoundingClientRect().top - footTop),
    };
  });
  if (scrolled.room > 1) {
    note(scrolled.moved > 0, `${w}: the list scrolls on its own (${scrolled.moved}px of ${scrolled.room}px)`);
  } else {
    note(true, `${w}: the whole menu fits without scrolling (${scrolled.room}px of overflow)`);
  }
  note(scrolled.footMoved < 1, `${w}: the bottom stays put while it does (${scrolled.footMoved})`);

  await shut(page);
  await ctx.close();
}

await browser.close();
console.log(failed === 0 ? "\nAll drawer probes passed." : `\n${failed} drawer probe(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
