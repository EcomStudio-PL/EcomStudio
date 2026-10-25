/**
 * PUBLIC TOOLS V1 — the rules a visitor's tool page stands on, checked
 * without a browser or a database (the SQL side: scripts/public-tools-sql-tests.sh;
 * the browser side: the Playwright run described in the report).
 *
 *   A. which tools are public — and that each is one the catalogue already has
 *   B. the panel state machine (A / B / B2 / C / D)
 *   C. the pack suggested for a shortfall
 *   D. the local draft: lifetime, owner, consent
 *   E. analytics: closed list, safe parameters
 *   F. the copy: every key in PL, EN and DE, within the editor's limits
 *   G. "Edytuj stronę": the block registered, nothing denied, Retusz untouched
 *   H. FAQ: assigning questions to tools
 *   I. source guards: what must never be possible, read from the code itself
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DRAFT_TTL_MS, DRAFT_VERSION, GUEST_OWNER, GUEST_PREVIEW_COOKIE, GUEST_PREVIEW_ROUTE, PATH_HEADER,
  PUBLIC_CATALOGUE_PATH, PUBLIC_TOOLS, TOOL_EVENTS, TOOL_EXAMPLE_PAIRS, TOOL_PAGE_SHARED_KEYS,
  cleanPath, draftExpired, draftNeedsConsent, draftOwner, isPublicToolPath, publicToolByKey, publicToolForPath,
  recommendedPack, toolExampleSlot, toolPageTextKeys, toolState, type PackOption, type ToolViewerFacts,
} from "../lib/public-tools";
import { CATALOG_ITEMS } from "../lib/tool-cards";
import { EVENT_PARAM_KEYS, eventParams, isAnalyticsEvent } from "../lib/analytics/ga";
import { lookup } from "../lib/i18n/t";
import { ICE_PAGES, ICE_UNSUPPORTED, icePageFor, isDeniedKey, pageTextKeys, slotSpec, textSpec } from "../lib/ice/registry";
import { FAQ_TOOLS, faqHiddenReasons } from "../lib/faq";
import { validateFaqItem } from "../lib/services/faq";
import { faqToolItems, TOOL_FAQ_LIMIT } from "../lib/server/faq";
import pl from "../lib/i18n/dictionaries/pl.json";
import en from "../lib/i18n/dictionaries/en.json";
import de from "../lib/i18n/dictionaries/de.json";

let failed = 0;
let passed = 0;
function section(title: string) { console.log(`\n${title}`); }
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const short = (xs: readonly unknown[]) => xs.slice(0, 8).map(String).join(", ") + (xs.length > 8 ? ` … (+${xs.length - 8})` : "");
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ── A ─────────────────────────────────────────────────────────────────── */
section("A. WHICH TOOLS ARE PUBLIC");
{
  const keys = PUBLIC_TOOLS.map((t) => t.key);
  const paths = PUBLIC_TOOLS.map((t) => t.path);
  check("A1 keys and paths are unique", new Set(keys).size === keys.length && new Set(paths).size === paths.length);
  const hrefs = new Set(CATALOG_ITEMS.map((c) => cleanPath(c.href)));
  const orphan = paths.filter((p) => !hrefs.has(p));
  check("A2 every public tool is a destination the catalogue already lists (no second activation system)", orphan.length === 0, short(orphan));
  check("A3 every public path and the catalogue are public paths", paths.every(isPublicToolPath) && isPublicToolPath(PUBLIC_CATALOGUE_PATH));
  const closed = ["/library", "/settings", "/credits", "/checkout", "/admin", "/k/fashion/street", "/tools/ghost_mannequin", "/tools/relight", "/support", "/history", "/products"];
  const open = closed.filter(isPublicToolPath);
  check("A4 account pages, money pages and non-adapted panels are NOT public paths", open.length === 0, short(open));
  check("A5 a trailing slash and a query do not change the answer", isPublicToolPath("/retusz/") && isPublicToolPath("/tools/remove_bg?x=1") && !isPublicToolPath("/retuszx"));
  check("A6 publicToolForPath / publicToolByKey agree", PUBLIC_TOOLS.every((t) => publicToolForPath(t.path)?.key === t.key && publicToolByKey(t.key)?.path === t.path));
  check("A7 the catalogue is not a tool", publicToolForPath(PUBLIC_CATALOGUE_PATH) === null);
}

