/**
 * /home — THE SELLER HOME (components/seller-home), and everything it must not
 * touch.
 *
 *   npm run test:sellerhome
 *
 * Pure model, the two writes (seller channel, "Powiadom mnie") against a fake
 * Supabase, the handoff of a photo to the tool that runs it, the config's
 * honesty (no prices typed in), i18n completeness, and SHA-256 pins of every
 * frozen file — the public "/", /start, the header, /tools, Retusz, the AI
 * request paths, Stripe and /plan — against the release they were frozen in.
 * Interactions in a real browser (radio cards, slider keyboard, filters,
 * "Zrób to samo", no-credits modal, overflow at 320–1440 px) are covered by the
 * visual probe; the assertions here are what can be proven without one.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ANCHOR_PLAN_SLUG, CHANNEL_DEFAULT_TASK, DEFAULT_HERO_TASK, GALLERY, GALLERY_MAX, HANDOFF_ROUTES, HERO_TASKS,
  INDUSTRIES, INTEREST_KEYS, PRICE_ANCHORS, RECENT_MAX, SAMPLES, SELLER_CHANNELS, TOOL_GROUPS,
  isInterestKey, isSellerChannel,
} from "@/lib/seller-home-config";
import {
  anchorCents, cannotAfford, channelFromSurvey, defaultTaskFor, filterGallery, imagesAffordable, pluralForm,
  recentCards, recentRoute, resolveHeroTasks, shouldAskChannel, taskByKey, visibleGallery, type ItemState,
} from "@/lib/seller-home-model";
import { registerFeatureInterest, saveSellerChannel } from "@/lib/services/seller-home";
import { stashHomeUpload, takeHomeUpload } from "@/lib/home-handoff";
import { isProtectedPath } from "@/lib/supabase/middleware";
import { catalogItem } from "@/lib/tool-cards";
import { MediaSlot } from "@/components/seller-home/media-slot";
import { BeforeAfter } from "@/components/seller-home/before-after";
import type { Client } from "@/lib/services/workspace";

async function main() {

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
}
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

/* ── fixtures ─────────────────────────────────────────────────────────────*/

const S = (key: string, href: string, available: boolean, credits: number | null, shots: number | null): ItemState =>
  ({ key, href, available, credits, shots });
const LIVE: Record<string, ItemState> = {
  "ecommerce.thumbnail": S("ecommerce.thumbnail", "/k/ecommerce/thumbnail", true, 4, 5),
  "ecommerce.packshot": S("ecommerce.packshot", "/k/ecommerce/packshot", true, 4, 5),
  "ecommerce.context": S("ecommerce.context", "/k/ecommerce/context", true, 4, 6),
  "ecommerce.set": S("ecommerce.set", "/k/ecommerce/set", true, 4, 8),
  "moda.ghostMannequin": S("moda.ghostMannequin", "/k/moda/ghostMannequin", false, 7, null),
  "ghost_mannequin": S("ghost_mannequin", "/tools/ghost_mannequin", false, 0, null),
};

/* ── 1–4. untouched surfaces ──────────────────────────────────────────────*/

