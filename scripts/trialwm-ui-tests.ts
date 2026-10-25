/**
 * TRIAL WATERMARK — THE CUSTOMER UI (components/trial-watermark/*) and the five
 * surfaces that mount it: the generator/tool gallery, the lightbox, the
 * regenerate editor, the library, and the client GalleryItem type.
 *
 *   npm run test:trialwm:ui
 *
 * Before the i18n scratch is merged into the dictionaries, point the run at
 * it: TRIALWM_I18N_EXTRA=<path to i18n-ui.json> npm run test:trialwm:ui —
 * the extra keys are overlaid in memory only, and section E then reports
 * which keys the dictionaries still lack.
 *
 *   A. the pure helpers (components/trial-watermark/model.ts)
 *   B. markup of the chip, the row lock, the lightbox plate, the R5 hint and
 *      the paywall, rendered on the server with the real dictionary
 *   C. the surfaces' source: where the lock sits, R5 (no marked pixels to a
 *      model), the literals other suites pin, no new fetch on mount
 *   D. the dialogs' source: z-[75] portal, capture-phase Escape, overflow
 *      restored, saves only through lib/save-image, no any / ts-ignore
 *   E. i18n: every key in pl/en/de, the brief's copy verbatim, the app scope
 *   F. the dialogs in a real browser (Chromium): paywall, entitled unlock,
 *      download-link refresh, the post-checkout wait, errors, Escape, the
 *      locked close, and the bulk loop. Skipped — and said so — without the
 *      browser binary; nothing skipped is counted as passed.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/lib/i18n/provider";
import type { GalleryTrial, TrialBulkResult, TrialPaywallPlan, TrialPaywallResult } from "@/lib/trial-watermark/types";
import {
  BULK_MAX_BATCHES, BULK_SKIP_MAX, CONFIRM_BUDGET_MS, CONFIRM_DELAYS_MS, LINK_MARGIN_MS,
  availableLine, bulkAdvance, bulkContinues, bulkSkip, bulkStart, daysLeftOf, daysShort, errorKey, goneLine,
  highlightedPlanIds, isLocked, isMarked, linkExpiresAt, needsFreshLink, nextConfirmDelay, orderPlans, parseBulk,
  parseStatus, parseUnlock, patchAsset, safeHref, underADay, unlockedPatch,
  BULK_FINAL_REASONS, bulkLockedLeft, bulkResolved,
} from "@/components/trial-watermark/model";
import { TrialLockButton, TrialLockChip, TrialMarkedHint, TrialNotice } from "@/components/trial-watermark/lock";
import { TrialPaywall } from "@/components/trial-watermark/paywall";
import { formatCount } from "@/components/plan/pricing-model";

/* ── fixtures ─────────────────────────────────────────────────────────────*/

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const locked = (days: number | null, expiresAt: string | null = null): GalleryTrial => ({ state: "locked", expiresAt, daysLeft: days });
const plan = (slug: string, o: Partial<TrialPaywallPlan> = {}): TrialPaywallPlan => ({
  id: `00000000-0000-4000-8000-00000000000${slug.length}`, slug, name: slug.toUpperCase(), nameKey: slug === "agency" ? "plans.tier.business" : null,
  priceCents: slug === "starter" ? 4900 : slug === "pro" ? 9900 : 24900, currency: "PLN",
  monthlyCredits: slug === "starter" ? 300 : slug === "pro" ? 1000 : 3000, bonusCredits: 0,
  featured: false, payable: true, checkoutHref: `/checkout?kind=subscription&plan=${slug}&period=monthly`, capabilities: [], ...o,
});
const PLANS = [plan("agency"), plan("pro"), plan("starter")];
const jwt = (exp: number, iat?: number) => `h.${Buffer.from(JSON.stringify(iat === undefined ? { exp } : { exp, iat })).toString("base64url")}.s`;

async function main() {

let failed = 0;
let passed = 0;
let skipped = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
}
const skip = (name: string, why: string) => { skipped += 1; console.log(`  – SKIP ${name} (${why})`); };
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const count = (src: string, needle: string | RegExp) =>
  typeof needle === "string" ? src.split(needle).length - 1 : (src.match(needle) ?? []).length;
const T = (k: string, v?: Record<string, string | number>) => (v ? `${k}(${Object.values(v).join(",")})` : k);

/* ── dictionaries (+ the not-yet-merged scratch, when asked) ───────────────*/

type Dict = Record<string, unknown>;
const LOCALES = ["pl", "en", "de"] as const;
const dicts = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as Dict])) as Record<typeof LOCALES[number], Dict>;
// One or more scratch files, comma-separated (the UI's own and the pipeline's,
// whose studio.err.* keys the lightbox reuses).
const extraPath = process.env.TRIALWM_I18N_EXTRA;
const extraFiles = (extraPath ?? "").split(",").map((p) => p.trim()).filter((p) => p && existsSync(p));
const extra = extraFiles.length === 0 ? null : extraFiles.reduce<Record<string, Record<string, string>>>((acc, f) => {
  const data = JSON.parse(readFileSync(f, "utf8")) as Record<string, Record<string, string>>;
  for (const l of LOCALES) acc[l] = { ...acc[l], ...data[l] };
  return acc;
}, { pl: {}, en: {}, de: {} });
function lookup(d: Dict, key: string): unknown {
  return key.split(".").reduce<unknown>((n, seg) => (n && typeof n === "object" ? (n as Dict)[seg] : undefined), d);
}
function setDeep(d: Dict, key: string, v: string) {
  const parts = key.split(".");
  let node = d;
  for (const seg of parts.slice(0, -1)) {
    if (typeof node[seg] !== "object" || node[seg] === null) node[seg] = {};
    node = node[seg] as Dict;
  }
  if (node[parts[parts.length - 1]] === undefined) node[parts[parts.length - 1]] = v;
}
const live = Object.fromEntries(LOCALES.map((l) => {
  const d = structuredClone(dicts[l]);
  for (const [k, v] of Object.entries(extra?.[l] ?? {})) setDeep(d, k, v);
  return [l, d];
})) as Record<typeof LOCALES[number], Dict>;
const pl = (key: string, vars?: Record<string, string | number>) => {
  let s = lookup(live.pl, key);
  if (typeof s !== "string") return `<<missing ${key}>>`;
  for (const [k, v] of Object.entries(vars ?? {})) s = (s as string).replaceAll(`{${k}}`, String(v));
  return s as string;
};
if (extra) console.log(`(overlaying ${Object.keys(extra.pl ?? {}).length} scratch keys from ${extraPath})`);

/* ═════════════════════════════════════════════════════════════════════════ */
section("A. THE PURE HELPERS");

check("A1 isLocked only for locked; isMarked for locked / expired / unavailable",
  isLocked(locked(3)) && !isLocked({ state: "expired", expiresAt: null, daysLeft: null })
  && isMarked(locked(3)) && isMarked({ state: "expired", expiresAt: null, daysLeft: null })
  && isMarked({ state: "unavailable", expiresAt: null, daysLeft: null })
  && !isMarked({ state: "unlocked", expiresAt: null, daysLeft: null }) && !isMarked(null) && !isMarked(undefined));
check("A2 daysLeftOf prefers the server's count (SSR-stable), falls back to the expiry, null unless locked",
  daysLeftOf(locked(7, iso(NOW + 2 * DAY)), NOW) === 7
  && daysLeftOf(locked(null, iso(NOW + 2 * DAY - 1)), NOW) === 2
  && daysLeftOf({ state: "unlocked", expiresAt: null, daysLeft: 4 }, NOW) === null && daysLeftOf(null) === null);
check("A3 underADay: exactly 24 h left is under a day, 24 h + 1 ms is not; without an expiry daysLeft ≤ 1",
  underADay(iso(NOW + DAY), 1, NOW) && !underADay(iso(NOW + DAY + 1), 2, NOW)
  && underADay(null, 1, NOW) && !underADay(null, 2, NOW) && !underADay(null, null, NOW));
check("A4 availableLine / daysShort: one key for 1 (and 0), the {n} key otherwise, a plain line without a count",
  availableLine(T, 1) === "genv3.wm.availableOne" && availableLine(T, 0) === "genv3.wm.availableOne"
  && availableLine(T, 5) === "genv3.wm.available(5)" && availableLine(T, null) === "genv3.wm.availablePlain"
  && daysShort(T, 1) === "genv3.wm.daysShortOne" && daysShort(T, 22) === "genv3.wm.daysShort(22)" && daysShort(T, null) === null);
check("A5 goneLine: expired and unavailable each have their neutral line; locked/unlocked/none have none",
  goneLine(T, { state: "expired", expiresAt: null, daysLeft: null }) === "genv3.wm.expired"
  && goneLine(T, { state: "unavailable", expiresAt: null, daysLeft: null }) === "genv3.wm.unavailable"
  && goneLine(T, locked(3)) === null && goneLine(T, null) === null);