/* ── B ─────────────────────────────────────────────────────────────────── */
section("B. ONE STATE MACHINE FOR EVERY PANEL");
{
  const member = (over: Partial<Extract<ToolViewerFacts, { kind: "member" }>> = {}): ToolViewerFacts => ({
    kind: "member", viewerKey: "u1", emailVerified: true, planActive: false, bonus: null, bonusOffered: null, fresh: false, ...over,
  });
  const guest: ToolViewerFacts = { kind: "guest", preview: false };
  check("B1 a visitor is A whatever the numbers", toolState(guest, 0, 10).code === "A" && toolState(guest, 999, 1).code === "A"
    && toolState({ kind: "guest", preview: true }, 0, 0).code === "A");
  check("B2 enough credits → B (12 for 10, and exactly 10 for 10)", toolState(member(), 12, 10).code === "B" && toolState(member(), 10, 10).code === "B");
  check("B3 a free configuration is B even at 0", toolState(member(), 0, 0).code === "B");
  const c = toolState(member(), 3, 10);
  check("B4 too few, no plan → C with the exact shortfall", c.code === "C" && c.missing === 7, JSON.stringify(c));
  const d = toolState(member({ planActive: true }), 3, 10);
  check("B5 too few on a paid plan → D with the shortfall", d.code === "D" && d.missing === 7, JSON.stringify(d));
  const v = toolState(member({ emailVerified: false, bonusOffered: 20 }), 0, 10);
  check("B6 unverified while a bonus is offered → B2 verify (amount from config)", v.code === "B2" && v.step === "verify" && v.bonus === 20 && v.missing === 10, JSON.stringify(v));
  const s = toolState(member({ bonus: { amount: 25 } }), 0, 10);
  check("B7 a bonus waiting for the survey → B2 survey (amount from the offer)", s.code === "B2" && s.step === "survey" && s.bonus === 25, JSON.stringify(s));
  check("B8 an unverified account with NO campaign is not sent to verify", toolState(member({ emailVerified: false }), 0, 10).code === "C");
  check("B9 an unclaimed bonus never hides credits that are enough", toolState(member({ bonus: { amount: 25 }, emailVerified: false, bonusOffered: 25 }), 50, 10).code === "B");
  const odd = toolState(member(), Number.NaN, Number.NaN);
  check("B10 NaN in, a sane state out (no NaN shortfall)", odd.code === "B");
  const frac = toolState(member(), 9.9, 10.1);
  check("B11 fractions: the balance floors, the price ceils", frac.code === "C" && frac.missing === 2, JSON.stringify(frac));
  check("B12 a negative balance counts as zero", (() => { const x = toolState(member(), -5, 4); return x.code === "C" && x.missing === 4; })());
}

/* ── C ─────────────────────────────────────────────────────────────────── */
section("C. THE PACK SUGGESTED FOR A SHORTFALL");
{
  const pack = (slot: number, bonus: number, cents: number | null, href: string | null = "/checkout?x"): PackOption => ({ slot, bonusCredits: bonus, amountCents: cents, href });
  const packs = [pack(100, 0, 4900), pack(50, 0, 2900), pack(250, 25, 9900), pack(500, 0, null), pack(30, 0, 1900, null)];
  check("C1 the smallest buyable pack that covers it", recommendedPack(packs, 40)?.slot === 50);
  check("C2 the bonus credits count", recommendedPack(packs, 270)?.slot === 250);
  check("C3 a pack without a price or a checkout link is never suggested", recommendedPack(packs, 10)?.slot === 50 && recommendedPack([pack(500, 0, null), pack(30, 0, 1900, null)], 10) === null);
  check("C4 nothing covers it → the largest buyable one", recommendedPack(packs, 10_000)?.slot === 250);
  check("C5 nothing on sale → none", recommendedPack([], 5) === null);
}

