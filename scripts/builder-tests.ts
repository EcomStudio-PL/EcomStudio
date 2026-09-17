/**
 * PAGE BUILDER 2.0 — the parts that can be wrong silently.
 *
 * Four things here, chosen because each of them fails in a way nobody sees
 * until a landing page is already live:
 *
 *   A. TEMPLATES. A starter layout that names a section type which does not
 *      exist creates a page with a hole in it — and the hole appears at
 *      "Publikuj", not at "Utwórz".
 *   B. QUICK EDIT. The split decides what an admin sees first. A field that
 *      falls into neither half is a field nobody can edit any more.
 *   C. REDIRECTS. Normalisation is what makes `/Promocja/` and `/promocja`
 *      the same row; the protected list is what stops somebody redirecting
 *      `/admin` and locking themselves out of the panel.
 *   D. SECTION CONDITIONS. A window and an audience decide what the PUBLIC
 *      renderer emits, so an off-by-one here is a promo banner that either
 *      never appears or never leaves.
 *
 * Run: npm run test:builder
 */
import { BLOCK_TYPES, SECTION_GROUPS, sectionIsLive, promoIsOpen, PINNED_SECTIONS } from "../lib/cms";
import { PAGE_TEMPLATES, templateBlocks, templateByKey } from "../lib/cms-templates";
import { fieldsFor, splitFields } from "../lib/cms-schema";
import { normalizePath, normalizeTarget, sourceIsProtected } from "../lib/server/redirects";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
}

const TYPES = new Set<string>(BLOCK_TYPES);

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("A. EVERY TEMPLATE BUILDS A REAL PAGE");

check("there are eight starting layouts", PAGE_TEMPLATES.length === 8,
  String(PAGE_TEMPLATES.length));

for (const tpl of PAGE_TEMPLATES) {
  const unknown = tpl.sections.map((s) => s.type).filter((type) => !TYPES.has(type));
  check(`${tpl.key}: every section is a real type`, unknown.length === 0, unknown.join(", "));

  const blocks = templateBlocks(tpl.key);
  check(`${tpl.key}: order is 0…n with no gaps`,
    blocks.every((b, i) => b.sort_order === i), blocks.map((b) => b.sort_order).join(","));

  // An anchor becomes a URL fragment and a CSS target; two sections claiming
  // the same one is a link that goes to whichever renders first.
  const anchors = blocks.map((b) => b.anchor).filter((a): a is string => !!a);
  check(`${tpl.key}: anchors are unique`, new Set(anchors).size === anchors.length,
    anchors.join(","));
  check(`${tpl.key}: anchors are usable in a URL`,
    anchors.every((a) => /^[a-z][a-z0-9-]{0,63}$/.test(a)), anchors.join(","));
}

// THE POINT OF THE WHOLE FEATURE: the promo layout is the campaign page.
const promo = templateBlocks("promo");
check("the promotion layout leads with a promo bar", promo[0]?.type === "promo_bar", promo[0]?.type);
check("…and carries an offer, a countdown and a closing CTA",
  ["offer", "countdown", "urgency_cta"].every((type) => promo.some((b) => b.type === type)),
  promo.map((b) => b.type).join(" → "));
check("…with the sticky CTA created but switched off",
  promo.some((b) => b.type === "sticky_cta" && !b.visible));

// A TEMPLATE WRITES NO WORDS. This is the rule that keeps invented marketing
// copy one accidental Publish away from production.
const everyBlock = PAGE_TEMPLATES.flatMap((t) => templateBlocks(t.key));
check("no template ships any content at all",
  everyBlock.every((b) => Object.keys(b.content).length === 0),
  String(everyBlock.filter((b) => Object.keys(b.content).length > 0).length));

check("an unknown template key builds nothing rather than throwing",
  templateBlocks("nonsense").length === 0 && templateByKey("nonsense") === null);

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nB. QUICK EDIT SHOWS THE RIGHT HALF");

for (const type of SECTION_GROUPS.flatMap((g) => g.types)) {
  const fields = fieldsFor(type);
  const { quick, advanced } = splitFields(type, fields);
  check(`${type}: no field is lost between the halves`,
    quick.length + advanced.length === fields.length,
    `${quick.length}+${advanced.length} vs ${fields.length}`);
  check(`${type}: nothing is in both halves`,
    quick.every((f) => !advanced.includes(f)));
  if (fields.length > 0) {
    check(`${type}: something is offered immediately`, quick.length > 0);
  }
}

// The specific decisions worth pinning, because they are judgement calls.
const heroSplit = splitFields("hero", fieldsFor("hero"));
check("hero: the heading and the button are quick",
  ["title", "ctaLabel", "ctaUrl"].every((k) => heroSplit.quick.some((f) => f.key === k)));
check("hero: the badge and the second button are not",
  ["badge", "cta2Label"].every((k) => heroSplit.advanced.some((f) => f.key === k)));

const baSplit = splitFields("before_after", fieldsFor("before_after"));
check("before/after: the AFTER image is quick, not an extra",
  baSplit.quick.some((f) => f.key === "media2Url"));