const patch = unlockedPatch({ path: "w/j/u-1.png", url: "U", thumbUrl: "TU", previewUrl: "PU", hasThumb: true });
check("A6 unlockedPatch carries path/url/thumbUrl/previewUrl/hasThumb and trial = unlocked (no expiry, no days)",
  patch.path === "w/j/u-1.png" && patch.url === "U" && patch.thumbUrl === "TU" && patch.previewUrl === "PU" && patch.hasThumb
  && patch.trial.state === "unlocked" && patch.trial.expiresAt === null && patch.trial.daysLeft === null);
{
  const list = [
    { assetId: "a1", generationId: "g", url: "old1" }, { assetId: "a2", generationId: "g", url: "old2" },
  ];
  const next = patchAsset(list, "a2", { url: "new2" });
  check("A7 patchAsset patches ONE asset — its job's other image keeps its own url — and returns the same list on a miss",
    next[0].url === "old1" && next[1].url === "new2" && next !== list && patchAsset(list, "zz", { url: "x" }) === list);
}
check("A8 orderPlans: Starter, PRO, Business (the /plany order), unknown slugs after, by price",
  orderPlans([plan("zeta", { priceCents: 1 }), ...PLANS, plan("alpha", { priceCents: 0 })]).map((p) => p.slug).join(",")
    === "starter,pro,agency,alpha,zeta");
check("A9 highlight: the catalogue's `featured` wins; else PRO; none when neither exists",
  [...highlightedPlanIds([plan("starter", { featured: true }), plan("pro")])].join() === plan("starter").id
  && [...highlightedPlanIds(PLANS)].join() === plan("pro").id && highlightedPlanIds([plan("starter")]).size === 0);
check("A10 safeHref keeps in-app paths only — never //host or an absolute URL",
  safeHref("/checkout?kind=subscription&plan=x&period=monthly") !== null && safeHref("//evil.test/x") === null
  && safeHref("https://evil.test") === null && safeHref(null) === null && safeHref("") === null);
{
  let total = 0; let n = 0;
  for (let attempt = 0; ; attempt++) { const d = nextConfirmDelay(attempt, total); if (d === null) break; total += d; n++; }
  check("A11 the post-checkout wait: 2 s first, growing, ~2 minutes in all, then stops",
    CONFIRM_DELAYS_MS[0] === 2000 && total <= CONFIRM_BUDGET_MS && total >= 100_000 && n >= 10
    && CONFIRM_DELAYS_MS.every((d, i) => i === 0 || d >= CONFIRM_DELAYS_MS[i - 1]), `total=${total} steps=${n}`);
}
{
  // The server's clock runs 2 minutes AHEAD of this device: exp − iat is the
  // lifetime (60 s), counted from when the link arrived here.
  const iat = Math.floor((NOW + 120_000) / 1000);
  const exp = iat + 60;
  const url = `https://x.supabase.co/storage/v1/object/sign/generation-assets/a.png?token=${jwt(exp, iat)}`;
  check("A12 linkExpiresAt = arrival + the token's own lifetime (exp − iat), whatever the two clocks say; else the shortest TTL (10 s)",
    linkExpiresAt(url, NOW) === NOW + 60_000 && linkExpiresAt("https://x/a.png", NOW) === NOW + 10_000
    && linkExpiresAt("https://x/a.png?token=garbage", NOW) === NOW + 10_000
    && linkExpiresAt(`https://x/a.png?token=${jwt(exp)}`, NOW) === NOW + 10_000);
  check("A13 needsFreshLink: refresh from lifetime − 5 s, never hand over a dead or missing link (a device behind the server too)",
    !needsFreshLink(url, NOW, NOW + 60_000 - LINK_MARGIN_MS - 1) && needsFreshLink(url, NOW, NOW + 60_000 - LINK_MARGIN_MS)
    && needsFreshLink(null, NOW, NOW));
}
{
  const ok = { state: "unlocked", assetId: "a", path: "p", url: "u", thumbUrl: "t", previewUrl: "v", hasThumb: true, downloadUrl: "d" };
  const u = parseUnlock(ok, 200);
  check("A14 parseUnlock: the full unlocked reply passes; one without downloadUrl is malformed",
    u.state === "unlocked" && u.downloadUrl === "d"
    && JSON.stringify(parseUnlock({ ...ok, downloadUrl: undefined }, 200)) === JSON.stringify({ state: "error", error: "malformed" }));
  const ne = parseUnlock({ state: "not_entitled", pending: true, hasLiveSubscription: false }, 200);
  check("A15 parseUnlock: not_entitled flags, expired, server errors keep their code, garbage becomes http_<status>",
    ne.state === "not_entitled" && ne.pending && !ne.hasLiveSubscription
    && parseUnlock({ state: "expired" }, 200).state === "expired"
    && JSON.stringify(parseUnlock({ state: "error", error: "busy" }, 200)) === JSON.stringify({ state: "error", error: "busy" })
    && JSON.stringify(parseUnlock("<html>", 502)) === JSON.stringify({ state: "error", error: "http_502" })
    && JSON.stringify(parseUnlock({ nope: 1 }, 429)) === JSON.stringify({ state: "error", error: "http_429" }));
  const s = parseStatus({ state: "unlocked", daysLeft: null, entitled: true, pending: false, planSlug: "pro", thumbUrl: "t", downloadUrl: "d" });
  check("A16 parseStatus reads the documented shape; an error body or garbage is null (the poll asks again)",
    s?.state === "unlocked" && s.downloadUrl === "d" && s.entitled
    && parseStatus({ state: "error", error: "trial_check_failed" }) === null && parseStatus(null) === null);
  const b = parseBulk({ state: "ok", bulkId: "B", unlocked: [{ ...ok }, { assetId: "x" }], failed: [{ assetId: "f", reason: "r" }, { reason: "no id" }], remaining: -3, done: false }, 200);
  check("A17 parseBulk keeps well-formed entries only and never a negative remaining",
    b.state === "ok" && b.unlocked.length === 1 && b.failed.length === 1 && b.failed[0].assetId === "f" && b.remaining === 0
    && parseBulk({ state: "ok", bulkId: "B" }, 200).state === "error" && parseBulk(null, 500).state === "error");
}
check("A18 errorKey: busy / stripe / rate limit / check failed / sign failed have their own sentence; anything else the generic one",
  errorKey("busy") === "genv3.wm.err.busy" && errorKey("stripe_unavailable") === "genv3.wm.err.stripeUnavailable"
  && errorKey("rate_limited") === "genv3.wm.err.rateLimited" && errorKey("trial_check_failed") === "genv3.wm.err.checkFailed"
  && errorKey("sign_failed") === "genv3.wm.err.signFailed" && errorKey("unlock_failed") === "genv3.wm.err.generic");
{
  const ok = (unlocked: string[], failedIds: string[], remaining: number, done = false): Extract<TrialBulkResult, { state: "ok" }> => ({
    state: "ok", bulkId: "B",
    unlocked: unlocked.map((assetId) => ({ assetId, path: "p", url: "u", thumbUrl: "t", previewUrl: "v", hasThumb: true })),
    failed: failedIds.map((assetId) => ({ assetId, reason: "x" })), remaining, done,
  });
  let p = bulkStart(6);
  const y0 = p.total;
  p = bulkAdvance(p, ok(["a", "b"], ["c"], 3));
  const after1 = { x: p.unlocked, y: p.total, skip: bulkSkip(p).join() };
  p = bulkAdvance(p, ok(["d"], ["c"], 2));
  const after2 = { x: p.unlocked, y: p.total, failed: p.failed.length, go: bulkContinues(p) };
  p = bulkAdvance(p, ok([], [], 2));
  check("A19 bulk: Y starts at the page's count, then X + failed + server remaining; a re-reported failure is not news",
    y0 === 6 && after1.x === 2 && after1.y === 6 && after1.skip === "c" && after2.x === 3 && after2.y === 6 && after2.failed === 1 && after2.go,
    JSON.stringify({ y0, after1, after2 }));
  check("A20 bulk: a batch that moves nothing stalls the run; done stops it; the batch ceiling stops it",
    p.stalled && !bulkContinues(p)
    && !bulkContinues(bulkAdvance(bulkStart(1), ok(["z"], [], 0, true)))
    && !bulkContinues({ ...bulkStart(9), batches: BULK_MAX_BATCHES }));
  {
    const q = bulkAdvance(bulkStart(5), ok(["a"], [{ assetId: "s", reason: "sign_failed" }, { assetId: "e", reason: "expired" }, { assetId: "b", reason: "busy" }].map((f) => f.assetId), 1));
    const failed = { ...q, failed: [{ assetId: "s", reason: "sign_failed" }, { assetId: "e", reason: "expired" }, { assetId: "b", reason: "busy" }] };
    const fixed = bulkResolved(failed, "s");
    check("A21b bulk: a committed-but-unsigned image (fresh links fetched) moves from failed to unlocked; Y unchanged",
      fixed.unlocked === failed.unlocked + 1 && fixed.failed.length === 2 && !fixed.failed.some((f) => f.assetId === "s")
      && bulkResolved(fixed, "nobody") === fixed, JSON.stringify(fixed));
    check("A21c bulk: what is left locked = the server's remainder + failures a retry can fix (expired / unavailable / not_found never)",
      bulkLockedLeft(fixed, 5) === 1 + 1 && BULK_FINAL_REASONS.has("expired") && BULK_FINAL_REASONS.has("unavailable")
      && BULK_FINAL_REASONS.has("not_found") && !BULK_FINAL_REASONS.has("busy") && bulkLockedLeft(bulkStart(4), 4) === 4);
    const ne = parseBulk({ state: "not_entitled", pending: false, hasLiveSubscription: false, assetId: "11111111-1111-4111-8111-111111111111" }, 200);
    const bad = parseBulk({ state: "not_entitled", pending: false, hasLiveSubscription: false, assetId: "../x" }, 200);
    check("A21d bulk not_entitled carries one locked asset id for the paywall (a uuid only)",
      ne.state === "not_entitled" && ne.assetId === "11111111-1111-4111-8111-111111111111"
      && bad.state === "not_entitled" && bad.assetId === null);
  }
  const many = bulkAdvance(bulkStart(0), ok([], Array.from({ length: 250 }, (_, i) => `f${i}`), 0));
  check("A21 bulk: the skip list never exceeds the route's cap", bulkSkip(many).length === BULK_SKIP_MAX && BULK_SKIP_MAX === 200);
}