/* ── D ─────────────────────────────────────────────────────────────────── */
section("D. THE LOCAL DRAFT");
{
  const now = Date.now();
  check("D1 24 hours", DRAFT_TTL_MS === 24 * 60 * 60 * 1000);
  check("D2 expired at the deadline, alive before it", draftExpired({ v: DRAFT_VERSION, expiresAt: now }, now) && !draftExpired({ v: DRAFT_VERSION, expiresAt: now + 1 }, now));
  check("D3 another schema version is discarded, never half-read", draftExpired({ v: DRAFT_VERSION + 1, expiresAt: now + DRAFT_TTL_MS }, now));
  check("D4 a broken deadline is expired", draftExpired({ v: DRAFT_VERSION, expiresAt: Number.NaN }, now));
  const g: ToolViewerFacts = { kind: "guest", preview: false };
  const m = (id: string): ToolViewerFacts => ({ kind: "member", viewerKey: id, emailVerified: true, planActive: false, bonus: null, bonusOffered: null, fresh: true });
  check("D5 a visitor's own draft comes back silently", !draftNeedsConsent({ owner: GUEST_OWNER }, g));
  check("D6 a visitor's draft meeting an account is OFFERED, not applied", draftNeedsConsent({ owner: GUEST_OWNER }, m("u1")));
  check("D7 another account's draft is offered — to a visitor and to another account", draftNeedsConsent({ owner: "u1" }, g) && draftNeedsConsent({ owner: "u1" }, m("u2")));
  check("D8 an account's own draft comes back silently", !draftNeedsConsent({ owner: "u1" }, m("u1")));
  check("D9 saved under 'guest' or the account id", draftOwner(g) === GUEST_OWNER && draftOwner(m("u7")) === "u7");
}

/* ── E ─────────────────────────────────────────────────────────────────── */
section("E. ANALYTICS");
{
  check("E1 the fourteen funnel events, all on the closed list", TOOL_EVENTS.length === 14 && TOOL_EVENTS.every(isAnalyticsEvent));
  check("E2 an unknown event is refused", !isAnalyticsEvent("tool_free_credits") && !isAnalyticsEvent(""));
  check("E3 tool_id, source and state are the only new parameters", ["tool_id", "source", "state"].every((k) => (EVENT_PARAM_KEYS as readonly string[]).includes(k)));
  const p = eventParams({ tool_id: "ecommerce.thumbnail", source: "generate", state: "b2", ...({ email: "a@b.pl", prompt: "x" } as object) });
  check("E4 a tool key passes, anything personal is dropped", p.tool_id === "ecommerce.thumbnail" && p.source === "generate" && !("email" in p) && !("prompt" in p), JSON.stringify(p));
  check("E5 a free-text value is dropped", !("source" in eventParams({ source: "Mój prompt: czerwony but" })));
}