section("1–4. THE PUBLIC PAGE, /start, /dashboard AND THE HEADER ARE UNTOUCHED");
// Pinned to the release before the redesign (5d966f0). A change to any of
// these is not part of a /home redesign and must be argued for on its own.
const FROZEN: readonly [string, string][] = [
  ["app/page.tsx", "1fb062ed1449314369c75e1abfe87d26d4b85163c159a4ecf7469fa22f7f52c1"],
  ["app/[slug]/page.tsx", "acc6b04382426e2df0aa75198da1dd4ce9ba9585c59db4a8a9d672eaeaf95cdb"],
  ["lib/home-sections.ts", "d2a57f246d437d09545d3020943b613183e5c77668ebb4fd7122f612ad68cdb9"],
  ["lib/home-picks.ts", "c01b282598d0c5bff6768dee3bbf2f43429ba72ecf1ea3f040df41d274910fc6"],
  ["components/home/card-art.tsx", "b7c8b8bba3317e7fe64e9b9f29acfb11c7d91756a957416b4846a10a3b1b2faa"],
  ["components/home/drop-door.tsx", "25be913f198769d0f3e659694858fad373baf54c544d4cda231f8811f4e93ceb"],
  ["components/home/gate.tsx", "79533aaab1cd3dfa432ce102efca034d52a5c716c521a1ea967f38143511949f"],
  ["components/home/grovshot-banner.tsx", "987f1ece23fa4dcc42f7b23d7734cefb4f7755c74f82081d2bab0bfc06583d0f"],
  ["components/home/home-gallery.tsx", "dd9597815b72497e81ace369a5173530ca3bd1db4460cdc4ab0be1a17e62c4f0"],
  ["components/home/product-cards.tsx", "31faf2e26a61a57c5ab8425e55f67b8be62e60cdcda3a5e637db5a1c6de0c7e0"],
  ["components/home/product-home.tsx", "563ea47b70567fa4e661a615e48c479d6e01028df8599a83fd80eee0043edbdc"],
  ["components/home/product-surface.tsx", "192f808be79f5e9775f68b7199fd114eb4b453f03e8844117532f7c2aeeb1ce7"],
  ["components/home/start-box.tsx", "06e19ff01b8f8c458d787580ddbca692be5f4bd4d0bf2114a1fccbec1f12c8da"],
  ["app/(app)/dashboard/page.tsx", "200419c0840054885847a2cfca17918bd524644630b63c3be324e798b12c7eb2"],
  ["app/(app)/dashboard/layout.tsx", "091b1dad18ba00fa61c921d1969667191cb53626a046f6c3c184e3cc9805c4c6"],
  ["app/(app)/home/layout.tsx", "091b1dad18ba00fa61c921d1969667191cb53626a046f6c3c184e3cc9805c4c6"],
  ["app/(app)/layout.tsx", "fc003f788c68cbc3f26bdf516905d845a4d21a7b9abf1bbc37fa66e205826129"],
  ["components/layout/mega-topbar.tsx", "913fe0c30674ddd6651a6025bbb646859c08a92f9a462dcc59df672690d7937a"],
  ["components/layout/customer-bottom-nav.tsx", "4c89edd41c3847467491bd290760b35ad69e92cd7695038d6edc1429297922d2"],
  ["components/layout/customer-drawer.tsx", "758aba86c7ee1a6fc88419038386d0bdde1b4b2949dd765630111e59482d6f1c"],
  ["components/feedback/feedback-cta.tsx", "d2406baf43ee849094e94fe01cc9a1620c1e01a354cd62a6049832cc2c1690a2"],
  ["middleware.ts", "4f7eb9dbae73a29d4a225b54f84dd509bc04ca7592fefa361b0b4a40e6864761"],
];
for (const [file, digest] of FROZEN) check(`${file} unchanged`, sha(readFileSync(file)) === digest);
check("/home requires a session (middleware's protected paths)", isProtectedPath("/home") && isProtectedPath("/dashboard"));
check("/dashboard still forwards to /home", /redirect\("\/home"\)/.test(code("app/(app)/dashboard/page.tsx")));
const homePage = code("app/(app)/home/page.tsx");
check("/home renders the seller home, not the public surface", /<SellerHome \/>/.test(homePage) && !/ProductSurface|ProductHome/.test(homePage));
check("/start and \"/\" still render the shared public surface", /<ProductSurface \/>/.test(code("app/[slug]/page.tsx")) && /<ProductSurface \/>/.test(code("app/page.tsx")));
const body = code("components/seller-home/seller-home.tsx");
check("the seller home mounts no header, nav or feedback button of its own (the layout's stay)",
  !/MegaTopbar|CustomerBottomNav|FeedbackCTA|CustomerDrawer/.test(body));

/* ── 5–10. hero tasks, costs, wallet ──────────────────────────────────────*/

section("5–10. FOUR TASKS, REAL ROUTES, REAL COSTS, THE WALLET");
check("5: four hero tasks in the spec's order", HERO_TASKS.map((t) => t.key).join(",") === "allegro,packshot,lifestyle,mannequin");
check("…every task names catalogue items that exist", HERO_TASKS.every((t) => [...t.items, ...(t.replaceWith?.items ?? [])].every((k) => Boolean(catalogItem(k)))));
const hero = code("components/seller-home/hero.tsx");
check("6: a radio group — one aria-checked radio per card", /role="radiogroup"/.test(hero) && /role="radio" aria-checked=\{on\}/.test(hero)
  && /const on = task\.available && task\.key === selected/.test(hero));
const tasks = resolveHeroTasks(LIVE);
check("7: Allegro is the default", DEFAULT_HERO_TASK === "allegro" && defaultTaskFor(null, tasks) === "allegro"
  && HERO_TASKS[0].badgeKey === "sellerHome.task.popular");