/* ═════════════════════════════════════════════════════════════════════════ */
section("B. MARKUP (server render, the real dictionary)");

function render<P extends object>(el: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(I18nProvider, { locale: "pl", dict: live.pl, children: createElement(el, props) }));
}
const noop = () => {};
{
  const chip = render(TrialLockChip, { trial: locked(3), onUnlock: noop });
  check("B1 chip: a button bottom-right of the card, glass like the rail, a lock, label + days for the name",
    /data-trial-chip/.test(chip) && /absolute bottom-2 left-2 right-\[3\.25rem\]/.test(chip) && /justify-end/.test(chip)
    && /bg-black\/45/.test(chip) && /backdrop-blur-md/.test(chip) && /border-white\/15/.test(chip) && /lucide-lock/.test(chip)
    && chip.includes(`aria-label="${pl("genv3.wm.unlock")} · ${pl("genv3.wm.daysShort", { n: 3 })}"`), chip);
  check("B2 chip: the strip ignores the pointer (the picture still opens), the button takes it",
    /pointer-events-none absolute bottom-2/.test(chip) && /pointer-events-auto/.test(chip));
  check("B2b chip: its strip ends LEFT of the rail column (right-2 + 38 px rail + a gap = 3.25rem), so a short card's rail never covers it",
    /right-\[3\.25rem\]/.test(chip) && !/inset-x-2/.test(chip));
  check("B3 chip: label and days collapse by CARD width (size container), never by viewport",
    /\[container-type:inline-size\]/.test(chip) && /\[@container\(min-width:13rem\)\]:inline/.test(chip)
    && /\[@container\(min-width:5\.5rem\)\]:inline/.test(chip));
  check("B4 chip and row lock render nothing for an unlocked, expired or ordinary image",
    render(TrialLockChip, { trial: { state: "unlocked", expiresAt: null, daysLeft: null }, onUnlock: noop }) === ""
    && render(TrialLockChip, { trial: { state: "expired", expiresAt: null, daysLeft: null }, onUnlock: noop }) === ""
    && render(TrialLockChip, { trial: null, onUnlock: noop }) === ""
    && render(TrialLockButton, { trial: undefined, onUnlock: noop }) === "");
  const row = render(TrialLockButton, { trial: locked(1), onUnlock: noop, className: "h-9 w-9" });
  check("B5 row lock: a sized button, named with the singular day", /data-trial-row-lock/.test(row) && /h-9 w-9/.test(row)
    && row.includes(`${pl("genv3.wm.unlock")} · ${pl("genv3.wm.daysShortOne")}`));
}
{
  const plate = render(TrialNotice, { trial: locked(5, iso(Date.now() + 5 * DAY - 1000)), onUnlock: noop });
  check("B6 lightbox plate (locked): lock, \"dostępna jeszcze 5 dni\", the \"Usuń znak wodny\" CTA",
    /data-trial-notice="locked"/.test(plate) && plate.includes(pl("genv3.wm.available", { n: 5 }))
    && /data-trial-unlock/.test(plate) && plate.includes(`${pl("genv3.wm.unlock")}</button>`) && /lucide-lock/.test(plate), plate);
  const urgent = render(TrialNotice, { trial: locked(1, iso(Date.now() + 3_600_000)), onUnlock: noop });
  check("B7 lightbox plate under 24 h: the singular line in the warning tone",
    urgent.includes(pl("genv3.wm.availableOne")) && /warning/.test(urgent));
  const gone = render(TrialNotice, { trial: { state: "expired", expiresAt: null, daysLeft: null }, onUnlock: noop });
  const na = render(TrialNotice, { trial: { state: "unavailable", expiresAt: null, daysLeft: null }, onUnlock: noop });
  check("B8 lightbox plate (expired / unavailable): one muted line, no button, no promise",
    gone.includes(pl("genv3.wm.expired")) && !/<button/.test(gone) && na.includes(pl("genv3.wm.unavailable")) && !/<button/.test(na)
    && /text-faint/.test(gone));
  check("B9 lightbox plate: nothing for an ordinary or unlocked image; no CTA when the surface offers no unlock",
    render(TrialNotice, { trial: null }) === "" && render(TrialNotice, { trial: { state: "unlocked", expiresAt: null, daysLeft: null } }) === ""
    && !/<button/.test(render(TrialNotice, { trial: locked(2) })));
  const hint = render(TrialMarkedHint, { trial: locked(2), onUnlock: noop, lockedKey: "genv3.wm.editLocked", goneKey: "genv3.wm.editGone" });
  const hintGone = render(TrialMarkedHint, { trial: { state: "expired", expiresAt: null, daysLeft: null }, onUnlock: noop, lockedKey: "genv3.wm.editLocked", goneKey: "genv3.wm.editGone" });
  check("B10 R5 hint: locked → \"Najpierw usuń znak wodny…\" with the lock CTA; expired → the reason, no CTA",
    hint.includes(pl("genv3.wm.editLocked")) && /data-trial-hint-unlock/.test(hint)
    && hintGone.includes(pl("genv3.wm.editGone")) && !/<button/.test(hintGone));
}
{
  const base = { preview: "data:image/png;base64,AAA", paywallId: "p1", assetId: "a1", daysLeft: 12, expiresAt: null, plans: PLANS, hasLiveSubscription: false, pending: false, onCheckAgain: noop };
  const pw = render(TrialPaywall, base);
  const order = [...pw.matchAll(/data-trial-plan="([a-z]+)"/g)].map((m) => m[1]).join(",");
  check("B11 paywall: the watermarked preview, the brief's heading and sentence, verbatim",
    pw.includes('src="data:image/png;base64,AAA"') && pw.includes(`>${pl("genv3.wm.paywallTitle")}</h2>`)
    && pw.includes(`>${pl("genv3.wm.paywallBody")}</p>`));
  check("B12 paywall: Starter / PRO / Business cards in the /plany order, PRO highlighted, Agency named Business",
    order === "starter,pro,agency" && /data-trial-plan="pro" data-highlighted="true"/.test(pw)
    && count(pw, "data-highlighted") === 1 && pw.includes(`>${pl("plans.tier.business")}<`), order);
  check("B13 paywall: prices and credits from the rows (formatted the cennik way), \"Wybierz plan\" on every card",
    /49\s*zł/.test(pw) && /99\s*zł/.test(pw) && /249\s*zł/.test(pw) && pw.includes(pl("genv3.wm.creditsMonthly", { n: formatCount(1000) }))
    && count(pw, "data-trial-choose=") === 3 && count(pw, `>${pl("genv3.wm.choosePlan")}</button>`) === 3);
  check("B14 paywall: the days left line", pw.includes(pl("genv3.wm.available", { n: 12 })) && !/data-trial-last-day/.test(pw));
  const last = render(TrialPaywall, { ...base, daysLeft: 1 });
  check("B15 paywall under 24 h: \"1 dzień\" and the warning", last.includes(pl("genv3.wm.availableOne")) && /data-trial-last-day/.test(last));
  const pending = render(TrialPaywall, { ...base, pending: true });
  check("B16 paywall while a purchase is pending: the waiting text and \"Sprawdź ponownie\" INSTEAD of plan buttons",
    !/data-trial-choose/.test(pending) && /data-trial-pending/.test(pending) && pending.includes(pl("genv3.wm.pendingTitle"))
    && /data-trial-check-again/.test(pending));
  const inactive = render(TrialPaywall, { ...base, hasLiveSubscription: true });
  check("B17 paywall with a subscription that is not active: \"Zarządzaj subskrypcją\" → /settings?tab=subscriptions, no plan buttons",
    !/data-trial-choose/.test(inactive) && /href="\/settings\?tab=subscriptions"[^>]*data-trial-manage/.test(inactive)
    && inactive.includes(pl("genv3.wm.manage")));
  const none = render(TrialPaywall, { ...base, plans: [] });
  check("B18 paywall with no plans to show: one honest link to the cennik", /href="\/plan#plany"[^>]*data-trial-see-plans/.test(none));
  const featured = render(TrialPaywall, { ...base, plans: [plan("starter", { featured: true }), plan("pro"), plan("agency")] });
  check("B19 paywall: a plan the catalogue features is the highlighted one", /data-trial-plan="starter" data-highlighted="true"/.test(featured)
    && count(featured, "data-highlighted") === 1);
  const feats = render(TrialPaywall, { ...base, plans: [plan("starter", { capabilities: ["noExpiry", "allTools", "unknownKey"] }), plan("pro", { capabilities: ["noExpiry", "topups", "allTools"] }), plan("agency")] });
  check("B20 paywall: each card lists what the plan includes today, in /plany's own labels (an unknown key is skipped)",
    count(feats, "data-trial-plan-features") === 2 && feats.includes(pl("pricing.feat.noExpiry")) && feats.includes(pl("pricing.feat.allTools"))
    && feats.includes(pl("pricing.feat.topups")) && !feats.includes("unknownKey"));
  check("B21 paywall: every \"Wybierz plan\" names its plan for a screen reader",
    count(feats, `aria-label="${pl("genv3.wm.choosePlan")} — `) === 3 && feats.includes(`aria-label="${pl("genv3.wm.choosePlan")} — ${pl("plans.tier.business")}"`));
}