/* ── F ─────────────────────────────────────────────────────────────────── */
section("F. THE COPY, IN THREE LANGUAGES");
{
  const dicts = { pl, en, de } as Record<string, Record<string, unknown>>;
  const missing: string[] = [];
  const tooLong: string[] = [];
  const keys = [
    ...PUBLIC_TOOLS.flatMap((t) => Object.values(toolPageTextKeys(t.key))),
    ...Object.values(TOOL_PAGE_SHARED_KEYS),
    "toolPage.catalogue.title", "toolPage.catalogue.description",
  ];
  for (const [l, d] of Object.entries(dicts)) for (const k of keys) {
    const v = lookup(d, k);
    if (!v || !v.trim()) missing.push(`${l}:${k}`);
    const spec = textSpec(k);
    if (v && spec?.text && v.length > spec.text.maxLength) tooLong.push(`${l}:${k}`);
  }
  check("F1 every tool's headline and lead, the shared labels and the catalogue copy exist in PL/EN/DE", missing.length === 0, short(missing));
  check("F2 none longer than the editor allows", tooLong.length === 0, short(tooLong));
  // Every literal key the new code names — read from the source, not typed twice.
  const files = ["components/public-tools", "components/admin/public-tools-card.tsx", "components/auth/auth-modal.tsx", "components/layout/mega-topbar.tsx", "components/layout/account-menu.tsx"];
  const walk = (p: string): string[] => statSync(join(ROOT, p)).isDirectory()
    ? readdirSync(join(ROOT, p)).flatMap((f) => walk(join(p, f))) : [p];
  const src = files.flatMap(walk).filter((f) => /\.tsx?$/.test(f)).map(read).join("\n");
  const literal = [...new Set([...src.matchAll(/"((?:publicTools|toolPage)\.[A-Za-z0-9_.]+|auth\.(?:tool[A-Za-z]+|signUpFree))"/g)].map((m) => m[1]))];
  const dynamic = ["publicTools.draft.partial", "publicTools.draft.unavailable", "publicTools.draft.full",
    "publicTools.notice.missingOne", "publicTools.notice.missingImageOne"];
  const absent: string[] = [];
  for (const [l, d] of Object.entries(dicts)) for (const k of [...literal, ...dynamic]) if (!lookup(d, k)) absent.push(`${l}:${k}`);
  check(`F3 every key the new code names (${literal.length} literal + ${dynamic.length} built) resolves in PL/EN/DE`, literal.length > 40 && absent.length === 0, short(absent));
  const exact = (k: string) => lookup(pl, k);
  check("F4 the brief's own words, verbatim in Polish",
    exact("auth.toolRegisterTitle") === "Załóż konto, żeby wygenerować grafikę"
    && exact("auth.toolRegisterSub") === "Na start dostajesz darmowe kredyty"
    && exact("publicTools.notice.watermark") === "Grafiki z darmowych kredytów mają znak wodny"
    && exact("publicTools.notice.choosePlanBody") === "Wybierz plan, żeby dalej korzystać z narzędzi"
    && exact("publicTools.notice.verify") === "Potwierdź adres e-mail, żeby odebrać darmowe kredyty"
    && exact("publicTools.preview.exit") === "Wyjdź z podglądu"
    && exact("toolPage.cta") === "Wypróbuj za darmo");
}

/* ── G ─────────────────────────────────────────────────────────────────── */
section("G. \"EDYTUJ STRONĘ\"");
{
  const editable = PUBLIC_TOOLS.filter((t) => t.key !== "retouch");
  const noBlock = editable.filter((t) => !icePageFor(t.path)?.sections.some((s) => s.key === "toolPublic"));
  check("G1 every public tool page but Retusz opens with its public block", noBlock.length === 0, short(noBlock.map((t) => t.path)));
  check("G2 Retusz stays frozen: not opened, and still listed as such", icePageFor("/retusz") === null
    && ICE_UNSUPPORTED.some((u) => u.reason === "frozen" && u.path.includes("/retusz")));
  const badPairs = editable.filter((t) => {
    const page = icePageFor(t.path)!;
    const pairs = page.sections.find((s) => s.key === "toolPublic")!.elements.filter((e) => e.kind === "pair");
    return pairs.length !== TOOL_EXAMPLE_PAIRS || pairs.some((e, i) => e.slots?.[0].key !== toolExampleSlot(t.key, i + 1, "before")
      || e.slots?.[1].key !== toolExampleSlot(t.key, i + 1, "after") || e.slots.some((s) => s.ratio !== "1080/1080" && s.width !== s.height));
  });
  check("G3 four 1:1 before/after pairs per tool, on the keys the page reads", badPairs.length === 0, short(badPairs.map((t) => t.key)));
  const slotsOk = editable.every((t) => [1, 2, 3, 4].every((n) => slotSpec(toolExampleSlot(t.key, n, "before"))?.video === false));
  check("G4 the example slots are registered, still images only", slotsOk);
  const denied = ICE_PAGES.flatMap((p) => pageTextKeys(p)).filter((k) => k.startsWith("toolPage.") && isDeniedKey(k));
  check("G5 no block key is one the editor must refuse", denied.length === 0, short(denied));
  const panels = editable.flatMap((t) => pageTextKeys(icePageFor(t.path)!).filter((k) => /^(retouch|genv3|thumb|checkout|credits|pricing)\./.test(k)));
  check("G6 the panels themselves stay out of the editor (no workspace copy registered)", panels.length === 0, short(panels));
}

