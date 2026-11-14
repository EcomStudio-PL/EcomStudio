/**
 * PLANY V3 — the plan page upgrade: wider cards (4 / 2 / 1), amounts that never
 * break, the per-plan card editor (0179) and the two-plan phone comparison.
 *
 *   npm run test:pricingcards          (this file)
 *   npm run test:pricingcards:sql      (0179 against a real Postgres)
 *
 *   A  the default document = the cards exactly as before (every PROD plan,
 *      every language, rendered)
 *   B  the ten edit scenarios on controlled data: PRO text, Starter hide,
 *      add, reorder, hide a group, hide every line → no trace, restore, the
 *      saved document read back, a customer refused, no money moved
 *   C  bound lines never contradict the plan (the editor's lock, the render)
 *   D  the validator: canonical, compact, refuses what it must
 *   E  languages: no Polish where a translation is missing; placeholders
 *   F  layout: 4 / 2 / 1, subgrid rows, amounts nowrap, widths
 *   G  the phone comparison: Starter | PRO, two pickers, swap, sticky header
 *   H  the editor and the server: admin-only, compare-and-set, history,
 *      presentation only, wired into „Edytuj stronę”
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/lib/i18n/provider";
import { makeT } from "@/lib/i18n/t";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import {
  CARD_FEATURES, CARD_GROUP_IDS, allowedStatuses, checkCardsDoc, defaultPlanCard, editGroup, emptyCardsDoc, fillPlaceholders,
  lineState, missingFeatures, missingLocales, moveItem, newCustomId, planCardConfig, readCardsDoc, resolveCard, withPlan,
  type CardFacts, type PlanCardConfig, type PricingCardsDoc, type ResolvedGroup,
} from "@/components/plan/card-features";
import { CARD_GROUPS, featureOn, planPresentation, type FeatureKey } from "@/components/plan/pricing-config";
import { formatCount, planCredits, seatLabel } from "@/components/plan/pricing-model";
import { PlanCards } from "@/components/plan/plan-cards";
import { PlanComparison, initialPair, pickPair } from "@/components/plan/plan-comparison";
import type { PricingPageData, PricingPlanView } from "@/components/plan/pricing-types";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail ? `\n      ${detail}` : ""}`);
}
const section = (title: string) => console.log(`\n${title}`);
const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
type Dict = Parameters<typeof makeT>[0];
const DICTS = { pl: pl as unknown as Dict, en: en as unknown as Dict, de: de as unknown as Dict };
type Lang = keyof typeof DICTS;

/* PROD's catalogue, 13.11.2026 (subscription_plans, read-only). */
const PLAN = (slug: string, name: string, price: number, credits: number, caps: Record<string, number | boolean>): PricingPlanView => ({
  id: `id-${slug}`, slug, name, priceCents: price, annualPriceCents: price * 10, currency: "USD",
  monthlyCredits: credits, bonusCredits: 0, capabilities: caps, payable: { monthly: true, annual: true },
  description: null, featured: slug === "pro",
});
const PLANS: PricingPlanView[] = [
  PLAN("mini", "Mini", 990, 20, { products: 20, workspace_members: 1 }),
  PLAN("starter", "Starter", 2490, 55, { products: 50, workspace_members: 2 }),
  PLAN("pro", "Pro", 4990, 125, { products: 500, priority_queue: true, workspace_members: 5 }),
  PLAN("agency", "Business", 10990, 290, { products: -1, operator_mode: true, priority_queue: true, workspace_members: -1 }),
];
const bySlug = (s: string) => PLANS.find((p) => p.slug === s)!;

const facts = (plan: PricingPlanView, lang: Lang = "pl"): CardFacts => {
  const t = makeT(DICTS[lang]);
  return {
    slug: plan.slug, caps: plan.capabilities, locale: lang, t,
    values: {
      ...(typeof plan.capabilities.workspace_members === "number" ? { seats: seatLabel(plan.capabilities.workspace_members, t) } : {}),
      credits: formatCount(planCredits(plan)),
    },
    featureLabel: (f: FeatureKey) => t(`pricing.feat.${f}`),
  };
};
const resolve = (doc: PricingCardsDoc | null, slug: string, lang: Lang = "pl") =>
  resolveCard(planCardConfig(doc, slug), facts(bySlug(slug), lang));
const flat = (groups: ResolvedGroup[]) => groups.map((g) => `${g.title}: ${g.lines.map((l) => `${l.state}|${l.text}${l.suffix ? `·${l.suffix}` : ""}`).join(", ")}`).join(" / ");