/* ═════════════════════════════════════════════════════════════════════════ */
section("C. THE SURFACES");

const gallery = code("components/genv3/gallery.tsx");
const galleryRaw = read("components/genv3/gallery.tsx");
const details = code("components/genv3/image-details.tsx");
const detailsRaw = read("components/genv3/image-details.tsx");
const regen = code("components/genv3/regenerate.tsx");
const library = code("components/library/library-browser.tsx");
const types = code("components/genv3/types.ts");

check("C1 types.ts: GalleryItem.trial?: GalleryTrial | null (and the server's previewUrl/hasThumb, optional)",
  /trial\?: GalleryTrial \| null;/.test(types) && /previewUrl\?: string;/.test(types) && /hasThumb\?: boolean;/.test(types)
  && /import type \{ GalleryTrial \} from "@\/lib\/trial-watermark\/types";/.test(types));
{
  const card = gallery.slice(gallery.indexOf("function GalleryCard("), gallery.indexOf("function CardAction("));
  const rail = card.slice(card.indexOf("card-rail"), card.indexOf("</div>", card.indexOf("card-rail")));
  // Ulubione V2 took the heart out of the rail into its own corner button
  // (FavoriteButton, the same one every gallery uses): the rail keeps its
  // other 3 actions, and the lock chip is still outside it.
  check("C2 gallery card: the chip is mounted outside the rail, hidden while picking; the rail keeps its 3 actions, the heart its own button",
    /\{!selecting && <TrialLockChip trial=\{item\.trial\} onUnlock=\{onUnlock\} \/>\}/.test(card) && !rail.includes("TrialLock")
    && count(rail, /key: "(regen|dl|del)"/g) === 3 && count(rail, /key: "/g) === 3 && !/Lock/.test(rail)
    && /<FavoriteButton active=\{item\.favorite\} onToggle=\{onFavorite\}/.test(card));
  check("C3 gallery: an ASSET-keyed patch beside the generation-keyed one, applied to items, fresh items and the open retake",
    /function mutateAsset\(assetId: string, patch: Partial<GalleryItem>\)/.test(gallery)
    && /i\.assetId === assetId \? \{ \.\.\.i, \.\.\.patch \} : i/.test(gallery)
    && /setItems\(map\);\s*onFresh\(map\);\s*\/\/[^\n]*\n?\s*setRegenItem/.test(galleryRaw.replace(/\r/g, ""))
    && /useTrialUnlock\(\{ onUnlocked: \(assetId, patch\) => mutateAsset\(assetId, patch\) \}\)/.test(gallery));
  const rowLock = gallery.indexOf("<TrialLockButton"); const heart = gallery.indexOf("data-row-favorite");
  check("C4 gallery list row: the lock button sits right before the heart; the meta line carries the days",
    rowLock > 0 && heart > rowLock && heart - rowLock < 300 && /<RowTrialDays item=\{item\} \/>/.test(gallery));
  check("C5 gallery: lightbox + retake get the unlock, and the dialog is rendered once",
    /onUnlock=\{\(item\) => trialUnlock\.start\(item, "lightbox"\)\}/.test(gallery)
    && /onUnlock=\{\(item\) => trialUnlock\.start\(item, "gallery"\)\}/.test(gallery) && count(gallery, "{trialUnlock.dialog}") === 1);
  check("C6 gallery keeps the literals other suites pin (H3–H6b, fashion:588, ratio)",
    !galleryRaw.includes("aspect-square") && /useRatioGrid\(/.test(gallery) && /grid\.itemStyle\(assetAspect\(item\)\)/.test(gallery)
    && /guideTool \?\? \(operation \? guideToolForOperation\(operation\) : guideToolForPath\(pathname\)\)/.test(gallery)
    && gallery.includes("{guide.button}") && gallery.includes("{guide.dialog}") && count(gallery, /<StarterGallery/g) === 1
    && !gallery.includes("fillEmpty") && !/h-1[14] w-1[14][^"]*object-cover/.test(galleryRaw) && galleryRaw.includes("@/lib/save-image"));
}
{
  check("C7 lightbox: the pinned ResultFeedback literal, the save-image import and exactly four edit tiles survive",
    /item\.operation !== "image_retouch" && <ResultFeedback/.test(detailsRaw) && detailsRaw.includes("@/lib/save-image")
    && count(details, /<EditTile /g) === 4 && count(details, "data-edit-tile") === 1);
  check("C8 R5 lightbox: runTool refuses a marked file before any fetch; the three paid tiles are disabled; the ratio picker cannot open",
    /async function runTool\([^)]*\) \{\s*if \(toolBusy \|\| marked\) return;/.test(details)
    && count(details, /disabled=\{marked\}/g) === 3 && /\{expandPick && !marked && \(/.test(details)
    && /const marked = isMarked\(item\.trial\);/.test(details));
  check("C9 R5 lightbox: the reason and the lock CTA under the tiles, in place of the editNote line",
    /marked \? \([\s\S]{0,200}<TrialMarkedHint trial=\{item\.trial\} onUnlock=\{unlock\} lockedKey="genv3\.wm\.editLocked" goneKey="genv3\.wm\.editGone" \/>/.test(details)
    && details.includes('t("genv3.editNote")'));
  const plate = details.indexOf("<TrialNotice"); const akcje = details.indexOf('grid grid-cols-3 gap-2');
  const tiles = details.lastIndexOf("<EditTile icon={Wand2}");
  check("C10 lightbox: the plate sits above the AKCJE grid (and below the tiles), never inside it",
    plate > tiles && akcje > plate && !details.slice(akcje, akcje + 2000).includes("TrialNotice"));
  check("C11 D1: a refused paid tool says so in the shared studio.err words and points at the plans",
    /code === "trial_tool_unavailable"\) setToolsNeedPlan\(true\)/.test(details) && details.includes('t("studio.err.trial_tool_unavailable")')
    && details.includes('t("studio.err.trial_check_failed")') && /href="\/plan#plany"/.test(details));
}
{
  check("C12 R5 retake: the marking canvas is not mounted for a marked image and no marked copy can be uploaded",
    /\{!marked && \(\s*<AnnotationCanvas/.test(regen) && /if \(shapes\.length > 0 && !marked\) \{/.test(regen)
    && /\{showNib && !marked && \(/.test(regen) && /const marked = isMarked\(item\.trial\);/.test(regen));
  check("C13 R5 retake: pen, tools, undo/reset off; the hint with the lock CTA; plain regenerate unchanged",
    count(regen, /disabled=\{marked/g) >= 6 && /<TrialMarkedHint trial=\{item\.trial\}[\s\S]{0,120}lockedKey="genv3\.wm\.regenLocked" goneKey="genv3\.wm\.regenGone"/.test(regen)
    && /disabled=\{busy \|\| notEnough \|\| !chosen\} onClick=\{run\} data-regen-run/.test(regen));
}
{
  check("C14 library: trialLocked / unlockAssetId are optional with safe defaults (harnesses that pass neither still compile)",
    /export function LibraryBrowser\(\{ first, locale, trialLocked = 0, unlockAssetId = null, /.test(library)
    && /trialLocked\?: number;/.test(library) && /unlockAssetId\?: string \| null;/.test(library));
  check("C15 library toolbar: \"Usuń znak wodny ze wszystkich ({n})\" only while something is locked, on the photo shelf",
    /\{shelf === "image" && lockedLeft > 0 && \(/.test(library) && /t\("genv3\.wm\.bulkCta", \{ n: lockedLeft \}\)/.test(library)
    && /data-trial-unlock-all/.test(library));
  check("C16 library ?unlock=: guarded (nothing runs without the parameter), opens ONCE in the confirming mode, drops the parameter",
    /if \(!unlockAssetId \|\| unlockOpened\.current\) return;/.test(library)
    && /trialUnlock\.start\(known \?\? \{ assetId: unlockAssetId \}, "checkout_return", \{ confirming: true \}\)/.test(library)
    && /searchParams\.delete\("unlock"\)/.test(library) && /window\.history\.replaceState/.test(library));
  check("C17 library: tile chip, row lock before the heart, days in the row, lightbox unlock; patches by asset (setItems; the hooks patch the cache)",
    /<TrialLockChip trial=\{item\.trial\} onUnlock=\{onUnlock\} \/>/.test(library)
    && library.indexOf("<TrialLockButton") < library.indexOf("onClick={onFavorite} aria-pressed={item.favorite}", library.indexOf("function Row("))
    && library.indexOf("<TrialLockButton") > library.indexOf("function Row(")
    && /setItems\(\(list\) => patchAsset\(list, assetId, patch\)\)/.test(library)
    && /trialUnlock\.start\(full \?\? g, "lightbox"\)/.test(library) && count(library, "{trialUnlock.dialog}") === 1 && count(library, "{trialBulk.dialog}") === 1);
  const fetches = count(library, /\bfetch\(/g);
  check("C18 library: no new request of its own (5 as before: page, more, thumb, delete, zip) — the trial calls live in the dialogs",
    fetches === 5, `found ${fetches}`);
  check("C19 library keeps the ratio grid and the save-image helper",
    library.includes("useRatioGrid") && library.includes("assetAspect") && read("components/library/library-browser.tsx").includes("@/lib/save-image")
    && !read("components/library/library-browser.tsx").includes("aspect-square"));
}

/* ═════════════════════════════════════════════════════════════════════════ */
section("D. THE DIALOGS");

const WM_DIR = "components/trial-watermark";
const wmFiles = readdirSync(WM_DIR).filter((f) => /\.tsx?$/.test(f)).map((f) => join(WM_DIR, f));
const shell = code(`${WM_DIR}/shell.tsx`);
const dialog = code(`${WM_DIR}/unlock-dialog.tsx`);
const bulk = code(`${WM_DIR}/bulk-dialog.tsx`);
const paywall = code(`${WM_DIR}/paywall.tsx`);
check("D1 shell: portalled to <body> at z-[75] (above the lightbox and retake at z-[60])",
  /createPortal\(/.test(shell) && /document\.body,?\s*\)/.test(shell) && /fixed inset-0 z-\[75\]/.test(shell)
  && /z-\[60\]/.test(read("components/genv3/image-details.tsx")) && /z-\[60\]/.test(read("components/genv3/regenerate.tsx")));
check("D2 shell: Escape in the CAPTURE phase, stopped there (the lightbox's own Escape never fires); arrows held back too",
  /window\.addEventListener\("keydown", onKey, true\)/.test(shell) && /window\.removeEventListener\("keydown", onKey, true\)/.test(shell)
  && /e\.stopPropagation\(\);/.test(shell) && /ArrowLeft/.test(shell));
check("D3 shell: the PREVIOUS body overflow is restored (never reset to \"\"), focus in/back via useDialogFocus, Tab kept inside",
  /const previous = document\.body\.style\.overflow;/.test(shell) && /document\.body\.style\.overflow = previous;/.test(shell)
  && !/style\.overflow = ""/.test(shell) && /useDialogFocus\(true, panel\)/.test(shell) && /e\.key !== "Tab"/.test(shell));
check("D4 shell: an unlock in flight cannot be closed (button, scrim and Escape)",
  /disabled=\{locked\}/.test(shell) && /!locked && onClose\(\)/.test(shell) && /!live\.current\.locked/.test(shell)
  && /locked=\{stage\.kind === "unlocking"\}/.test(dialog));
check("D5 dialog: checking → trialPaywallAction; entitled → unlock; paywall → the plans; not locked → expired/unavailable or fresh links",
  /trialPaywallAction\(\{ assetId, surface \}\)/.test(dialog) && /res\.kind === "entitled"\) \{ await unlock\(true\)/.test(dialog)
  && /res\.state === "unlocked"\) \{ await unlock\(false\)/.test(dialog));
check("D6 dialog: the post-checkout wait polls GET status with the backoff, unlocks once entitled, says \"still processing\" after the budget",
  /fetchTrialStatus\(assetId\)/.test(dialog) && /nextConfirmDelay\(attempt, Date\.now\(\) - started\)/.test(dialog)
  && /if \(s\.entitled\) \{ await unlock\(true\)/.test(dialog) && /timedOut: true/.test(dialog));
check("D7 dialog: an unlock is reported (cache + surface) even if the dialog closed meanwhile",
  /report\.current\(assetId, unlockedPatch\(r\), \{ wasLocked \}\);\s*if \(!alive\.current\) return;/.test(dialog)
  && /patchLibrary\(\(list\) => patchAsset\(list, assetId, patch\)\)/.test(dialog) && /patchLibrary\(\(list\) => patchAsset\(list, assetId, patch\)\)/.test(bulk));
check("D8 dialog: \"Pobierz\" uses saveImageFrom(downloadUrl) and refreshes the link through status from TTL − 5 s",
  /needsFreshLink\(url, stage\.receivedAt\)/.test(dialog) && /saveImageFrom\(url, /.test(dialog) && /from "@\/lib\/save-image"/.test(dialog));
check("D9 bulk: loops unlock-all with the bulk id and the skip list, stops on done / no progress / stop; retries failed",
  /postTrialUnlockAll\(p\.bulkId, bulkSkip\(p\)\)/.test(bulk) && /!bulkContinues\(p\) \|\| stop\.current/.test(bulk)
  && /data-trial-bulk-retry/.test(bulk) && /genv3\.wm\.bulkProgress", \{ x: progress\.unlocked, y: progress\.total \}/.test(bulk)
  && /surface: "library_bulk"/.test(bulk));
check("D10 paywall: \"Wybierz plan\" → trialPlanSelectedAction → the returned in-app href; not payable → /plan#plany",
  /trialPlanSelectedAction\(\{ paywallId, assetId, planId: plan\.id \}\)/.test(paywall) && /safeHref\(res\.href\)/.test(paywall)
  && /router\.push\("\/plan#plany"\)/.test(paywall) && /const buttons = !pending && !hasLiveSubscription;/.test(paywall));
check("D3b shell: on close the page is given back only while the lock is still OURS — a navigation that unmounted the lightbox first (it restored the page) leaves it scrollable",
  /if \(document\.body\.style\.overflow === "hidden"\) document\.body\.style\.overflow = previous;/.test(shell));
check("D3c shell: when the control that opened it is gone (an unlock removed the chip), focus goes back into the view it sat in",
  /opener\?\.closest<HTMLElement>\('\[role="dialog"\]'\) \?\? opener\?\.parentElement/.test(shell) && /if \(!home\?\.isConnected \|\| opener\?\.isConnected\) return;/.test(shell));
check("D9b bulk: an image committed but unsigned gets fresh links from the single unlock; one that can never be unlocked shows so on its card",
  /f\.reason === "sign_failed"/.test(bulk) && /postTrialUnlock\(f\.assetId, "library_bulk"\)/.test(bulk) && /bulkResolved\(p, f\.assetId\)/.test(bulk)
  && /BULK_FINAL_REASONS\.has\(f\.reason\)/.test(bulk) && /report\.current\.onUnlocked\(f\.assetId, \{ trial \}\)/.test(bulk));
check("D9c bulk: \"Ponów nieudane\" counts from what can still be unlocked; \"Sprawdź ponownie\" reads the status, never reopens a paywall",
  /run\(null, retriable\)/.test(bulk) && /const recheck = useCallback/.test(bulk) && /onCheckAgain=\{\(\) => void recheck\(\)\}/.test(bulk)
  && !/onCheckAgain=\{\(\) => void check/.test(bulk));
check("D9d bulk: with no locked image on screen the paywall is shown for one the server names",
  /!target && r\.assetId/.test(bulk) && /checkRef\.current\(tg\)/.test(bulk));
check("D6b dialog: after the wait, with no plan payment pending, the offer itself — never a false \"still processing\"",
  /if \(pending === false\) \{ await checkRef\.current\(\); return; \}/.test(dialog));
{
  const one = (l: string) => (live as Record<string, Record<string, unknown>>)[l];
  const tw = (l: string) => ((one(l).admin as Record<string, unknown>).trialWm as Record<string, unknown>);
  const ok1 = LOCALES.every((l) => {
    const t = tw(l);
    return typeof t.confirmBodyOne === "string" && typeof (t.policy as Record<string, unknown>).keepOne === "string"
      && typeof (t.stats as Record<string, unknown>).titleOne === "string" && !/\{days\}/.test(t.confirmBodyOne as string);
  });
  check("D12 admin: a 1-day retention reads \"1 dzień / 1 day / 1 Tag\" (own keys in PL, EN, DE)",
    ok1 && (tw("pl").confirmBodyOne as string).includes("1 dzień") && (tw("en").confirmBodyOne as string).includes("1 day")
    && (tw("de").confirmBodyOne as string).includes("1 Tag")
    && /days === 1 \? "admin\.trialWm\.confirmBodyOne"/.test(read("components/admin/trial-watermark-settings.tsx")));
}
check("D11 paywall: no hard-coded prices — money and counts only through the cennik formatters",
  /formatMoney\(plan\.priceCents, plan\.currency\)/.test(paywall) && !/\d\s*zł/.test(paywall) && !/PLN/.test(paywall));
{
  const all = wmFiles.map((f) => [f, code(f)] as const);
  const bad = all.filter(([, s]) => /:\s*any\b|as any\b|@ts-ignore|@ts-nocheck|@ts-expect-error/.test(s)).map(([f]) => f);
  check("D12 no any / ts-ignore in components/trial-watermark", bad.length === 0, bad.join(", "));
  const saves = all.filter(([, s]) => /<a[^>]*download|window\.open\(|location\.href\s*=|\.download\s*=/.test(s)).map(([f]) => f);
  check("D13 no download anchor, window.open or location.href — every save goes through lib/save-image", saves.length === 0, saves.join(", "));
  const literals = all.flatMap(([f, s]) => [...s.matchAll(/(?<![\w.])t\("([^"]+)"/g)].map((m) => [f, m[1]] as const));
  // Text between a tag and a closing tag that is not an expression.
  const strays = all.filter(([, s]) => />\s*[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}[^<>{}=]*<\//.test(s)).map(([f]) => f);
  check("D14 no hard-coded user-facing text in the dialogs' markup (all through t())", strays.length === 0 && literals.length > 30, strays.join(", "));
}

/* ═════════════════════════════════════════════════════════════════════════ */
section("E. I18N");

{
  const files = [...wmFiles, "components/genv3/gallery.tsx", "components/genv3/image-details.tsx", "components/genv3/regenerate.tsx", "components/library/library-browser.tsx"];
  const keys = new Set<string>();
  for (const f of files) for (const m of code(f).matchAll(/"((?:genv3\.wm|studio\.err)\.[A-Za-z_.]+)"/g)) keys.add(m[1]);
  const missingDict: string[] = []; const missingLive: string[] = [];
  for (const k of keys) for (const l of LOCALES) {
    if (typeof lookup(dicts[l], k) !== "string") missingDict.push(`${l}:${k}`);
    if (typeof lookup(live[l], k) !== "string") missingLive.push(`${l}:${k}`);
  }
  check(`E1 every genv3.wm.* / studio.err.* key the UI names exists in pl/en/de${extra ? " (with the scratch overlay)" : ""} — ${keys.size} keys`,
    missingLive.length === 0, missingLive.slice(0, 12).join(", "));
  if (missingDict.length > 0) {
    const reason = `${missingDict.length} key/locale pairs not merged into lib/i18n/dictionaries yet`;
    if (extra) skip("E2 …and in the committed dictionaries", reason); else check("E2 …and in the committed dictionaries", false, missingDict.slice(0, 12).join(", "));
  } else check("E2 …and in the committed dictionaries", true);
}
check("E3 the brief's Polish, verbatim",
  pl("genv3.wm.paywallTitle") === "Odblokuj zdjęcie bez znaku wodnego"
  && pl("genv3.wm.paywallBody") === "Pobierz to zdjęcie bez znaku wodnego z dowolnym planem"
  && pl("genv3.wm.unlock") === "Usuń znak wodny" && pl("genv3.wm.choosePlan") === "Wybierz plan"
  && pl("genv3.wm.manage") === "Zarządzaj subskrypcją"
  && pl("genv3.wm.available", { n: 7 }) === "Wersja bez znaku wodnego dostępna jeszcze 7 dni"
  && pl("genv3.wm.availableOne") === "Wersja bez znaku wodnego dostępna jeszcze 1 dzień"
  && pl("genv3.wm.bulkCta", { n: 4 }) === "Usuń znak wodny ze wszystkich (4)"
  && pl("genv3.wm.bulkProgress", { x: 2, y: 5 }) === "Odblokowano 2 z 5");
{
  const placeholders = (s: unknown) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const drift: string[] = [];
  for (const k of Object.keys(extra?.pl ?? {})) {
    const p = placeholders(lookup(live.pl, k));
    for (const l of ["en", "de"] as const) if (placeholders(lookup(live[l], k)) !== p) drift.push(`${l}:${k}`);
  }
  check("E4 the same {placeholders} in every locale", drift.length === 0, drift.join(", "));
}
{
  const scopes = read("lib/i18n/scopes.ts");
  const from = scopes.indexOf("const app = [");
  const appList = from < 0 ? "" : scopes.slice(from, scopes.indexOf("] as const", from));
  check("E5 genv3 (and plans / pricing / studio, used through keys) are in the app scope — no scope regeneration needed",
    ["genv3", "plans", "pricing", "studio"].every((ns) => appList.includes(`"${ns}",`)));
}

/* ═════════════════════════════════════════════════════════════════════════ */
section("F. IN A REAL BROWSER");

const CHROME = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";
if (!existsSync(CHROME)) {
  skip("F1–F14 the dialogs in Chromium", `no browser at ${CHROME}`);
} else {
  await browserFlows(check, live.pl, pl);
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(failed === 0 ? 0 : 1);
}

/* ── F: the harness ─────────────────────────────────────────────────────── */

type Check = (name: string, ok: boolean, detail?: string) => void;
type Reply = { status?: number; body: unknown; hold?: Promise<void> };

async function browserFlows(check: Check, dict: Record<string, unknown>, pl: (k: string, v?: Record<string, string | number>) => string) {
  // Loaded only here: neither belongs in the node bundle (see the npm script).
  const esbuild = await import("esbuild");
  const { chromium } = await import("playwright");

  // The dialogs on their own, plus the REAL lightbox and retake editor wired
  // the way the gallery wires them (an unlock patches the item they show).
  const entry = `
    import { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { I18nProvider } from "@/lib/i18n/provider";
    import { useTrialUnlock } from "@/components/trial-watermark/unlock-dialog";
    import { useTrialBulkUnlock } from "@/components/trial-watermark/bulk-dialog";
    import { patchAsset } from "@/components/trial-watermark/model";
    import { ImageDetails } from "@/components/genv3/image-details";
    import { RegenerateModal } from "@/components/genv3/regenerate";
    import type { GalleryItem, GenModel } from "@/components/genv3/types";
    const w = (window as unknown as { __wm: Record<string, unknown> }).__wm;
    function App() {
      const [details, setDetails] = useState<GalleryItem[] | null>(null);
      const [regen, setRegen] = useState<{ item: GalleryItem; models: GenModel[] } | null>(null);
      const one = useTrialUnlock({ onUnlocked: (assetId, patch, info) => {
        (w.unlocked as unknown[]).push({ assetId, patch, info });
        setDetails((list) => list && patchAsset(list, assetId, patch));
      } });
      const many = useTrialBulkUnlock({
        onUnlocked: (assetId) => { (w.bulkUnlocked as string[]).push(assetId); },
        onSettled: (n) => { (w.settled as number[]).push(n); },
      });
      w.start = one.start;
      w.startBulk = many.start;
      w.showDetails = setDetails;
      w.showRegen = setRegen;
      const none = () => {};
      return <>
        {details && <ImageDetails items={details} index={0} onIndex={none} canRegenerate onRegenerate={none}
          onClose={() => { w.detailsCloses = (w.detailsCloses as number) + 1; setDetails(null); }}
          onFavorite={none} onDelete={none} onNote={none} onUnlock={(item) => one.start(item, "lightbox")} />}
        {regen && <RegenerateModal item={regen.item} models={regen.models} balance={100} onClose={() => setRegen(null)}
          onDone={none} onUnlock={(item) => one.start(item, "gallery")} />}
        {one.dialog}{many.dialog}
      </>;
    }
    createRoot(document.getElementById("root")!).render(
      <I18nProvider locale="pl" dict={w.dict as Record<string, unknown>}><App /></I18nProvider>,
    );
  `;
  const built = await esbuild.build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx", sourcefile: "trialwm-ui-harness.tsx" },
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    // The Supabase config reads NEXT_PUBLIC_* at import; nothing here calls it.
    banner: { js: 'var process = { env: { NODE_ENV: "production" } };' },
    alias: {
      "@/app/actions/trial-watermark": "./scripts/stubs/trialwm-ui-stubs.ts",
      "next/navigation": "./scripts/stubs/trialwm-ui-stubs.ts",
      "next/link": "./scripts/stubs/next-link.tsx",
      "@": ".",
    },
  });
  const appJs = built.outputFiles[0].text;

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
  const ORIGIN = "http://wm.test";
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const queues: Record<string, Reply[]> = { status: [], unlock: [], "unlock-all": [] };
  const bodies: Record<string, unknown[]> = { status: [], unlock: [], "unlock-all": [] };
  const downloads: string[] = [];

  async function fresh() {
    for (const k of Object.keys(queues)) { queues[k] = []; bodies[k] = []; }
    downloads.length = 0;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") {
        return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="overflow:hidden"><div id="root"></div>
          <script>window.__wm = { dict: ${JSON.stringify(dict)}, calls: [], pushed: [], paywallReplies: [], planReply: { ok: false, error: "failed" },
            unlocked: [], bulkUnlocked: [], settled: [], parentEscapes: 0, detailsCloses: 0 };
          window.addEventListener("keydown", (e) => { if (e.key === "Escape") window.__wm.parentEscapes++; });</script>
          <script src="/app.js"></script></body></html>` });
      }
      if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: appJs });
      if (url.pathname.startsWith("/dl/")) { downloads.push(url.pathname); return route.fulfill({ contentType: "image/png", body: PNG }); }
      const m = /^\/api\/trial-originals\/(status|unlock|unlock-all)$/.exec(url.pathname);
      if (m) {
        const key = m[1];
        bodies[key].push(key === "status" ? Object.fromEntries(url.searchParams) : route.request().postDataJSON());
        const next = queues[key].shift();
        if (!next) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ state: "error", error: "no_reply" }) });
        if (next.hold) await next.hold;
        return route.fulfill({ status: next.status ?? 200, contentType: "application/json", body: JSON.stringify(next.body) });
      }
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => typeof (window as unknown as { __wm: { start?: unknown } }).__wm.start === "function", null, { timeout: 10_000 })
      .catch((e: Error) => { throw new Error(`harness did not boot: ${errors.join(" | ") || e.message}`); });
    return page;
  }
  type Page = Awaited<ReturnType<typeof fresh>>;
  const wm = <R,>(page: Page, fn: string) => page.evaluate(`window.__wm.${fn}`) as Promise<R>;
  const setReplies = (page: Page, paywall: TrialPaywallResult[], planReply?: unknown) =>
    page.evaluate(([p, r]) => {
      const w = (window as unknown as { __wm: { paywallReplies: unknown[]; planReply: unknown } }).__wm;
      w.paywallReplies.push(...(p as unknown[]));
      if (r) w.planReply = r;
    }, [paywall, planReply ?? null] as const);
  const start = (page: Page, target: unknown, surface: string, opts?: unknown) =>
    page.evaluate(([tg, s, o]) => {
      (window as unknown as { __wm: { start: (a: unknown, b: unknown, c: unknown) => void } }).__wm.start(tg, s, o);
    }, [target, surface, opts ?? null] as const);
  const text = (page: Page, sel: string) => page.locator(sel).first().innerText({ timeout: 8000 }).catch(() => "");
  const PREVIEW = `data:image/png;base64,${PNG.toString("base64")}`;
  const target = { assetId: "11111111-1111-4111-8111-111111111111", previewUrl: PREVIEW, thumbUrl: PREVIEW, url: PREVIEW, product: "Kubek", trial: { state: "locked", expiresAt: null, daysLeft: 3 } };
  const unlockedReply = (downloadUrl: string) => ({
    state: "unlocked", assetId: target.assetId, path: "w/j/u-1.png", url: `${ORIGIN}/dl/clean.png`, thumbUrl: `${ORIGIN}/dl/clean_t.webp`,
    previewUrl: `${ORIGIN}/dl/clean_p.webp`, hasThumb: true, downloadUrl,
  });
  const farExp = Math.floor(Date.now() / 1000) + 3600;

  try {
    // F1–F3 · the paywall and choosing a plan
    {
      const page = await fresh();
      const plans = PLANS.map((p) => ({ ...p, id: `${p.slug}-id` }));
      await setReplies(page, [{ kind: "paywall", paywallId: "pw-1", daysLeft: 3, plans, hasLiveSubscription: false, pending: false }],
        { ok: true, href: "/checkout?kind=subscription&plan=pro-id&period=monthly" });
      await start(page, target, "gallery");
      await page.locator("[data-trial-paywall]").waitFor({ timeout: 8000 });
      const heading = await text(page, "[data-trial-paywall] h2");
      const z = await page.locator("[data-trial-dialog]").getAttribute("class");
      check("F1 browser: the paywall opens over everything (z-[75]) with the brief's heading and the watermarked preview",
        heading === pl("genv3.wm.paywallTitle") && /z-\[75\]/.test(z ?? "")
        && (await page.locator("[data-trial-paywall-preview]").getAttribute("src")) === PREVIEW
        && JSON.stringify((await wm<unknown[][]>(page, "calls"))[0]) === JSON.stringify(["paywall", { assetId: target.assetId, surface: "gallery" }]));
      await page.locator('[data-trial-choose="pro"]').click();
      await page.waitForFunction(() => (window as unknown as { __wm: { pushed: string[] } }).__wm.pushed.length > 0, null, { timeout: 5000 });
      const calls = await wm<unknown[][]>(page, "calls");
      check("F2 browser: \"Wybierz plan\" records the choice with the paywall id and goes to the returned checkout link",
        JSON.stringify(calls[1]) === JSON.stringify(["plan", { paywallId: "pw-1", assetId: target.assetId, planId: "pro-id" }])
        && (await wm<string[]>(page, "pushed"))[0] === "/checkout?kind=subscription&plan=pro-id&period=monthly");
      // Escape: the dialog closes, the page's own (bubble) Escape listener never hears it, and the
      // body keeps the overflow it had before the dialog.
      await page.keyboard.press("Escape");
      await page.locator("[data-trial-dialog]").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      check("F3 browser: Escape closes the dialog only — the lightbox underneath never sees it — and the previous overflow stays",
        (await page.locator("[data-trial-dialog]").count()) === 0 && (await wm<number>(page, "parentEscapes")) === 0
        && (await page.evaluate(() => document.body.style.overflow)) === "hidden");
      await page.close();
    }
    // F4–F6 · entitled → unlocking → success → download (fresh link), then a stale link refreshed via status
    {
      const page = await fresh();
      await setReplies(page, [{ kind: "entitled" }]);
      let release: () => void = () => {};
      const hold = new Promise<void>((r) => { release = r; });
      queues.unlock.push({ body: unlockedReply(`${ORIGIN}/dl/a.png?token=${jwt(farExp, Math.floor(Date.now() / 1000))}`), hold });
      await start(page, target, "lightbox");
      await page.locator('[data-trial-waiting="unlocking"]').waitFor({ timeout: 8000 });
      await page.keyboard.press("Escape");
      const stillOpen = (await page.locator("[data-trial-dialog]").count()) === 1;
      const closeDisabled = await page.locator(`[data-trial-dialog] button[aria-label="${pl("common.close")}"]`).isDisabled();
      release();
      await page.locator("[data-trial-success]").waitFor({ timeout: 8000 });
      check("F4 browser: while the unlock is in flight the dialog cannot be closed (Escape, X)", stillOpen && closeDisabled);
      const reported = await wm<{ assetId: string; patch: { path: string; url: string; trial: { state: string } }; info: { wasLocked: boolean } }[]>(page, "unlocked");
      check("F5 browser: success shows the CLEAN preview and hands the new links to the surface (wasLocked)",
        (await page.locator("[data-trial-clean]").getAttribute("src")) === `${ORIGIN}/dl/clean_p.webp`
        && reported.length === 1 && reported[0].patch.path === "w/j/u-1.png" && reported[0].patch.trial.state === "unlocked" && reported[0].info.wasLocked
        && JSON.stringify(bodies.unlock[0]) === JSON.stringify({ assetId: target.assetId, surface: "lightbox" }));
      await page.locator("[data-trial-download]").click();
      await page.waitForTimeout(400);
      check("F6 browser: \"Pobierz\" fetches the short-lived link itself (no status call while it is fresh)",
        downloads.includes("/dl/a.png") && bodies.status.length === 0, JSON.stringify({ downloads, status: bodies.status.length }));
      await page.close();
    }
    {
      const page = await fresh();
      await setReplies(page, [{ kind: "entitled" }]);
      // A link whose own lifetime is 3 s (exp − iat): inside the 5 s margin from the moment it arrives.
      queues.unlock.push({ body: unlockedReply(`${ORIGIN}/dl/old.png?token=${jwt(Math.floor(Date.now() / 1000) + 3, Math.floor(Date.now() / 1000))}`) });
      queues.status.push({ body: { state: "unlocked", daysLeft: null, entitled: true, pending: false, planSlug: "pro", thumbUrl: null, downloadUrl: `${ORIGIN}/dl/new.png` } });
      await start(page, target, "gallery");
      await page.locator("[data-trial-download]").click({ timeout: 8000 });
      await page.waitForTimeout(400);
      check("F7 browser: a link within 5 s of its expiry is replaced through GET status before the save",
        downloads.includes("/dl/new.png") && !downloads.includes("/dl/old.png") && bodies.status.length === 1);
      await page.close();
    }
    // F8 · not locked any more → the neutral line; a page that scrolled before scrolls after
    {
      const page = await fresh();
      await page.evaluate(() => { document.body.style.overflow = ""; });
      await setReplies(page, [{ kind: "not_locked", state: "expired" }]);
      await start(page, target, "library");
      await page.locator("[data-trial-expired]").waitFor({ timeout: 8000 });
      const body = await text(page, "[data-trial-expired] p");
      const whileOpen = await page.evaluate(() => document.body.style.overflow);
      check("F8 browser: an expired original gets the neutral line and nothing to buy",
        body === pl("genv3.wm.expired") && (await page.locator("[data-trial-choose]").count()) === 0 && bodies.unlock.length === 0);
      await page.locator("[data-trial-expired] button").click();
      await page.locator("[data-trial-dialog]").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      check("F8b browser: the page is locked while the dialog is open and gets its own overflow (\"\") back after",
        whileOpen === "hidden" && (await page.evaluate(() => document.body.style.overflow)) === "");
      await page.close();
    }
    // F9 · back from the checkout: wait, then unlock
    {
      const page = await fresh();
      queues.status.push({ body: { state: "locked", daysLeft: 3, entitled: false, pending: true, planSlug: null, thumbUrl: PREVIEW, downloadUrl: null } });
      queues.status.push({ body: { state: "locked", daysLeft: 3, entitled: true, pending: false, planSlug: "pro", thumbUrl: PREVIEW, downloadUrl: null } });
      queues.unlock.push({ body: unlockedReply(`${ORIGIN}/dl/a.png?token=${jwt(farExp)}`) });
      await start(page, { assetId: target.assetId }, "checkout_return", { confirming: true });
      await page.locator('[data-trial-waiting="confirming"]').waitFor({ timeout: 5000 });
      const waitingText = await text(page, '[data-trial-waiting="confirming"]');
      await page.locator("[data-trial-success]").waitFor({ timeout: 9000 });
      check("F9 browser: ?unlock= opens in the waiting state, asks status again after a pause, then unlocks with checkout_return",
        waitingText.includes(pl("genv3.wm.confirming")) && bodies.status.length === 2
        && JSON.stringify(bodies.status[0]) === JSON.stringify({ assetId: target.assetId })
        && JSON.stringify(bodies.unlock[0]) === JSON.stringify({ assetId: target.assetId, surface: "checkout_return" })
        && (await wm<unknown[]>(page, "calls")).length === 0);
      await page.close();
    }
    // F10 · an error and the retry
    {
      const page = await fresh();
      await setReplies(page, [{ kind: "entitled" }]);
      queues.unlock.push({ body: { state: "error", error: "stripe_unavailable" } });
      queues.unlock.push({ body: unlockedReply(`${ORIGIN}/dl/a.png?token=${jwt(farExp)}`) });
      await start(page, target, "gallery");
      await page.locator("[data-trial-error]").waitFor({ timeout: 8000 });
      const msg = await text(page, "[data-trial-error] p + p");
      await page.locator("[data-trial-retry]").click();
      await page.locator("[data-trial-success]").waitFor({ timeout: 8000 });
      check("F10 browser: a Stripe outage says so (nothing changed) and \"Spróbuj ponownie\" unlocks",
        msg === pl("genv3.wm.err.stripeUnavailable") && bodies.unlock.length === 2);
      await page.close();
    }
    // F11 · refused at unlock with a pending purchase → the waiting paywall
    {
      const page = await fresh();
      await setReplies(page, [{ kind: "entitled" }]);
      queues.unlock.push({ body: { state: "not_entitled", pending: true, hasLiveSubscription: false } });
      await start(page, target, "gallery");
      await page.locator("[data-trial-pending]").waitFor({ timeout: 8000 });
      check("F11 browser: an unlock refused while a purchase is pending shows the waiting state, no plan buttons",
        (await page.locator("[data-trial-choose]").count()) === 0 && (await page.locator("[data-trial-check-again]").count()) === 1);
      await page.close();
    }
    // F12–F14 · the bulk loop
    {
      const page = await fresh();
      await setReplies(page, [{ kind: "entitled" }]);
      const ok = (unlocked: string[], failedIds: string[], remaining: number, done = false) => ({
        state: "ok", bulkId: "22222222-2222-4222-8222-222222222222",
        unlocked: unlocked.map((assetId) => ({ assetId, path: `w/j/u-${assetId}.png`, url: "u", thumbUrl: "t", previewUrl: "v", hasThumb: true })),
        failed: failedIds.map((assetId) => ({ assetId, reason: "unlock_failed" })), remaining, done,
      });
      queues["unlock-all"].push({ body: ok(["a", "b"], ["c"], 3) }, { body: ok(["d"], [], 2) }, { body: ok([], [], 2) });
      await page.evaluate((first) => {
        (window as unknown as { __wm: { startBulk: (a: unknown, b: number) => void } }).__wm.startBulk(first, 6);
      }, target);
      await page.locator('[data-trial-bulk="finished"]').waitFor({ timeout: 8000 });
      const countText = await text(page, "[data-trial-bulk-count]");
      check("F12 browser: one paywall check for the first locked image, then batches until no progress — \"Odblokowano 3 z 6\"",
        countText === pl("genv3.wm.bulkProgress", { x: 3, y: 6 })
        && JSON.stringify((await wm<unknown[][]>(page, "calls"))[0]) === JSON.stringify(["paywall", { assetId: target.assetId, surface: "library_bulk" }])
        && bodies["unlock-all"].length === 3 && (await page.locator("[data-trial-bulk-failed]").count()) === 1, countText);
      check("F13 browser: the first call mints the bulk id; later calls send it back with the failed images to skip",
        JSON.stringify(bodies["unlock-all"][0]) === JSON.stringify({ skip: [] })
        && JSON.stringify(bodies["unlock-all"][1]) === JSON.stringify({ bulkId: "22222222-2222-4222-8222-222222222222", skip: ["c"] })
        && JSON.stringify(await wm<string[]>(page, "bulkUnlocked")) === JSON.stringify(["a", "b", "d"])
        && (await wm<number[]>(page, "settled")).slice(-1)[0] === 3);
      queues["unlock-all"].push({ body: ok(["c"], [], 0, true) });
      await page.locator("[data-trial-bulk-retry]").click();
      await page.waitForFunction(() => (window as unknown as { __wm: { settled: number[] } }).__wm.settled.slice(-1)[0] === 0, null, { timeout: 8000 });
      check("F14 browser: \"Ponów nieudane\" starts a fresh run (no bulk id, no skip) that ends done with nothing left",
        JSON.stringify(bodies["unlock-all"][3]) === JSON.stringify({ skip: [] })
        && (await page.locator("[data-trial-bulk-retry]").count()) === 0);
      await page.close();
    }
    // F15–F17 · the real lightbox and retake editor with a locked image
    {
      const page = await fresh();
      const item = {
        generationId: "33333333-3333-4333-8333-333333333333", assetId: target.assetId, path: "w/j/a.png", url: PREVIEW, thumbUrl: PREVIEW,
        previewUrl: PREVIEW, hasThumb: true, width: 1024, height: 1024, ratio: "1:1", resolution: "2K", quality: null, quantity: 1, credits: 7,
        latencyMs: 1000, referenceCount: 0, inspirationCount: 0, operation: "image_retouch", model: "Retusz", modelId: "m1", product: "Kubek",
        sessionType: null, origin: "custom", prompt: null, favorite: false, note: null, createdAt: "2026-10-10T10:00:00.000Z",
        trial: { state: "locked", expiresAt: null, daysLeft: 3 },
      };
      await page.evaluate((it) => { (window as unknown as { __wm: { showDetails: (v: unknown) => void } }).__wm.showDetails([it]); }, item);
      await page.locator("[data-details-modal]").waitFor({ timeout: 8000 });
      const tiles = page.locator("[data-edit-tile]");
      const disabled = await tiles.evaluateAll((els) => els.filter((e) => (e as HTMLButtonElement).disabled).length);
      const plateText = await text(page, '[data-trial-notice="locked"]');
      check("F15 browser lightbox (locked): 4 edit tiles, all off (R5) with the hint; the plate with the days and the CTA",
        (await tiles.count()) === 4 && disabled === 4 && (await page.locator('[data-trial-hint="locked"]').count()) === 1
        && plateText.includes(pl("genv3.wm.available", { n: 3 })), `tiles=${await tiles.count()} disabled=${disabled}`);
      await setReplies(page, [{ kind: "paywall", paywallId: "pw-2", daysLeft: 3, plans: PLANS, hasLiveSubscription: false, pending: false }, { kind: "entitled" }]);
      await page.locator('[data-trial-notice="locked"] [data-trial-unlock]').click();
      await page.locator("[data-trial-paywall]").waitFor({ timeout: 8000 });
      await page.keyboard.press("Escape");
      await page.locator("[data-trial-dialog]").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      check("F16 browser: the paywall opened from the lightbox closes on Escape and the lightbox stays open",
        (await page.locator("[data-trial-dialog]").count()) === 0 && (await page.locator("[data-details-modal]").count()) === 1
        && (await wm<number>(page, "detailsCloses")) === 0 && (await page.evaluate(() => document.body.style.overflow)) === "hidden");
      queues.unlock.push({ body: unlockedReply(`${ORIGIN}/dl/a.png?token=${jwt(farExp)}`) });
      await page.locator('[data-trial-hint="locked"] [data-trial-hint-unlock]').click();
      await page.locator("[data-trial-success]").waitFor({ timeout: 8000 });
      await page.locator("[data-trial-success] button.plate").click();
      await page.locator("[data-trial-dialog]").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      const enabled = await tiles.evaluateAll((els) => els.filter((e) => !(e as HTMLButtonElement).disabled).length);
      check("F17 browser: after the unlock the lightbox shows the clean file — no plate, the three tools back on",
        (await page.locator("[data-trial-notice]").count()) === 0 && enabled === 3
        && (await page.locator("[data-details-modal] img").first().getAttribute("src")) === `${ORIGIN}/dl/clean.png`, `enabled=${enabled}`);
      await page.evaluate(() => { (window as unknown as { __wm: { showDetails: (v: unknown) => void } }).__wm.showDetails(null); });

      const model = { id: "m1", name: "Model", badge: null, badgeTone: null, description: null, pricing: { "2K": 7 }, resolutions: ["2K"], ratios: ["1:1"],
        exactRatios: ["1:1"], maxOutputs: 1, supportsRefs: true, qualities: [], qualityPricing: {} };
      await page.evaluate(([it, m]) => {
        (window as unknown as { __wm: { showRegen: (v: unknown) => void } }).__wm.showRegen({ item: it, models: [m] });
      }, [{ ...item, operation: null }, model] as const);
      await page.locator("[data-regen-modal]").waitFor({ timeout: 8000 });
      const toolsOff = await page.locator("[data-regen-tool]").evaluateAll((els) => els.every((e) => (e as HTMLButtonElement).disabled));
      const lockedRegen = {
        canvas: await page.locator("[data-regen-modal] canvas").count(), toolsOff,
        hint: await page.locator("[data-regen-marked] [data-trial-hint-unlock]").count(),
        run: await page.locator("[data-regen-run]").isDisabled(),
      };
      await page.evaluate(([it, m]) => {
        (window as unknown as { __wm: { showRegen: (v: unknown) => void } }).__wm.showRegen({ item: it, models: [m] });
      }, [{ ...item, operation: null, trial: null }, model] as const);
      await page.waitForTimeout(200);
      const plainCanvas = await page.locator("[data-regen-modal] canvas").count();
      check("F18 browser retake (locked): no drawing canvas, the pen tools off, the lock CTA — and \"Generuj\" still on; an ordinary image keeps its canvas",
        lockedRegen.canvas === 0 && lockedRegen.toolsOff && lockedRegen.hint === 1 && !lockedRegen.run && plainCanvas >= 1,
        JSON.stringify({ ...lockedRegen, plainCanvas }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