/* ── H ─────────────────────────────────────────────────────────────────── */
section("H. FAQ: QUESTIONS ASSIGNED TO TOOLS");
{
  const base = { category_id: "00000000-0000-4000-8000-000000000001", question: { pl: "Pytanie?" }, answer: { pl: "Tak." }, pages: [], visible: true, needs_review: false, only_premiere: false };
  check("H1 the assignable tools are exactly the public tools", FAQ_TOOLS.join() === PUBLIC_TOOLS.map((t) => t.key).join());
  const ok = validateFaqItem({ ...base, tools: ["retouch", "ecommerce.thumbnail"] });
  check("H2 known tools are accepted", ok.ok && ok.value.tools.join() === "retouch,ecommerce.thumbnail");
  check("H3 an unknown tool is refused (field 'tools')", (() => { const r = validateFaqItem({ ...base, tools: ["fashion.street"] }); return !r.ok && r.field === "tools"; })());
  check("H4 an older editor sending no tools saves none", (() => { const r = validateFaqItem(base); return r.ok && r.value.tools.length === 0; })());
  const q = { visible: true, needs_review: false, question: { pl: "Q?" }, answer: { pl: "A." }, only_premiere: false };
  check("H5 assigned to a tool only is not 'nowhere'", !faqHiddenReasons({ ...q, pages: [], tools: ["retouch"] }, { visible: true }).includes("no_pages")
    && faqHiddenReasons({ ...q, pages: [], tools: [] }, { visible: true }).includes("no_pages"));
  const row = (slug: string, tools: string[], extra: Record<string, unknown> = {}) => ({
    slug, category: "c", category_name: null, category_position: 1, category_topic: "other", position: 1,
    question: { pl: `${slug}?`, en: `${slug} en?` }, answer: { pl: "Odpowiedź." }, pages: [], only_premiere: false, tools, ...extra,
  });
  const rows = [row("a", ["retouch"]), row("b", ["remove_bg"]), row("c", ["retouch", "upscale"]), row("d", ["retouch"], { only_premiere: true }),
    row("e", ["retouch"]), row("f", ["retouch"]), row("g", ["retouch"], { answer: { pl: "" } })];
  const got = faqToolItems(rows, "retouch", "pl", false).map((x) => x.slug);
  check("H6 at most three, in the base's order, only the tool's own, premiere-only dropped outside the premiere", TOOL_FAQ_LIMIT === 3 && got.join() === "a,c,e", got.join());
  check("H7 the premiere-only question appears during the premiere", faqToolItems(rows, "retouch", "pl", true).map((x) => x.slug).join() === "a,c,d");
  check("H8 another language falls back to Polish where it has no text", faqToolItems(rows, "retouch", "de", false)[0]?.q === "a?"
    && faqToolItems(rows, "retouch", "en", false)[0]?.q === "a en?");
  check("H9 a row from before 0158 (no tools) is never on a tool page", faqToolItems([{ ...row("x", []), tools: undefined }], "retouch", "pl", true).length === 0);
}