/** The cards as the code drew them before Plany V3 (git f8dbc4b, plan-cards.tsx). */
function before(plan: PricingPlanView, lang: Lang = "pl"): string {
  const t = makeT(DICTS[lang]);
  const caps = plan.capabilities;
  const hl = planPresentation(plan.slug).highlights;
  const line = (f: FeatureKey) => {
    const st = featureOn(f, plan.slug, caps);
    const seats = f === "seats" && typeof caps.workspace_members === "number" ? seatLabel(caps.workspace_members, t) : null;
    return `${st}|${t(`pricing.feat.${f}`)}${seats ? `·${seats}` : ""}`;
  };
  const groups = [`${t("pricing.group.highlights")}: ${hl.filter((f) => featureOn(f, plan.slug, caps) !== "no").map(line).join(", ")}`];
  for (const g of CARD_GROUPS) {
    const rows = g.features.filter((f) => !hl.includes(f) && featureOn(f, plan.slug, caps) !== "no");
    if (rows.length) groups.push(`${t(g.titleKey)}: ${rows.map(line).join(", ")}`);
  }
  return groups.join(" / ");
}

const DATA = (cards: PricingCardsDoc | null): PricingPageData => ({
  // A subscribed viewer: every CTA is the disabled "you have a plan" state,
  // so the cards render without the sign-in dialog's provider.
  viewer: { signedIn: true, currentSlug: "starter", hasLiveSubscription: true, topups: "allowed" },
  paymentsEnabled: true, plans: PLANS, free: { name: "Free" }, annual: { onSale: true, savingPct: 16.67 }, premiere: null,
  packs: [], tiers: [], currency: "USD", topup: { min: 10, max: 1000, step: 1, currency: "USD", buyable: true },
  fx: { rate: 3.7, date: "2026-11-13", stale: false }, imageCost: { model: "Nano Banana Pro", k2: 1, k4: 1.25 }, cards,
});
const renderCards = (cards: PricingCardsDoc | null, layout: "wide" | "phone" = "wide", lang: Lang = "pl") =>
  renderToStaticMarkup(createElement(I18nProvider, { locale: lang, dict: DICTS[lang] as never,
    children: createElement(PlanCards, { plans: PLANS, period: "monthly", data: DATA(cards), order: ["mini", "starter", "pro", "agency"], layout, onChangeHint: () => {} }) }));
const cardHtml = (htmlAll: string, slug: string) => {
  const start = htmlAll.indexOf(`data-plan-card="${slug}"`);
  const end = htmlAll.indexOf("data-plan-card=", start + 20);
  return htmlAll.slice(start, end < 0 ? undefined : end);
};
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** One plan's card edited, the others untouched. */
const edit = (doc: PricingCardsDoc, slug: string, fn: (c: PlanCardConfig) => PlanCardConfig) => withPlan(doc, slug, fn(planCardConfig(doc, slug)));
const saved = (doc: PricingCardsDoc) => {
  const r = checkCardsDoc(JSON.parse(JSON.stringify(doc)));
  if (!r.ok) throw new Error(`invalid: ${r.error} ${r.at ?? ""}`);
  return r.doc;
};