check("8: each task resolves to its existing route and that tool's own price",
  tasks[0].href === "/k/ecommerce/thumbnail" && tasks[0].credits === 4 && tasks[0].shots === 5
  && tasks[2].href === "/k/ecommerce/context" && tasks[2].shots === 6);
check("…a task with no live tool is replaced, never shown as live (mannequin → set today)",
  tasks[3].slot === "mannequin" && tasks[3].key === "set" && tasks[3].available);
const withMannequin = resolveHeroTasks({ ...LIVE, "moda.ghostMannequin": { ...LIVE["moda.ghostMannequin"], available: true } });
check("…and the mannequin shows by itself once its tool is live", withMannequin[3].key === "mannequin" && withMannequin[3].href === "/k/moda/ghostMannequin");
const loader = code("lib/server/seller-home.ts");
check("…prices come from each tool's own source (generator unitPrice, toolCatalogue, Retusz, Moda)",
  /unitPrice\(genModel/.test(loader) && /toolCatalogue\(supabase\)/.test(loader)
  && /retouchPrice\(retouch/.test(loader) && /fashionPrice\(fashion/.test(loader));
const config = code("lib/seller-home-config.ts");
check("9: no credit cost or credit price is typed into the config",
  !/\bcredits?\s*:/.test(config) && !/pricing|price_cents|perCredit|creditCost/.test(config));
check("…the only money in the config is the designer reference (grosze), labelled as such",
  PRICE_ANCHORS.every((a) => Number.isInteger(a.designerCents) && a.designerCents > 0) && ANCHOR_PLAN_SLUG === "pro");
check("10: 25 credits at 4/image → ok. 6", imagesAffordable(25, 4) === 6);
check("…7/image → 3; 0 credits → 0", imagesAffordable(25, 7) === 3 && imagesAffordable(0, 4) === 0);
check("…no fake N for a free or unpriced task", imagesAffordable(25, 0) === null && imagesAffordable(25, null) === null);
check("…no credits for one image → the no-credits moment", cannotAfford(3, 4) && !cannotAfford(4, 4) && !cannotAfford(0, 0) && !cannotAfford(0, null));
check("…Polish plural forms", pluralForm(1) === "one" && pluralForm(3) === "few" && pluralForm(13) === "many"
  && pluralForm(22) === "few" && pluralForm(25) === "many" && pluralForm(0) === "many");
check("…the hero recomputes N from the selected task", /imagesAffordable\(balance, task\.credits\)/.test(hero));

/* ── 11–15. media, before/after, filters, "Zrób to samo" ──────────────────*/

section("11–15. MEDIA SLOTS, BEFORE/AFTER, FILTERS, „ZRÓB TO SAMO”");
const empty = renderToStaticMarkup(createElement(MediaSlot, { label: "Miniaturka — przed/po", hint: "1200×900 px" }));
check("11: an empty slot shows its name, size and a quiet frame (no gradient, no image)",
  /data-media-slot="empty"/.test(empty) && /Miniaturka — przed\/po/.test(empty) && /1200×900 px/.test(empty)
  && /aspect-\[4\/3\]/.test(empty) && !/gradient/.test(empty) && !/<img/.test(empty));
const filled = renderToStaticMarkup(createElement(MediaSlot, {
  label: "x", hint: "y", media: { configKey: "homeMedia.hero.allegro.after", src: "/home/a.webp", width: 1200, height: 900 },
}));
check("12: a filled slot renders the file with its width/height, lazily", /data-media-slot="single"/.test(filled)
  && /src="\/home\/a\.webp"/.test(filled) && /width="1200"/.test(filled) && /height="900"/.test(filled) && /loading="lazy"/.test(filled));
const pairHtml = renderToStaticMarkup(createElement(MediaSlot, {
  label: "x", hint: "y",
  pair: { before: { configKey: "b", src: "/b.webp", width: 1200, height: 900 }, after: { configKey: "a", src: "/a.webp", width: 1200, height: 900 } },
  pairLabels: { before: "Przed", after: "Po" },
}));
check("…a filled pair shows before | after", /data-media-slot="pair"/.test(pairHtml) && /\/b\.webp/.test(pairHtml) && /\/a\.webp/.test(pairHtml));
const ba = renderToStaticMarkup(createElement(BeforeAfter, {
  pair: GALLERY[0].media, sizes: "1px",
  labels: { before: "Przed", after: "Po", slider: "Porównanie", emptyBefore: "Zdjęcie przed", emptyAfter: "Efekt po", hint: "1200×900 px" },
}));
check("13: the before/after control is a labelled native range (mouse, touch and keyboard)",
  /type="range"/.test(ba) && /aria-label="Porównanie"/.test(ba) && /aria-valuetext="50%"/.test(ba) && /touch-action:pan-y/.test(ba));
check("14: industry pills — the spec's seven, filtering only the gallery",
  INDUSTRIES.join(",") === "all,home_garden,tools,beauty,fashion,automotive,pets"
  && filterGallery(GALLERY, "pets").every((g) => g.industry === "pets") && filterGallery(GALLERY, "all").length === GALLERY.length);
const visible = visibleGallery(tasks);
check("…6–8 cards, none for a task that is not live", visible.length >= 6 && visible.length <= GALLERY_MAX
  && visible.every((g) => taskByKey(tasks, g.task) !== null) && !visible.some((g) => g.task === "mannequin"));
const store = code("components/seller-home/task-store.ts");
check("15: „Zrób to samo” selects the task, scrolls to the hero and focuses the upload (reduced motion respected)",
  /setSelectedTask\(key\)/.test(store) && /scrollIntoView/.test(store) && /prefers-reduced-motion: reduce/.test(store)
  && /upload\?\.focus/.test(store) && /chooseTaskAndFocusUpload\(g\.task\)/.test(code("components/seller-home/gallery.tsx")));
check("…and never starts a generation", !/router\.push|stashHomeUpload|fetch\(/.test(code("components/seller-home/gallery.tsx")));

/* ── 16–17. availability ──────────────────────────────────────────────────*/

section("16–17. THE SWITCHBOARD AND EACH TOOL'S RUNTIME DECIDE WHAT IS LIVE");
check("16: every item passes menuVisible + its status badge before it can be live",
  /menuVisible\(availability, item\.gates \?\? item\.href, isAdmin\) && itemBadge\(availability, item\) === null/.test(loader)
  && /menuVisible\(availability, gates, isAdmin\)/.test(loader));
check("…and each tool's own runtime check (engine, toolCatalogue, Retusz prompt, Moda tool)",
  /managedLive/.test(loader) && /entry\?\.available/.test(loader) && /retouchConfigured/.test(loader) && /fashionOn\.get\(wf\)/.test(loader));
check("…customers never see an unavailable tool card; admins see it marked",
  /if \(!s\.available && !isAdmin\) return \[\]/.test(loader) && /adminOnly: !s\.available/.test(loader));
const dead = resolveHeroTasks({});
check("17: with nothing live every task is inert, none selectable", dead.every((t) => !t.available) && defaultTaskFor(null, dead) === null
  && taskByKey(dead, "allegro") === null);
check("…an inert card is a disabled radio and „Generuj” refuses", /disabled=\{!task\.available\}/.test(hero)
  && /if \(!task \|\| !task\.available\) return;/.test(hero));
check("…the tools grid holds the spec's eleven, grouped", TOOL_GROUPS.map((g) => g.key).join(",") === "product,fashion,edit"
  && TOOL_GROUPS.flatMap((g) => g.tools).length === 11);

/* ── 18–20. returning seller, onboarding, seller channel ──────────────────*/

section("18–20. RECENT PROJECTS, „GDZIE SPRZEDAJESZ?”");
const items = Array.from({ length: 12 }, (_, i) => ({ generationId: `g${Math.floor(i / 2)}`, operation: null, origin: null }));
const recent = recentCards(items, RECENT_MAX);
check("18: at most 6 recent projects, one per generation", RECENT_MAX === 6 && recent.length === 6 && new Set(recent.map((r) => r.generationId)).size === 6);
check("…„Powtórz” opens the right tool, empty — Retusz / Moda / custom / Grovshot",
  recentRoute({ operation: "image_retouch", origin: null }).href === "/retusz"
  && recentRoute({ operation: "fashion_ghost_mannequin", origin: null }).href === "/k/moda/ghostMannequin"
  && recentRoute({ operation: null, origin: "custom" }).href === "/generator"
  && recentRoute({ operation: null, origin: "engine" }).href === "/prompts");
check("…recent tiles reuse the Library's projection (thumb derivatives), no new signing",
  /listGalleryItems\(supabase, workspace\.id/.test(loader) && !/createSignedUrl/.test(loader));
const base = { generations: 0, askedAt: null, channel: null, surveyChannel: null, bonusPending: false } as const;
check("19: asked only of a seller with 0 generations who was never asked", shouldAskChannel(base)
  && !shouldAskChannel({ ...base, generations: 1 }) && !shouldAskChannel({ ...base, askedAt: "2026-10-07" })
  && !shouldAskChannel({ ...base, channel: "allegro" }));
check("…not while the welcome-bonus dialog is due, nor when the bonus survey already answered",
  !shouldAskChannel({ ...base, bonusPending: true }) && !shouldAskChannel({ ...base, surveyChannel: "amazon" }));
check("…the loader uses that very rule", /shouldAskChannel\(\{/.test(loader));
check("…the survey's answer maps onto ours", channelFromSurvey(["allegro"]) === "allegro" && channelFromSurvey(["shopify"]) === "own_store"
  && channelFromSurvey(["allegro", "amazon"]) === "multi" && channelFromSurvey(["not_selling_yet"]) === null);
check("…channel → default task", CHANNEL_DEFAULT_TASK.allegro === "allegro" && CHANNEL_DEFAULT_TASK.amazon === "packshot"
  && defaultTaskFor("own_store", tasks) === "lifestyle" && defaultTaskFor("multi", tasks) === "allegro");

type Call = { table: string; op: string; payload?: unknown; filter?: [string, unknown]; options?: unknown };
function fakeDb(rowsAfterUpsert: unknown[] = [{ feature_key: "video" }]) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      return {
        update(payload: unknown) {
          return { eq(col: string, val: unknown) { calls.push({ table, op: "update", payload, filter: [col, val] }); return Promise.resolve({ error: null }); } };
        },
        upsert(payload: unknown, options: unknown) {
          return { select() { calls.push({ table, op: "upsert", payload, options }); return Promise.resolve({ data: rowsAfterUpsert, error: null }); } };
        },
      };
    },
  };
  return { db: db as unknown as Client, calls };
}
{
  const { db, calls } = fakeDb();
  const r = await saveSellerChannel(db, "user-1", "amazon");
  const c = calls[0];
  check("20: the answer is saved on the caller's own profile row", r.ok && c.table === "profiles" && c.filter?.[0] === "id" && c.filter?.[1] === "user-1"
    && (c.payload as { seller_channel?: string }).seller_channel === "amazon" && Boolean((c.payload as { seller_channel_asked_at?: string }).seller_channel_asked_at));
  const d = fakeDb();
  await saveSellerChannel(d.db, "user-1", null);
  check("…closing it records only that it was asked", d.calls.length === 1 && !("seller_channel" in (d.calls[0].payload as object)));
  const e = fakeDb();
  const bad = await saveSellerChannel(e.db, "user-1", "ebay" as never);
  check("…an unknown channel is refused before any write", !bad.ok && e.calls.length === 0);
  check("…and the database CHECK holds the same four values", SELLER_CHANNELS.every((v) => read("supabase/migrations/0135_home_seller_channel_feature_interest.sql").includes(`'${v}'`))
    && !isSellerChannel("ebay"));
}

/* ── 21–22. "Powiadom mnie" ───────────────────────────────────────────────*/

section("21–22. „POWIADOM MNIE” — IDEMPOTENT, THE USER FROM THE SESSION");
{
  const first = fakeDb([{ feature_key: "video" }]);
  const r1 = await registerFeatureInterest(first.db, "user-1", "ws-1", "video");
  const opts = first.calls[0].options as { onConflict?: string; ignoreDuplicates?: boolean };
  check("21: one row per (user, feature) — a conflict is a no-op, not a duplicate", r1.ok && r1.created
    && opts.onConflict === "user_id,feature_key" && opts.ignoreDuplicates === true);
  const again = fakeDb([]);
  const r2 = await registerFeatureInterest(again.db, "user-1", "ws-1", "video");
  check("…a repeat click reports success without creating anything", r2.ok && !r2.created);
  const nope = fakeDb();
  const r3 = await registerFeatureInterest(nope.db, "user-1", null, "teleport" as never);
  check("…an unknown feature is refused before any write", !r3.ok && nope.calls.length === 0 && !isInterestKey("teleport"));
  const mig = read("supabase/migrations/0135_home_seller_channel_feature_interest.sql");
  check("…the table's key is (user_id, feature_key) and its CHECK lists the five features",
    /primary key \(user_id, feature_key\)/.test(mig) && INTEREST_KEYS.every((k) => mig.includes(`'${k}'`)));
}
const actions = code("app/actions/seller-home.ts");
const mig = read("supabase/migrations/0135_home_seller_channel_feature_interest.sql");
check("22: the actions take the user from the session — no user id or e-mail from the browser",
  /supabase\.auth\.getUser\(\)/.test(actions) && /export async function registerInterestAction\(feature: string\)/.test(actions)
  && /export async function saveSellerChannelAction\(channel: string \| null\)/.test(actions) && !/email/i.test(actions));
check("…RLS: a user inserts and reads only their own rows; admins read all",
  /with check \(\s*user_id = \(select auth\.uid\(\)\)/.test(mig) && /using \(user_id = \(select auth\.uid\(\)\) or \(select public\.is_admin\(\)\)\)/.test(mig)
  && /enable row level security/.test(mig) && !/for update|for delete/.test(mig));
check("…the demand readout runs under the caller's RLS (security invoker)", /security invoker/.test(mig) && /feature_interest_counts/.test(code("app/admin/page.tsx")));
check("…nothing here uses a service-role key", !/service_role|SERVICE_ROLE|createAdminClient/.test(actions + code("lib/services/seller-home.ts") + loader));

/* ── 23–25. AI, Stripe, Retusz ────────────────────────────────────────────*/

section("23–25. AI REQUESTS, STRIPE, /plan AND RETUSZ ARE UNCHANGED");
const ENGINE: readonly [string, string][] = [
  ["lib/ai/providers/google-request.ts", "ebec5219ae0f40e51071c4305115c430f818573235f38737cfe71829d69a88d1"],
  ["lib/server/concept-generation.ts", "788361ea576b19dc0ef58d325b63199cdeb51b24a4bf3b64bd1e111d55cf8341"],
  ["lib/server/prompt-engine.ts", "5ce9bf1074f34e8852cd06a6440e0c9640a4471049617493d3b1b506e74baf22"],
  ["lib/server/image-tools.ts", "85e3e9155f5264f3237f6d24702728098adeb5ea49a8de560aa7ea24ad03c452"],
  ["lib/server/fashion.ts", "dcde79b33cd35e9789caa3bbc9cc4ddbf406f570d9f02ee3fe7232ad069ab139"],
  ["app/api/prompts/generate/route.ts", "37db9bd3798b9bd5c4c4fc3bdf1056d57dec296f12754fd52bd9f5f97e204b5e"],
  ["app/api/concepts/generate/route.ts", "59ac0b7670179062229aae68505186bd2513953bd1ecad1e555bedf45f588e21"],
  ["app/api/generate/route.ts", "fa333ad425813b1e998494a046e694c63962352eabefd60e21f8addf93c36a22"],
  ["app/api/tools/run/route.ts", "13c2727bbc3fb6751ccae1faaa31fc822869383c3a64c18687dc07dbe92af879"],
  ["components/genv3/uploader.tsx", "cc7d9dbe8305d1fbdef75ae4727b1fce5f0147b1ccc7cf4e9d6e0b6ddf4d8df2"],
  ["lib/images/file-intake.ts", "1dc99c83483f3fa80527e319501edb5a35b717d92771dd72c38eda17bd9acc29"],
  ["lib/services/images.ts", "e6adba31a68d9fa9afcfe69f242a63370032bd5ce31323cf1ef60236d2a3adcf"],
  ["lib/server/gallery.ts", "7ecaa2ce9b145c9c5d21eb39952b5746746ba33d8f06fd3f9959bca4f8cb1d37"],
  ["lib/services/credits.ts", "1a25606a89ca4ebc6f2640542f59b9185da4595ebad973b69be9f82932cb74fb"],
];
for (const [file, digest] of ENGINE) check(`23: ${file} unchanged`, sha(readFileSync(file)) === digest);
// The generator workspace gained ONE receiver and nothing else: with those
// lines taken out it is byte-identical to the release before.
const ws = read("components/genv3/workspace.tsx");
const RECEIVER_IMPORT = 'import { useHomeHandoff } from "@/lib/home-handoff";\n';
const RECEIVER = ws.slice(ws.indexOf("  // A photo chosen on /home"), ws.indexOf("  /**\n   * A PICK FROM THE GROVBASE LIBRARY"));
check("23: the generator workspace differs only by the handoff receiver",
  sha(ws.replace(RECEIVER_IMPORT, "").replace(RECEIVER, "")) === "07d316d73828d44727ec892747596a47f6b56ff719eb9bfc41fc0e125fdcb769");
check("…which feeds the screen's own upload and starts nothing", /useHomeHandoff\(\(file\) => \{ void upload\(\[file\], "refs"\); \}\)/.test(RECEIVER)
  && !/generate\(|fetch\(/.test(RECEIVER));
check("…/home has no generation path: no AI route, no provider, no prompt", !/\/api\/(generate|concepts|prompts|tools|retouch)|runGeneration|lib\/ai\/|prompt_text/.test(
  ["components/seller-home/hero.tsx", "components/seller-home/seller-home.tsx", "components/seller-home/gallery.tsx", "lib/home-handoff.ts"].map(code).join("\n")));
const PAY: readonly [string, string][] = [
  ["lib/server/checkout.ts", "a821fd4514e04b5cf566a49dcd5bb25343e2325c17f49b888a047ce85f096468"],
  ["lib/server/stripe-webhook.ts", "e9a03ea46af4bb7d5c91332969154e4b111b4c1634fbbe124a1ba6b8e03c95d2"],
  ["lib/stripe/config.ts", "0679ce3f018add12ead081c8a667511be4237661d15b9a024fb9ec578ed71df1"],
  ["components/plan/pricing-board.tsx", "780ee8f6eafd14beab47bf3467faa5b9e02f7ee188d7aa35e5d18fa608807ee5"],
  ["components/plan/pricing-model.ts", "c696e3d3361e8f884eaa6e7b4835f5dea1db542c27ebbc6e98ae807de456e503"],
  ["components/plan/pricing-config.ts", "82d606625319075f0bb29e4e79e6aa6867f1995c8262c1015ab547127a10b814"],
  ["components/plan/credit-coin-stack.tsx", "e3dd4c91b1917edd8872c3105633c30f170513a97034ea90f59e102caa00247b"],
  ["components/plan/checkout-notice.tsx", "a7c5a455369ccb2bd99bdab0a5a8779f0c07f8d9b176f32bfd93f9315c0f2813"],
];
for (const [file, digest] of PAY) check(`24: ${file} unchanged`, sha(readFileSync(file)) === digest);
check("24: the no-credits dialog only links to the existing checkout intent and /plan",
  /planCheckoutHref\(pro\.id, "monthly"\)/.test(code("components/seller-home/no-credits-modal.tsx"))
  && !/stripe|fetch\(|checkout\./i.test(code("components/seller-home/no-credits-modal.tsx").replace(/planCheckoutHref/g, "")));
const RETUSZ: readonly [string, string][] = [
  ["lib/server/retouch.ts", "fee74d0e4795110812d4019a3525ac2d9f83420ab3ad616515bb56b39e410d3e"],
  ["lib/server/retouch-delivery.ts", "52d62017201d4c62227c13dbcb84deb5834615ef78bbcf800eda1ad63ca01e54"],
  ["app/(app)/retusz/page.tsx", "3fd68105b04c8d818641de0cd6bc61464b0a0a8e0a4946a8cc63e7731a7e1748"],
];
for (const [file, digest] of RETUSZ) check(`25: ${file} unchanged`, sha(readFileSync(file)) === digest);
check("25: Retusz is never a handoff target — a plain link only", !HANDOFF_ROUTES.some((r) => r.includes("retusz"))
  && HANDOFF_ROUTES.every((r) => r.startsWith("/k/ecommerce/")));
check("…/home only READS Retusz's price (no run, no provider)", !/runRetouch|retouchStepConfig/.test(loader));

/* ── handoff ──────────────────────────────────────────────────────────────*/

section("THE PHOTO HANDOFF (lib/home-handoff.ts)");
const photo = { name: "p.png" } as unknown as File;
stashHomeUpload(photo, "/k/ecommerce/thumbnail");
check("a photo meant for one route is not taken by another", takeHomeUpload("/generator") === null);
check("…the right route takes it once", takeHomeUpload("/k/ecommerce/thumbnail") === photo && takeHomeUpload("/k/ecommerce/thumbnail") === null);
check("…in memory only (no storage, no IndexedDB)", !/localStorage|sessionStorage|indexedDB/.test(code("lib/home-handoff.ts")));
check("„Generuj” validates with the shared intake (MIME + 10 MB) before handing over",
  /acceptFiles\(list, HOME_LIMITS, 1\)/.test(hero) && /ALLOWED_MIME, ext: null, maxBytes: MAX_FILE_BYTES, maxFiles: 1/.test(hero));
check("…hands over only for a route whose screen takes it, then navigates", /if \(photo && task\.handoff\) stashHomeUpload\(photo, task\.href\)/.test(hero)
  && /router\.push\(task\.href\)/.test(hero));
check("„Dodatkowe uwagi” adds nothing to any request (no task carries a notes field)",
  HERO_TASKS.every((t) => t.notesField === null) && !/stashHomeUpload\([^)]*notes/.test(hero));
check("samples are config-driven and run the same path as an upload", SAMPLES.length === 4 && /go\(sample\)/.test(hero));

/* ── i18n + honesty ───────────────────────────────────────────────────────*/

section("COPY — EVERY KEY IN PL/EN/DE, NOTHING TYPED INTO MARKUP");
const dicts = Object.fromEntries((["pl", "en", "de"] as const).map((l) => [l, JSON.parse(read(`lib/i18n/dictionaries/${l}.json`))]));
const has = (d: Record<string, unknown>, key: string) => {
  const [ns, ...rest] = key.split(".");
  let cur: unknown = d[ns];
  const tail = rest.join(".");
  if (cur && typeof cur === "object" && tail in (cur as object)) return true;
  for (const part of rest) { cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined; }
  return typeof cur === "string";
};
const keys = new Set<string>();
for (const t of HERO_TASKS) { [t, t.replaceWith].filter(Boolean).forEach((x) => { keys.add(x!.nameKey); keys.add(x!.effectKey); ["one", "few", "many"].forEach((f) => keys.add(`sellerHome.unit.${x!.unit}.${f}`)); }); }
TOOL_GROUPS.forEach((g) => { keys.add(g.titleKey); g.tools.forEach((t) => { keys.add(t.nameKey); keys.add(t.descKey); }); });
INDUSTRIES.forEach((i) => keys.add(`sellerHome.industry.${i}`));
INTEREST_KEYS.forEach((k) => keys.add(`sellerHome.soon.${k}`));
SELLER_CHANNELS.forEach((c) => keys.add(`sellerHome.channel.${c}`));
PRICE_ANCHORS.forEach((a) => keys.add(a.labelKey));
SAMPLES.forEach((s) => keys.add(s.labelKey));
const SH = ["seller-home.tsx", "hero.tsx", "gallery.tsx", "coming-soon.tsx", "sections.tsx", "seller-modal.tsx", "no-credits-modal.tsx", "media-slot.tsx", "before-after.tsx"]
  .map((f) => code(`components/seller-home/${f}`)).join("\n");
for (const m of SH.matchAll(/\bt\(\s*"([A-Za-z][\w.]*)"/g)) keys.add(m[1]);
const missing = [...keys].filter((k) => !(["pl", "en", "de"] as const).every((l) => has(dicts[l], k)));
check(`all ${keys.size} keys exist in pl, en and de`, missing.length === 0, missing.slice(0, 8).join(", "));
check("no Polish typed into the markup", !/>[^<{]*[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ][^<{]*</.test(SH));
check("the H1 is the spec's sentence", dicts.pl.sellerHome.hero.title === "Wrzuć zdjęcie produktu — dostań gotową miniaturkę pod Allegro");
check("no numbers formatted ad hoc — Polish formatting through the pricing formatters",
  !/toLocaleString|new Intl\.NumberFormat/.test(SH) && /formatCount|formatMoney/.test(SH));
check("anchor: 1 image × 4 kr. × 24,92 gr ≈ 1 zł; 5 lifestyle ≈ 4,98 zł; no input → hidden",
  anchorCents(1, 4, 29900 / 1200) === 100 && anchorCents(5, 4, 29900 / 1200) === 498 && anchorCents(1, null, 25) === null && anchorCents(1, 4, null) === null);
check("the old /home components are not imported by the new page", !/components\/home\//.test(SH));
check("the probe route is not committed", !existsSync("app/probe-tmp"));

console.log(`\n${failed === 0 ? `All seller-home tests passed (${passed} checks).` : `${failed} SELLER-HOME TEST(S) FAILED`}`);
if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