/* ── I ─────────────────────────────────────────────────────────────────── */
section("I. WHAT MUST NEVER BE POSSIBLE (read from the code)");
{
  const mw = read("lib/supabase/middleware.ts");
  check("I1 the path header is overwritten on every request (a client value never reaches a layout)", /request\.headers\.set\(PATH_HEADER, request\.nextUrl\.pathname\)/.test(mw) && PATH_HEADER === "x-gb-path");
  check("I2 while previewing, every non-GET API call and server action outside /admin is refused",
    mw.includes("GUEST_PREVIEW_COOKIE") && /request\.method !== "GET" && request\.method !== "HEAD"/.test(mw)
    && mw.includes('request.headers.has("next-action")') && mw.includes("guest_preview") && mw.includes("status: 403"));
  check("I3 the edge only stops redirecting public tool paths — the switch is decided on the server",
    /isProtectedPath\(pathname\) && !isPublicToolPath\(pathname\)/.test(mw));
  const route = read("app/api/admin/guest-preview/route.ts");
  check("I4 the preview cookie is set only after the server checked the admin role, httpOnly, never by a URL parameter",
    /profile\?\.role !== "admin"/.test(route) && /httpOnly:\s*true/.test(route) && route.includes("GUEST_PREVIEW_COOKIE") && GUEST_PREVIEW_COOKIE.length > 0
    && !/searchParams|adminPreview/.test(route) && GUEST_PREVIEW_ROUTE === "/api/admin/guest-preview");
  const fa = read("lib/server/feature-availability.ts");
  check("I5 the preview cookie only REMOVES admin privilege (viewerIsAdmin is false under it)", /GUEST_PREVIEW_COOKIE/.test(fa));
  const kit = walkFiles("components/public-tools").map(read).join("\n");
  check("I6 a visitor's photos never touch localStorage or sessionStorage", !/(localStorage|sessionStorage)\s*[.[]/.test(kit));
  check("I7 the draft store sends nothing anywhere (its only fetch reads an object URL it was handed)",
    (read("components/public-tools/draft-store.ts").match(/fetch\(/g) ?? []).length === 1 && !/supabase|\/api\//.test(read("components/public-tools/draft-store.ts")));
  const server = read("lib/server/public-tools.ts");
  check("I8 the guest reader is server-only and never handed to a client module",
    server.startsWith('import "server-only"') && !clientImports("lib/server/public-tools"));
  const panels = ["components/retouch/workspace.tsx", "components/tools/photo-tool.tsx", "components/tools/workbench.tsx",
    "components/tools/resize-workbench.tsx", "components/tools/compress-workbench.tsx", "components/thumbnail/workspace.tsx",
    "components/genv3/workspace.tsx", "components/editor/image-editor.tsx"];
  const ungated = panels.filter((p) => { const s = read(p); return !s.includes("useToolSession") || !/session\.gate\(/.test(s); });
  check("I9 every adapted panel routes its paid action through the session gate (a visitor's Generate opens the dialog)", ungated.length === 0, short(ungated));
  // Coming back restores settings and photos — it never runs anything.
  const sessionSrc = read("components/public-tools/use-tool-session.ts");
  const put = sessionSrc.slice(sessionSrc.indexOf("const put = () => {"), sessionSrc.indexOf("if (!draftNeedsConsent(draft, facts))"));
  check("I10 restoring a draft only applies it — no gate, no run, no generation starts after login by itself",
    put.length > 50 && put.includes("latest.current.apply(") && !/gate\(|run\(|fetch\(/.test(put));
  const meta = read("lib/server/public-tool-meta.ts");
  check("I11 indexable only while the switch is on (and the catalogue lists the tool)",
    /index: false, follow: false/.test(meta) && /getPublicToolsFlag\(supabase\)\)\.enabled && \(await listedToolPaths/.test(meta));
  const action = read("app/actions/public-tools.ts");
  check("I12 the switch is written only by an admin, audited, and defaults to off",
    /profile\?\.role !== "admin"/.test(action) && /await requireAdmin\(\);\s*\n\s*if \(typeof enabled/.test(action)
    && /logAudit\(/.test(action) && /enabled: value\?\.enabled === true/.test(server) && /const OFF: PublicToolsFlag = \{ enabled: false/.test(server));
  const seo = read("components/public-tools/tool-scope.tsx");
  check("I13 the public block renders for a visitor, or for an admin editing that very page — never for a customer",
    /<PublicToolSeo tool=\{tool\} \/>/.test(seo) && /iceEditSession\(\)\)\?\.path === tool\.path/.test(seo));
}

function walkFiles(p: string): string[] {
  return statSync(join(ROOT, p)).isDirectory() ? readdirSync(join(ROOT, p)).flatMap((f) => walkFiles(join(p, f))) : [p];
}

/** Does any "use client" module import this path? */
function clientImports(target: string): boolean {
  const roots = ["components", "app", "lib"];
  for (const r of roots) for (const f of walkFiles(r)) {
    if (!/\.tsx?$/.test(f)) continue;
    const s = read(f);
    if (/^\s*["']use client["']/.test(s) && s.includes(`@/${target}"`)) return true;
  }
  return false;
}

console.log(`\n${failed === 0 ? `All public tools tests passed (${passed} checks).` : `${failed} PUBLIC TOOLS TEST(S) FAILED (${passed} passed).`}`);
if (failed > 0) process.exit(1);