function main() {
  section("A. THE DEFAULT IS THE PAGE AS IT WAS");
  {
    for (const lang of ["pl", "en", "de"] as const) {
      for (const plan of PLANS) {
        check(`${lang} ${plan.slug}: default lines = the pre-V3 card`, flat(resolve(null, plan.slug, lang)) === before(plan, lang),
          `${flat(resolve(null, plan.slug, lang))}\n      ≠ ${before(plan, lang)}`);
      }
    }
    check("no document, an empty one and a broken one render the same cards",
      renderCards(null) === renderCards(emptyCardsDoc()) && renderCards(null) === renderCards(readCardsDoc({ v: 9, junk: true })));
    check("an unknown plan gets the fallback lines (no crash)",
      resolveCard(planCardConfig(null, "enterprise"), facts(PLAN("enterprise", "Enterprise", 50000, 900, {}))).length > 0);
    const h = renderCards(null);
    check("highlights first, then Narzędzia / Generowanie / Zespół / Wsparcie, as before",
      [...h.matchAll(/data-card-group="([a-z]+)"/g)].slice(0, 5).map((m) => m[1]).join() === "highlights,tools,output,team,support");
    check("'Wkrótce' stays a badge, never a ✓ (PRO priority, Business operator)",
      /data-line="f:priority"[^>]*data-state="soon"/.test(cardHtml(h, "pro")) && /data-line="f:operator"[^>]*data-state="soon"/.test(cardHtml(h, "agency")));
    const seats5 = seatLabel(5, makeT(DICTS.pl));
    check(`the seat count still follows the seats line, bold (${seats5})`,
      cardHtml(h, "pro").includes(`${makeT(DICTS.pl)("pricing.feat.seats")}<span class="font-semibold"> · ${seats5}</span>`));
  }

  section("B. THE TEN EDIT SCENARIOS (controlled data, no PROD writes)");
  let doc = emptyCardsDoc();
  {
    // 1. PRO: change a line's words.
    doc = saved(edit(doc, "pro", (c) => editGroup(c, "highlights", (g) => {
      g.items.find((i) => i.id === "f:noExpiry")!.label = { pl: "Kredyty z doładowań nie wygasają", en: "Top-up credits never expire", de: "Aufladungs-Credits verfallen nie" };
    })));
    const h1 = renderCards(doc);
    check("1. PRO's line reads the new words", text(cardHtml(h1, "pro")).includes("Kredyty z doładowań nie wygasają"));
    check("1. …and only PRO changed (Mini, Starter, Business identical)",
      ["mini", "starter", "agency"].every((s) => cardHtml(h1, s) === cardHtml(renderCards(null), s)));
    check("1. …in English and German too, from their own words", text(cardHtml(renderCards(doc, "wide", "en"), "pro")).includes("Top-up credits never expire")
      && text(cardHtml(renderCards(doc, "wide", "de"), "pro")).includes("Aufladungs-Credits verfallen nie"));

    // 2. Starter: hide a line.
    doc = saved(edit(doc, "starter", (c) => editGroup(c, "tools", (g) => { g.items.find((i) => i.id === "f:customPrompts")!.hidden = true; })));
    const h2 = renderCards(doc);
    check("2. Starter no longer lists 'Własne prompty'", !/data-line="f:customPrompts"/.test(cardHtml(h2, "starter")));
    check("2. …the other plans still do", ["mini", "pro", "agency"].every((s) => /data-line="f:customPrompts"/.test(cardHtml(h2, s))));
    check("2. …and the comparison table still has the row (hiding on a card removes nothing there)",
      read("components/plan/plan-comparison.tsx").includes("COMPARE_GROUPS") && !codeOnly(read("components/plan/plan-comparison.tsx")).includes("data.cards"));

    // 3. Add a custom line to a group.
    const id = newCustomId(new Set(), () => 0.5);
    doc = saved(edit(doc, "pro", (c) => editGroup(c, "support", (g) => {
      g.items.push({ id, label: { pl: "Onboarding 1:1 przez wideo", en: "1:1 video onboarding", de: "1:1-Video-Onboarding" }, status: "yes" });
    })));
    check("3. the new line is on PRO's card, in its group, with ✓",
      new RegExp(`data-card-group="support"[\\s\\S]*data-line="${id}"[^>]*data-state="yes"`).test(cardHtml(renderCards(doc), "pro")));

    // 4. Reorder: move it to the top of the group (keyboard ↑ = moveItem).
    const supportIds = (d: PricingCardsDoc) => planCardConfig(d, "pro").groups.find((g) => g.id === "support")!.items.map((i) => i.id);
    const before4 = supportIds(doc);
    doc = saved(edit(doc, "pro", (c) => moveItem(c, "support", before4.indexOf(id), 0)));
    check("4. the custom line is first in Wsparcie now", supportIds(doc)[0] === id && supportIds(doc).length === before4.length);
    check("4. …and drawn first", (() => {
      const h = cardHtml(renderCards(doc), "pro");
      const g = h.slice(h.indexOf('data-card-group="support"'));
      return g.indexOf(`data-line="${id}"`) < g.indexOf('data-line="f:supportEmail"');
    })());

    // 5. Hide a whole group.
    doc = saved(edit(doc, "pro", (c) => editGroup(c, "output", (g) => { g.hidden = true; })));
    check("5. PRO's 'Generowanie i eksport' group is gone", !/data-card-group="output"/.test(cardHtml(renderCards(doc), "pro")));
    check("5. …Starter keeps it", /data-card-group="output"/.test(cardHtml(renderCards(doc), "starter")));

    // 6. Hide every line of a group: no heading, no divider, no gap.
    doc = saved(edit(doc, "starter", (c) => editGroup(c, "team", (g) => { g.items.forEach((i) => { i.hidden = true; }); })));
    const h6 = cardHtml(renderCards(doc), "starter");
    check("6. every line hidden → the whole block disappears (title, divider, spacing)",
      !/data-card-group="team"/.test(h6) && !text(h6).includes("Zespół i kontrola"));

    // 7. Undo: restore the state before 5 and 6 (what a history restore writes).
    const restored = saved(JSON.parse(JSON.stringify(doc)) as PricingCardsDoc);
    const back = saved(edit(edit(restored, "pro", (c) => editGroup(c, "output", (g) => { delete g.hidden; })),
      "starter", (c) => editGroup(c, "team", (g) => { g.items.forEach((i) => { delete i.hidden; }); })));
    check("7. restoring brings the hidden group and lines back", /data-card-group="output"/.test(cardHtml(renderCards(back), "pro"))
      && /data-card-group="team"/.test(cardHtml(renderCards(back), "starter")));
    check("7. a plan restored to its default leaves the document (code default again)",
      !("mini" in withPlan(doc, "mini", defaultPlanCard("mini")).plans) && !("pro" in withPlan(doc, "pro", defaultPlanCard("pro")).plans));

    // 8. Refresh: what is stored is what the page reads back.
    const stored = JSON.parse(JSON.stringify(doc));
    check("8. the saved document reads back identically (a refresh draws the same cards)",
      JSON.stringify(readCardsDoc(stored)) === JSON.stringify(doc) && renderCards(readCardsDoc(stored)) === renderCards(doc));

    // 9. A customer is refused: on the server, before anything is read.
    const srv = codeOnly(read("lib/server/ice/pricing-cards.ts"));
    check("9. every server entry is admin-only (requireIceAdmin), the DB re-checks is_admin (SQL suite)",
      (srv.match(/requireIceAdmin\(\)/g) ?? []).length === 3 && /if not public\.is_admin\(\) then raise exception 'not_admin'/.test(read("supabase/migrations/0179_pricing_cards.sql")));

    // 10. No money moved: the document holds words and marks, nothing else.
    const json = JSON.stringify(doc);
    check("10. the document holds no price, credit amount, seat count or Stripe id",
      !/price|cents|stripe|credits"\s*:\s*\d|workspace_members|monthly_credits/i.test(json));
    check("10. plans' prices and capabilities render the same with any document",
      PLANS.every((p) => {
        const a = cardHtml(renderCards(null), p.slug);
        const b = cardHtml(renderCards(doc), p.slug);
        const money = (h: string) => [...h.matchAll(/data-plan-(price|pln|billing|credits)[^>]*>([\s\S]*?)<\/(span|p|div)>/g)].map((m) => m[2]).join("|");
        return money(a) === money(b);
      }));
  }

  section("C. A BOUND LINE NEVER CONTRADICTS THE PLAN");
  {
    const pri = { id: "f:priority", feature: "priority" as const, status: "yes" as const };
    check("a stored ✓ on a 'Wkrótce' feature still renders 'Wkrótce'", lineState(pri, "pro", bySlug("pro").capabilities) === "soon");
    check("a stored ✓ on a feature the plan lacks renders nothing", lineState(pri, "starter", bySlug("starter").capabilities) === null);
    check("…or ✕ when the admin chose to show it missing", lineState({ ...pri, status: "no" }, "starter", bySlug("starter").capabilities) === "no");
    check("a stored ✕ on a feature the plan HAS still renders ✓",
      lineState({ id: "f:allTools", feature: "allTools", status: "no" }, "pro", bySlug("pro").capabilities) === "yes");
    check("video is 'Wkrótce' on every plan, whatever is stored",
      PLANS.every((p) => lineState({ id: "f:video", feature: "video", status: "yes" }, p.slug, p.capabilities) === "soon"));
    check("the editor offers only the truth: available → locked; missing → hide or ✕; custom → free",
      allowedStatuses({ feature: "allTools" }, "pro", {}).join() === "auto"
      && allowedStatuses({ feature: "priority" }, "pro", { priority_queue: true }).join() === "auto"
      && allowedStatuses({ feature: "operator" }, "pro", {}).join() === "auto,no"
      && allowedStatuses({}, "pro", {}).join() === "yes,soon,no");
    const panel = codeOnly(read("components/ice/editor/pricing-cards-panel.tsx"));
    check("the panel locks the select and explains why", /disabled=\{busy \|\| allowed\.length < 2\}/.test(panel)
      && /ice\.cards\.lockSoon/.test(panel) && /ice\.cards\.lockNo/.test(panel) && /ice\.cards\.lockYes/.test(panel));
  }

  section("D. THE VALIDATOR");
  {
    const base = (): Record<string, unknown> => JSON.parse(JSON.stringify({ v: 1, plans: { pro: defaultPlanCard("pro") } }));
    check("a default plan is compacted away (no row = no change)", JSON.stringify(checkCardsDoc(base())) === JSON.stringify({ ok: true, doc: { v: 1, plans: {} } }));
    const bad = (name: string, mut: (d: { plans: { pro: PlanCardConfig } }) => void, code: string) => {
      const d = base() as { plans: { pro: PlanCardConfig } };
      mut(d);
      const r = checkCardsDoc(d);
      check(`refused: ${name}`, !r.ok && r.error === code, JSON.stringify(r));
    };
    bad("a custom line without words", (d) => d.plans.pro.groups[0].items.push({ id: "c:abcdefgh", status: "yes", label: { pl: "  " } }), "custom_needs_text");
    bad("a line over 140 characters", (d) => { d.plans.pro.groups[0].items[0].label = { pl: "x".repeat(141) }; }, "text_too_long");
    bad("an unknown placeholder", (d) => { d.plans.pro.groups[0].items[0].label = { pl: "Do {products} produktów" }; }, "bad_placeholder");
    bad("a control / bidi character", (d) => { d.plans.pro.groups[0].items[0].label = { pl: "abc‮def" }; }, "bad_text");
    bad("the same feature twice", (d) => d.plans.pro.groups[1].items.push({ id: "f:noExpiry", feature: "noExpiry", status: "auto" }), "bad_item");
    bad("a feature id that does not match", (d) => d.plans.pro.groups[1].items.push({ id: "f:zzz", feature: "library", status: "auto" }), "bad_feature");
    bad("an unknown feature", (d) => d.plans.pro.groups[1].items.push({ id: "f:api", feature: "api" as FeatureKey, status: "auto" }), "bad_feature");
    bad("a money row bound to a card", (d) => d.plans.pro.groups[1].items.push({ id: "f:creditPrice", feature: "creditPrice", status: "auto" }), "bad_feature");
    bad("a missing group", (d) => { d.plans.pro.groups.pop(); }, "bad_group");
    bad("an unknown status", (d) => { (d.plans.pro.groups[0].items[0] as { status: string }).status = "maybe"; }, "bad_status");
    bad("an unknown language", (d) => { (d.plans.pro.groups[0].items[0] as { label: unknown }).label = { fr: "x" }; }, "bad_locale");
    bad("a custom id that is not c:xxxxxxxx", (d) => d.plans.pro.groups[0].items.push({ id: "<script>", status: "yes", label: { pl: "x" } }), "bad_item");
    bad("too many lines in a group", (d) => { for (let i = 0; i < 21; i++) d.plans.pro.groups[0].items.push({ id: `c:${String(i).padStart(8, "a")}`, status: "yes", label: { pl: "x" } }); }, "bad_items");
    const slugBad = checkCardsDoc({ v: 1, plans: { "../x": defaultPlanCard("pro") } });
    check("refused: a plan key that is not a slug", !slugBad.ok && slugBad.error === "bad_plan");
    const canon = checkCardsDoc({ v: 1, plans: { pro: { groups: [...defaultPlanCard("pro").groups].reverse().map((g) => (g.id === "tools" ? { ...g, title: { pl: "  Narzędzia   AI " } } : g)) } } });
    check("canonical: groups back in their order, whitespace collapsed",
      canon.ok && canon.doc.plans.pro.groups.map((g) => g.id).join() === CARD_GROUP_IDS.join() && canon.doc.plans.pro.groups[1].title?.pl === "Narzędzia AI");
    check("missing features are offered back by the editor", missingFeatures(edit(emptyCardsDoc(), "pro", (c) => editGroup(c, "tools", (g) => { g.items = g.items.filter((i) => i.id !== "f:video"); })).plans.pro).join() === "video"
      && missingFeatures(defaultPlanCard("pro")).length === 0 && CARD_FEATURES.length === 13);
  }

  section("E. LANGUAGES AND VALUES");
  {
    const d = saved(edit(emptyCardsDoc(), "pro", (c) => editGroup(c, "tools", (g) => {
      g.items.push({ id: "c:onlypl00", label: { pl: "Tylko po polsku" }, status: "yes" });
      g.items[0].label = { pl: "Wszystkie narzędzia GrovBase" };
    })));
    check("a custom line written only in Polish shows in Polish", flat(resolve(d, "pro", "pl")).includes("Tylko po polsku"));
    check("…and is NOT shown in English or German (no Polish leaks)", !flat(resolve(d, "pro", "en")).includes("Tylko po polsku") && !flat(resolve(d, "pro", "de")).includes("Tylko po polsku"));
    check("a renamed bound line falls back to its own translation elsewhere",
      flat(resolve(d, "pro", "en")).includes(makeT(DICTS.en)("pricing.feat.allTools")) && !flat(resolve(d, "pro", "en")).includes("Wszystkie narzędzia GrovBase"));
    check("the editor flags the missing languages", missingLocales({ pl: "x" }).join() === "en,de");
    const v = saved(edit(emptyCardsDoc(), "pro", (c) => editGroup(c, "team", (g) => {
      g.items.find((i) => i.id === "f:seats")!.label = { pl: "Zespół: {seats}" };
      g.items.push({ id: "c:credits0", label: { pl: "{credits} kredytów co miesiąc", en: "{credits} credits a month", de: "{credits} Credits im Monat" }, status: "yes" });
    })));
    const pro = flat(resolve(v, "pro"));
    const s5 = seatLabel(5, makeT(DICTS.pl));
    check("{seats} and {credits} are the plan's own values", pro.includes(`soon|Zespół: ${s5}`) && !pro.includes(`Zespół: ${s5}·`) && pro.includes("yes|125 kredytów co miesiąc"), pro);
    check("a value the plan does not have hides the line instead of printing '{seats}'", fillPlaceholders("{seats}", {}) === null);
  }

  section("F. LAYOUT — 4 / 2 / 1, AMOUNTS NEVER BREAK");
  {
    const cards = read("components/plan/plan-cards.tsx");
    const page = read("components/plan/pricing-page.tsx");
    check("phones keep their own list (PRO first) below 768px", /data-plan-cards="phone" className="mx-auto grid max-w-\[440px\] gap-5 md:hidden"/.test(cards));
    check("from 768px two columns; four only with ≥ 1180px of list on a ≥ 1280px screen",
      /hidden \[container-type:inline-size\] md:block/.test(cards) && /grid-cols-2/.test(cards)
      && /xl:\[@container\(min-width:1180px\)\]:grid-cols-4/.test(cards));
    check("gaps 20px, 24px when roomy", /gap-5/.test(cards) && /xl:\[@container\(min-width:1290px\)\]:gap-6/.test(cards));
    check("no size container on the card itself (containment would switch its subgrid off)",
      !/"relative rounded-\[28px\][^"]*container-type/.test(cards) && /data-plan-pricebox className="mt-5 min-w-0 \[container-type:inline-size\]"/.test(cards));
    check("each wide card is a five-row subgrid (header, credits, price, button, features)",
      /row-span-5 grid grid-rows-subgrid gap-y-0/.test(cards) && ["data-plan-head", "data-plan-credits", "data-plan-pricebox", "data-plan-features"].every((a) => cards.includes(a)));
    check("PRO stands out only in a row of four, its content on the shared lines (−16 + 44 = 28px)",
      /isPro && layout === "wide" && "xl:\[@container\(min-width:1180px\)\]:-my-4 xl:\[@container\(min-width:1180px\)\]:py-11"/.test(cards) && /sm:p-7/.test(cards));
    check("the amount never wraps and shrinks with a narrow card; only '/ mies.' may drop",
      /data-plan-price\s+className="whitespace-nowrap font-display text-\[clamp\(2rem,19cqi,2\.75rem\)\][^"]*tabular-nums/.test(cards)
      && /flex flex-wrap items-baseline gap-x-1\.5 gap-y-1 \[overflow-wrap:normal\]/.test(cards));
    check("PLN and billing lines break at spaces only", /data-plan-pln className=\{cn\("mt-1 text-\[12\.5px\] \[overflow-wrap:normal\]"/.test(cards)
      && /data-plan-billing className=\{cn\("mt-2 min-h-\[1\.25rem\] text-\[13px\] \[overflow-wrap:normal\]"/.test(cards));
    check("nothing is masked with overflow:hidden on a card", !/overflow-hidden|truncate/.test(codeOnly(cards)));
    const h = renderCards(null);
    check("formatted amounts carry no breakable space ($109.90, 1 200)", /data-plan-price[^>]*>\$109\.90</.test(h));
    check("widths: heading + cards 1320px, premiere/comparison/top-ups 1100px, FAQ 700px",
      /data-pricing-top className="mx-auto flex w-full max-w-\[1320px\]/.test(page)
      && (page.match(/max-w-\[1100px\]/g) ?? []).length === 4 && /max-w-\[700px\]/.test(page) && !/data-pricing-page\s+className="[^"]*max-w-/.test(page));
    check("/plany's side margins are 24–32px (no 40px xl gutter)", !/xl:px-10/.test(read("components/plan/pricing-surface.tsx")));
  }

  section("G. THE PHONE COMPARISON");
  {
    check("opens on Starter | PRO", initialPair(PLANS.map((p) => p.slug)).join() === "starter,pro");
    check("…or the first two plans when one is missing", initialPair(["mini", "agency"]).join() === "mini,agency");
    check("picking another plan changes only that side", pickPair(["starter", "pro"], 0, "mini").join() === "mini,pro");
    check("picking the other side's plan swaps them (never the same plan twice)",
      pickPair(["starter", "pro"], 0, "pro").join() === "pro,starter" && pickPair(["starter", "pro"], 1, "starter").join() === "pro,starter");
    const html = renderToStaticMarkup(createElement(I18nProvider, { locale: "pl", dict: DICTS.pl as never,
      children: createElement(PlanComparison, { plans: PLANS, period: "monthly", data: DATA(null), onChangeHint: () => {} }) }));
    const phone = html.slice(html.indexOf("data-compare-phone"), html.indexOf("data-compare-scroll"));
    check("two columns, Starter left and PRO right", /data-compare-phone-col="starter"[\s\S]*data-compare-phone-col="pro"/.test(phone)
      && (phone.match(/data-compare-phone-col=/g) ?? []).length === 2);
    check("each row: the name full width, then the two values", /<dt[^>]*>Kredyty co miesiąc<\/dt><dd class="mt-1\.5 grid grid-cols-2/.test(phone));
    check("the same cells as the table (credits, 'Wkrótce', –)", /data-compare-phone-value="pro"[^>]*>[\s\S]*?125/.test(phone));
    check("the first rows only until 'Pokaż wszystkie funkcje'", (phone.match(/data-compare-phone-row=/g) ?? []).length === 9);
    const cmp = read("components/plan/plan-comparison.tsx");
    check("the table is still the ≥ 768px view, unchanged inside", /relative hidden overflow-x-auto rounded-\[24px\] border border-line bg-surface md:block lg:overflow-visible/.test(cmp)
      && /<table/.test(cmp) && /sticky left-0/.test(cmp));
    check("the phone header sticks under the bar and the safe area, at its own height, under the bar's z-index",
      /data-compare-phone-head\s+className="sticky top-\[calc\(var\(--header-h\)\+env\(safe-area-inset-top,0px\)\+8px\)\] z-20/.test(cmp)
      && !/data-compare-phone-head[^>]*\bh-\[/.test(cmp));
    const phoneSrc = cmp.slice(cmp.indexOf("function PhoneComparison"));
    check("no scroll box of its own, no sideways scroll", !/overflow-(x|y)?-?(auto|scroll|hidden)/.test(phoneSrc.slice(0, phoneSrc.indexOf("function Soon"))));
    check("44px targets: pickers, 'Wybierz', the change link", (phoneSrc.match(/h-11|min-h-11/g) ?? []).length >= 3);
    check("'Wybierz' never wraps; the amount neither", /whitespace-nowrap rounded-lg px-2 text-\[13px\]/.test(phoneSrc) && /data-compare-phone-price className="whitespace-nowrap/.test(phoneSrc));
    check("PRO's column subtly highlighted", /bg-\[rgb\(var\(--accent-soft\)\)\] shadow-\[inset_0_2px_0_rgb\(var\(--accent\)\)\]/.test(phoneSrc));
    check("the fold toggle controls both views", /aria-controls=\{`\$\{bodyId\} \$\{phoneId\}`\}/.test(cmp));
  }

  section("H. EDITOR AND SERVER");
  {
    const srv = codeOnly(read("lib/server/ice/pricing-cards.ts"));
    const mig = codeOnly(read("supabase/migrations/0179_pricing_cards.sql").replace(/--.*$/gm, ""));
    check("the server re-validates with the page's own validator", /checkCardsDoc\(input\?\.doc\)/.test(srv));
    check("compare-and-set: the base is sent, a conflict hands back the current state",
      /p_base: base/.test(srv) && /new IceRefusal\("conflict", await readState\(supabase\)\)/.test(srv));
    check("audited, both pricing pages re-rendered", /logAudit\(/.test(srv) && /revalidatePath\("\/plany"\)/.test(srv) && /revalidatePath\("\/plan"\)/.test(srv));
    check("history: restore by version id or to the default, itself a version", /pricingCardsRestore/.test(srv) && /"default"/.test(srv) && /"restore"/.test(srv));
    check("presentation only: the server writes nothing but pricing_cards_write",
      !/\.(insert|update|upsert|delete)\(/.test(srv) && (srv.match(/\.rpc\(/g) ?? []).length === 1);
    check("the migration is additive: no drop table / delete / truncate, subscription_plans untouched",
      !/drop table|delete from|truncate/i.test(mig) && !/subscription_plans/.test(mig) && /create table if not exists public\.pricing_cards/.test(mig));
    check("public read is the document only, for anon and authenticated",
      /select jsonb_build_object\('doc', c\.doc\)/.test(mig) && /grant execute on function public\.pricing_cards_published\(\) to anon, authenticated/.test(mig));
    check("the page reads it through the published function and falls back on any error",
      /rpc\("pricing_cards_published"\)/.test(read("lib/server/pricing-page.ts")) && /catch \{\s*return null;/.test(read("lib/server/pricing-page.ts")));
    check("the card falls back to the default if a document ever throws", /catch \{\s*return resolveCard\(defaultPlanCard\(plan\.slug\), facts\);/.test(read("components/plan/plan-cards.tsx")));
    const ed = read("components/ice/editor/editor.tsx");
    check("„Edytuj stronę” offers „Karty planów” where the page marks its cards",
      /\[data-plan-cards-edit\]/.test(ed) && /ice\.bar\.cards/.test(ed) && /<PricingCardsPanel/.test(ed) && /data-plan-cards-edit=""/.test(read("components/plan/pricing-page.tsx")));
    const panel = codeOnly(read("components/ice/editor/pricing-cards-panel.tsx"));
    check("the panel: plan tabs, groups, lines, Zapisz / Anuluj / Cofnij, history with restore",
      ["data-cards-plan", "data-cards-group", "data-cards-item", "ice.cards.save", "ice.cards.cancel", "ice.cards.undo", "data-cards-history", "ice.cards.restore"].every((k) => panel.includes(k)));
    check("drag & drop with ↑ / ↓ as the keyboard way", /useRowDrag\(/.test(panel) && /ice\.layout\.earlier/.test(panel) && /ice\.layout\.later/.test(panel));
    check("delete asks first and can be undone", /window\.confirm\(t\("ice\.cards\.confirmRemove"\)\)/.test(panel) && /ice\.cards\.removed/.test(panel));
    check("leaving with unsaved changes asks first", /ice\.cards\.confirmLeave/.test(panel));
    const keys = [...panel.matchAll(/["'`](ice\.cards\.[A-Za-z0-9_.]+)["'`]/g)].map((m) => m[1]);
    const lookup = (d: unknown, k: string): unknown => k.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), d);
    const missing = keys.flatMap((k) => (["pl", "en", "de"] as const).filter((l) => typeof lookup(DICTS[l], k) !== "string").map((l) => `${l}:${k}`));
    check(`every editor string exists in pl / en / de (${new Set(keys).size} keys)`, missing.length === 0, missing.join(", "));
    const same = ["title", "sub", "conflict", "lockSoon", "customHint"].filter((k) => {
      const v = (["pl", "en", "de"] as const).map((l) => lookup(DICTS[l], `ice.cards.${k}`));
      return new Set(v).size < 3;
    });
    check("…genuinely translated (not Polish copied)", same.length === 0, same.join());
    const scopes = read("lib/i18n/scopes.ts");
    const iceScope = scopes.slice(scopes.indexOf("const ice = ["), scopes.indexOf("] as const;", scopes.indexOf("const ice = [")));
    check("the editor shows the card's own words, and its i18n scope carries them (pricing, plans)",
      /`pricing\.feat\.\$\{f\}`/.test(panel) && /"pricing"/.test(iceScope) && /"plans"/.test(iceScope));
  }

  console.log(failed === 0 ? `\nAll Plany V3 tests passed (${passed} checks).` : `\n${failed} Plany V3 test(s) failed, ${passed} passed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