const formSplit = splitFields("contact_form", fieldsFor("contact_form"));
check("a form's handler is quick — a form that posts nowhere is not a form",
  formSplit.quick.some((f) => f.key === "formHandler"));

const countdownSplit = splitFields("countdown", fieldsFor("countdown"));
check("countdown: the deadline is the first thing you set",
  countdownSplit.quick.some((f) => f.key === "deadline"));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nC. REDIRECTS POINT WHERE THEY SAY");

check("a bare word becomes a path", normalizePath("promocja") === "/promocja");
check("case does not matter", normalizePath("/Promocja") === "/promocja");
check("a trailing slash does not matter", normalizePath("/promocja/") === "/promocja");
check("a query string is not part of the match",
  normalizePath("/promocja?utm_source=ig") === "/promocja");
check("a fragment is not either", normalizePath("/promocja#oferta") === "/promocja");
check("nested paths survive", normalizePath("/promo/2x-kredyty") === "/promo/2x-kredyty");
check("the root stays the root", normalizePath("/") === "/");
check("empty stays empty", normalizePath("") === "");

check("an internal target is kept", normalizeTarget("/promo/2x") === "/promo/2x");
check("an https target is kept", normalizeTarget("https://grovbase.com/x") === "https://grovbase.com/x");
check("http is refused", normalizeTarget("http://grovbase.com/x") === null);
check("javascript: is refused", normalizeTarget("javascript:alert(1)") === null);
check("a bare word is refused as a target", normalizeTarget("promocja") === null);
check("a doubled slash is collapsed", normalizeTarget("//evil.example") === "/evil.example");

check("the admin panel cannot be redirected", sourceIsProtected("/admin"));
check("…nor anything under it", sourceIsProtected("/admin/www/przekierowania"));
check("…nor the generator", sourceIsProtected("/k/moda/retusz"));
check("…nor the API", sourceIsProtected("/api/generations"));
check("…nor the root", sourceIsProtected("/"));
check("a campaign path is fine", !sourceIsProtected("/promocja"));
check("a nested campaign path is fine", !sourceIsProtected("/promo/2x-kredyty"));
// The one that would be embarrassing: /toolsy is not /tools.
check("a path that merely starts with a reserved word is fine",
  !sourceIsProtected("/toolsy-promo"));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nD. A SECTION APPEARS WHEN IT SHOULD, FOR WHOM IT SHOULD");

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const at = (iso: string) => ({ show_from: iso, show_until: null, audience: "everyone" });

check("no window means always", sectionIsLive({ audience: "everyone" }, { now: NOW }));
check("before the start it is not live",
  !sectionIsLive(at("2026-09-19T00:00:00.000Z"), { now: NOW }));
check("after the start it is",
  sectionIsLive(at("2026-09-17T00:00:00.000Z"), { now: NOW }));
check("the end is exclusive — at the very second it ends, it is gone",
  !sectionIsLive({ show_from: null, show_until: "2026-09-18T12:00:00.000Z", audience: "everyone" },
    { now: NOW }));
check("a second before the end it is still there",
  sectionIsLive({ show_from: null, show_until: "2026-09-18T12:00:01.000Z", audience: "everyone" },
    { now: NOW }));
check("a malformed date is treated as no limit, not as 'never'",
  sectionIsLive({ show_from: "kiedyś", show_until: null, audience: "everyone" }, { now: NOW }));

check("an anon-only section is hidden from a signed-in visitor",
  !sectionIsLive({ audience: "anon" }, { now: NOW, signedIn: true }));
check("…and shown to a signed-out one",
  sectionIsLive({ audience: "anon" }, { now: NOW, signedIn: false }));
check("a user-only section is hidden from a signed-out visitor",
  !sectionIsLive({ audience: "user" }, { now: NOW, signedIn: false }));
check("an unknown audience shows the section rather than hiding it",
  sectionIsLive({ audience: "kosmici" }, { now: NOW, signedIn: false }));

check("a page with no promotion is always open", promoIsOpen(undefined, NOW));
check("an inactive promotion does not close the page",
  promoIsOpen({ active: false, endAt: "2020-01-01T00:00:00.000Z" }, NOW));
check("an active promotion closes after its end",
  !promoIsOpen({ active: true, endAt: "2026-09-18T11:59:59.000Z" }, NOW));
check("an active promotion is shut before its start",
  !promoIsOpen({ active: true, startAt: "2026-09-19T00:00:00.000Z" }, NOW));
check("an active promotion inside its window is open",
  promoIsOpen({ active: true, startAt: "2026-09-17T00:00:00.000Z", endAt: "2026-09-20T00:00:00.000Z" }, NOW));

check("only the two bar-shaped sections are pinned",
  PINNED_SECTIONS.size === 2 && PINNED_SECTIONS.has("promo_bar") && PINNED_SECTIONS.has("sticky_cta"));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log(failures === 0 ? "\nAll builder tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
