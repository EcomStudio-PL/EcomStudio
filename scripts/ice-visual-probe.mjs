/**
 * THE INLINE CONTENT EDITOR CHANGES NOTHING A CUSTOMER SEES — EXCEPT PRZED/PO.
 *
 * A visual-regression run of two builds of the app side by side: OLD (the
 * release before the editor) and NEW (with it). Every page below is
 * screenshotted full-page at a phone, a tablet and a desktop width, in the
 * light and the dark theme, twice per side (the second time to measure the
 * noise floor), and OLD is pixel-diffed against NEW. The one intended change
 * is /home's before/after section, now 1:1 (1080×1080) instead of 4:5: for
 * that page the diff is ALSO taken region by region — above the section,
 * the section, and below it re-aligned on the section's bottom edge — so
 * "everything below moved up by exactly the height the section lost, and is
 * otherwise identical" is a measured statement, not a guess.
 *
 * Next to the pixels, it checks what a visitor DOWNLOADS:
 *   a) the CSS files /plany and / load, OLD vs NEW, byte for byte (the
 *      editor's CSS module must never reach a visitor);
 *   b) the anonymous HTML of /plany, / and /regulamin, OLD vs NEW, after
 *      normalising build ids and chunk hashes;
 *   c) on NEW, forged editor cookies (gb_ice=1 and gb_ice_e_*=nonce~/path,
 *      no session) change nothing: no launcher, no invisible markers, no
 *      `ice` namespace, same HTML as without them;
 *   d) every JS/CSS request of /plany and / on OLD vs NEW — the editor chunk
 *      (the one holding "data-ice-target") and its CSS ("hoverLabel") are
 *      never requested; additions are listed with their sizes and the root
 *      layout chunk is measured OLD vs NEW;
 *   e) no horizontal overflow on any NEW page at 390 px.
 *
 * THE HARNESS. /home and /tools sit behind sign-in, and a CMS page needs the
 * CMS schema the DEV project does not have. So — exactly like
 * scripts/home-probe.mjs and scripts/tools-hub-probe.mjs — the harness mounts
 * the REAL components with fixture data under app/probe-tmp/ice-vr/:
 *   home   components/seller-home/seller-home.tsx → SellerHomeView, every
 *          referenced item live (so every section renders), no homeSlots,
 *          inside a copy of the (app) layout's chrome (MegaTopbar, <main>,
 *          FeedbackCTA, CustomerBottomNav, CustomerDrawer);
 *   tools  ToolsCatalogue + ToolsDeepLink over the shipped layout (the
 *          tools-hub-probe page), in the same chrome;
 *   cms    components/cms/blocks.tsx BlockRenderer with a fixed block list
 *          (the published "o-nas" page), inside the real SiteHeader /
 *          SiteFooter with an empty global/nav fixture.
 * The browser is told that /home, /tools and /o-nas ARE those pages (a
 * Playwright route), so the address bar says what production says. The
 * harness must be written into BOTH checkouts before each is built.
 *
 *   node scripts/ice-visual-probe.mjs --harness <checkout-dir>   (each side)
 *   node scripts/ice-visual-probe.mjs --fake-supabase <file.cjs>  (optional, see below)
 *   (cd <checkout> && npx next build && [NODE_OPTIONS="--require <file.cjs>"] npx next start -p <port>)   (each side)
 *   node scripts/ice-visual-probe.mjs <old-base-url> <new-base-url> <out-dir> \
 *        [--old-dir=<old checkout>] [--new-dir=<new checkout>] [--pages=home,plany] [--reps=2]
 *   node scripts/ice-visual-probe.mjs --clean <checkout-dir>
 *
 * --old-dir/--new-dir let the network check find the editor's chunk and CSS
 * by content in NEW's .next/static. Output: <out-dir>/shots/<page>-<w>-<theme>-{old,new,diff}.png
 * (plus -old2/-new2 for the noise run), <out-dir>/results.json, and a table on stdout.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import sharp from "sharp";

/* ── the harness ───────────────────────────────────────────────────────── */

const HARNESS_DIR = "app/probe-tmp/ice-vr";

const SHELL_SRC = `"use client";
import { I18nScope } from "@/lib/i18n/provider";
import { DrawerProvider } from "@/components/layout/shell-context";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { CustomerDrawer } from "@/components/layout/customer-drawer";
import { CustomerBottomNav } from "@/components/layout/customer-bottom-nav";
import { FeedbackCTA } from "@/components/feedback/feedback-cta";
import type { AvailabilityMap } from "@/lib/features";

/** The (app) layout's shell (app/(app)/layout.tsx), with a made-up account. */
export function ProbeAppShell({ dict, avail, children }: {
  dict: Parameters<typeof I18nScope>[0]["dict"]; avail: AvailabilityMap; children: React.ReactNode;
}) {
  return (
    <I18nScope dict={dict}>
      <DrawerProvider>
        <div className="app-shell flex min-h-dvh w-full min-w-0 flex-col">
          <MegaTopbar name="Probe" email="probe@example.com" credits={120} plan="Pro"
            isAdmin={false} navAdmin={false} availability={avail} popularTools={[]} />
          <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
            {children}
            <FeedbackCTA />
          </main>
          <CustomerBottomNav availability={avail} isAdmin={false} />
          <CustomerDrawer name="Probe" email="probe@example.com" credits={120} creditsTotal={500}
            plan="Pro" isAdmin={false} navAdmin={false} availability={avail} />
        </div>
      </DrawerProvider>
    </I18nScope>
  );
}
`;

const HOME_SRC = `import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { allDefaults } from "@/lib/features";
import { CATEGORIES, categoryHref } from "@/lib/categories";
import { catalogItem } from "@/lib/tool-cards";
import { INTEREST_KEYS } from "@/lib/seller-home-config";
import { resolveUploadTools, type ItemState } from "@/lib/seller-home-model";
import { referencedItems, type SellerHomeData } from "@/lib/server/seller-home";
import { SellerHomeView } from "@/components/seller-home/seller-home";
import { ProbeAppShell } from "../shell";

export const dynamic = "force-dynamic";

/** /home for a made-up seller: every item the page references is live (so
 *  every section renders), nothing filled in the visual editor (homeSlots
 *  absent, as on PROD today), no campaign banner, no dialog. */
export default async function Page() {
  const { dict, locale } = await getDictionary();
  const { dict: appDict } = await getScopedDictionary("app");
  const t = makeT(dict);
  const avail = allDefaults();
  const items: Record<string, ItemState> = {};
  for (const key of referencedItems()) {
    const cat = key.startsWith("cat:") ? CATEGORIES.find((c) => c.key === key.slice(4)) : undefined;
    const href = cat ? categoryHref(cat) : catalogItem(key)?.href ?? "/tools";
    items[key] = { key, href, status: "live", credits: 4 };
  }
  const data: SellerHomeData = {
    balance: 120, items, uploadTools: resolveUploadTools(items), toolSlots: {},
    channel: null, askChannel: false, interests: [], soon: [...INTEREST_KEYS],
    pro: null, banners: [], slots: new Map(), isAdmin: false,
  };
  return (
    <ProbeAppShell dict={appDict} avail={avail}>
      <SellerHomeView data={data} t={t} locale={locale} />
    </ProbeAppShell>
  );
}
`;

const TOOLS_SRC = `import { Suspense } from "react";
import { getDictionary, getScopedDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { allDefaults } from "@/lib/features";
import { CATEGORIES, CATEGORY_PARAM } from "@/lib/categories";
import type { HubCardDef } from "@/lib/tool-cards";
import { hubSectionsFor, sectionKeyFor } from "@/lib/tool-layout";
import { categorySlotKey, toolSlotKey, workflowSlotKey } from "@/lib/media-slots";
import { ToolsCatalogue } from "@/components/tools/tools-catalogue";
import { ToolsDeepLink } from "@/components/tools/tools-deep-link";
import { ProbeAppShell } from "../shell";

export const dynamic = "force-dynamic";

/** What app/(app)/tools/page.tsx renders, minus the account (the
 *  tools-hub-probe page): the registry defaults stand in for the switchboard. */
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const wanted = typeof q[CATEGORY_PARAM] === "string" ? q[CATEGORY_PARAM] : null;
  const { dict } = await getDictionary();
  const { dict: appDict } = await getScopedDictionary("app");
  const t = makeT(dict);
  const avail = allDefaults();
  const visible = hubSectionsFor(avail, false);
  const active = sectionKeyFor(wanted, visible);
  const aliases = Object.fromEntries(CATEGORIES
    .map((c) => [c.slug, sectionKeyFor(c.slug, visible)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null && e[1] !== e[0]));
  const slotKeyOf = (c: HubCardDef) =>
    c.workflow ? workflowSlotKey(c.workflow.category, c.workflow.key)
      : CATEGORIES.some((k) => k.key === c.key) ? categorySlotKey(c.key) : toolSlotKey(c.key);
  return (
    <ProbeAppShell dict={appDict} avail={avail}>
      <ToolsCatalogue t={t} avail={avail} isAdmin={false} slots={new Map()}
        sections={visible.map((s) => ({
          key: s.key, icon: s.icon, title: t(s.titleKey), seeAll: s.seeAll,
          active: s.key === active,
          cards: s.cards.map((c) => ({
            key: c.key, href: c.href, icon: c.icon, motif: c.motif,
            title: t(c.titleKey), body: t(c.bodyKey), soon: c.soon,
            slotKey: slotKeyOf(c), gates: c.gates, state: null,
          })),
        }))} />
      <Suspense fallback={null}>
        <ToolsDeepLink sections={visible.map((s) => s.key)} aliases={aliases} />
      </Suspense>
    </ProbeAppShell>
  );
}
`;

const CMS_SRC = `import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import { AnnouncementBar, SiteFooter, SiteHeader, type ShellProps } from "@/components/cms/site-shell";
import { toBlocks } from "@/lib/server/public-site";
import snapshot from "./fixture.json";

export const dynamic = "force-dynamic";

/** What app/[slug]/page.tsx renders for a published standard page, from a
 *  fixed block list instead of the database: the global header and footer
 *  (with no global sections and no menu pages), the real BlockRenderer. */
export default async function Page() {
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const visible = toBlocks(snapshot).filter((b) => b.visible);
  const shell: ShellProps = {
    global: {}, nav: [], site: { instagramUrl: "", facebookUrl: "", linkedinUrl: "", xUrl: "" },
    locale, t, showAuth: true, signedIn: false,
  };
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <AnnouncementBar global={shell.global} locale={locale} />
      <SiteHeader {...shell} />
      <main className="flex-1">
        <BlockRenderer blocks={visible} ctx={renderContext({ locale, t, showAuth: true, signedIn: false })} />
      </main>
      <SiteFooter {...shell} />
    </div>
  );
}
`;

/** The published_snapshot of the public "o-nas" page (public marketing copy),
 *  read once so both builds render the very same blocks. */
const CMS_FIXTURE = [
  { id: "ab1708b0-5fb9-42db-ac30-27b684f9f810", code: {}, type: "hero", style: { base: { width: "narrow", paddingTop: "lg", paddingBottom: "sm" } }, anchor: null,
    content: {
      title: { de: "Wir haben gebaut, wonach wir selbst gesucht haben", en: "We built the thing we were looking for", pl: "Zbudowaliśmy to, czego sami szukaliśmy" },
      subtitle: { de: "GrovBase entstand aus einem Problem: ein gutes Produktfoto kostet mehr als die Marge am Produkt.", en: "GrovBase came out of one problem: a good product photo costs more than the margin on the product.", pl: "GrovBase powstał z jednego problemu: dobre zdjęcie produktowe kosztuje więcej niż marża na produkcie." },
    }, visible: true, audience: "everyone", show_from: null, show_until: null, sort_order: 0, analytics_id: null },
  { id: "c90698c6-f93e-48f1-abba-effb739cefc8", code: {}, type: "text", style: { base: { width: "narrow" } }, anchor: null,
    content: {
      title: { de: "Was GrovBase ist", en: "What GrovBase is", pl: "Czym jest GrovBase" },
      description: { de: "Ein Werkzeug, um aus vorhandenen Fotos Verkaufsmaterial zu machen.\n\nEs ist kein Bildgenerator und kein KI-Spielzeug. Es ist ein Arbeitsgerät für jemanden mit hundert Produkten im Lager und ohne Budget für ein Shooting pro Produkt.", en: "A tool for making sales material out of the photographs a seller already has.\n\nIt is not an image generator or a toy for experimenting with AI. It is a working tool for somebody with a hundred products in a warehouse and no budget for a shoot for each one.", pl: "Narzędziem do robienia materiałów sprzedażowych ze zdjęć, które sprzedawca już ma.\n\nNie jest generatorem obrazków ani zabawką do eksperymentów z AI. Jest narzędziem pracy dla kogoś, kto ma sto produktów w magazynie i żadnego budżetu na sesję dla każdego z nich." },
    }, visible: true, audience: "everyone", show_from: null, show_until: null, sort_order: 1, analytics_id: null },
  { id: "85d5246e-05c5-4298-a7fe-b31bcf40b235", code: {}, type: "text", style: { base: { width: "narrow" } }, anchor: null,
    content: {
      title: { de: "Warum es entstanden ist", en: "Why it exists", pl: "Dlaczego powstał" },
      description: { de: "Weil Onlineverkauf über das Foto entschieden wird — und das Foto ist der teuerste und langsamste Teil des Prozesses.\n\nEin Shooting bedeutet Termin, Studio, Fotograf, Retusche und eine Woche Wartezeit — für ein Produkt, das sich vielleicht gar nicht verkauft. GrovBase verkürzt diesen Zyklus auf Minuten und die Kosten auf einen Bruchteil.", en: "Because online sales are won with a photograph, and the photograph is the most expensive and slowest part of the whole process.\n\nA shoot means a date, a studio, a photographer, retouching and a week of waiting — for a product that may not sell at all. GrovBase shortens that cycle to minutes and the cost to a fraction.", pl: "Bo sprzedaż w internecie wygrywa się zdjęciem, a zdjęcie jest najdroższym i najwolniejszym elementem całego procesu.\n\nSesja to termin, studio, fotograf, retusz i tydzień czekania — na produkt, który być może okaże się nietrafiony. GrovBase skraca ten cykl do kilku minut, a koszt do ułamka." },
    }, visible: true, audience: "everyone", show_from: null, show_until: null, sort_order: 2, analytics_id: null },
  { id: "cd1e9221-f9d3-4d67-a0c6-154d73b4d00e", code: {}, type: "benefits", style: { base: { columns: 3, background: "sunken" } }, anchor: null,
    content: {
      items: [
        { icon: "shield", title: { de: "Treue vor Kreativität", en: "Fidelity before creativity", pl: "Wierność przed kreatywnością" }, description: { de: "Ein schönes Foto eines fremden Produkts ist wertlos. Form, Farbe und Detail zählen mehr als künstlerischer Effekt.", en: "A beautiful photo of somebody else's product is worthless. Shape, colour and detail matter more than artistic effect.", pl: "Ładne zdjęcie cudzego produktu jest bezwartościowe. Kształt, kolor i detal są ważniejsze niż efekt artystyczny." } },
        { icon: "zap", title: { de: "Keine Abhängigkeit von einem Anbieter", en: "No single-vendor lock-in", pl: "Bez uzależnienia od jednego dostawcy" }, description: { de: "KI-Modelle ändern sich alle paar Monate. GrovBase wählt das Modell zur Aufgabe und tauscht es, sobald ein besseres kommt.", en: "AI models change every few months. GrovBase picks the model for the job and swaps it when a better one appears.", pl: "Modele AI zmieniają się co kilka miesięcy. GrovBase dobiera model do zadania i wymienia go, kiedy pojawi się lepszy." } },
        { icon: "eye", title: { de: "Kein Vortäuschen", en: "No pretending", pl: "Bez udawania" }, description: { de: "Eine Funktion, die noch nicht läuft, sagt das auch. Wir zeigen keine Buttons, die nichts tun.", en: "A feature that does not work yet says so. We do not show buttons that do nothing.", pl: "Funkcja, która jeszcze nie działa, jest opisana jako niedostępna. Nie pokazujemy przycisków, które nic nie robią." } },
      ],
      title: { de: "Unser Ansatz", en: "How we work", pl: "Nasze podejście" },
    }, visible: true, audience: "everyone", show_from: null, show_until: null, sort_order: 3, analytics_id: null },
  { id: "70cf6de5-d534-4952-8f3b-1e00693f8765", code: {}, type: "text", style: { base: { width: "narrow" } }, anchor: null,
    content: {
      title: { de: "Für wen", en: "Who it is for", pl: "Dla kogo" },
      description: { de: "Für Verkäufer auf Allegro und Amazon, Onlineshops, Eigenmarken, Importeure und Großhändler — überall dort, wo das Sortiment größer ist als das Fotobudget.", en: "For sellers on Allegro and Amazon, online shops, own brands, importers and wholesalers — wherever the range is larger than the photography budget.", pl: "Dla sprzedawców na Allegro i Amazon, sklepów internetowych, marek własnych, importerów i hurtowni — wszędzie tam, gdzie asortyment jest większy niż budżet na fotografię." },
    }, visible: true, audience: "everyone", show_from: null, show_until: null, sort_order: 4, analytics_id: null },
  { id: "9afbac84-49e0-4685-bfad-b0bdeb51613a", code: {}, type: "cta", style: { base: { align: "center", background: "gradient" } }, anchor: null,
    content: {
      title: { de: "Beginne mit einem Produkt", en: "Start with one product", pl: "Zacznij od jednego produktu" },
      ctaUrl: "/register", cta2Url: "/kontakt",
      ctaLabel: { de: "Kostenlos starten", en: "Start for free", pl: "Zacznij za darmo" },
      cta2Label: { de: "Schreib uns", en: "Write to us", pl: "Napisz do nas" },
    }, visible: true, audience: "everyone", show_from: null, show_until: null, sort_order: 5, analytics_id: null },
];

const HARNESS_FILES = {
  "shell.tsx": SHELL_SRC,
  "home/page.tsx": HOME_SRC,
  "tools/page.tsx": TOOLS_SRC,
  "cms/page.tsx": CMS_SRC,
  "cms/fixture.json": JSON.stringify(CMS_FIXTURE, null, 2) + "\n",
};

/**
 * A FAKE SUPABASE, FOR A SANDBOX THAT CANNOT REACH THE REAL ONE.
 *
 * NEXT_PUBLIC_SUPABASE_URL is inlined at build time, so the server cannot be
 * re-pointed at `next start`. Instead this preload (NODE_OPTIONS="--require
 * <file>") wraps the server's global fetch, before Next patches it, and
 * answers every *.supabase.co request itself: the public price list for
 * subscription_plans / credit_packages (a fixed catalogue in the shape of the
 * production one, with made-up ids), `[]` for every other table, "function
 * not found" (PGRST202, what an RPC that does not exist answers) for every
 * RPC, and "no session" for auth. Deterministic, instant, identical for both
 * builds — and nothing ever leaves the machine. Unset, the servers talk to
 * whatever SUPABASE_URL they were built with.
 */
const FAKE_SUPABASE_SRC = `/* written by scripts/ice-visual-probe.mjs --fake-supabase */
"use strict";
const fs = require("node:fs");
const uuid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const plan = (n, slug, name, cents, credits, featured, features) => ({
  id: uuid(n), slug, name, description: null, price_cents: cents, annual_price_cents: 0, currency: "PLN",
  monthly_credits: credits, bonus_credits: 0, featured, features,
  stripe_price_id_monthly: cents ? "price_probe_" + slug : null, stripe_price_id_annual: null,
  stripe_price_monthly_cents: cents ? cents : null, stripe_price_annual_cents: null,
  stripe_sync_status: cents ? "synced" : "unknown", sort_order: n - 1, active: true,
});
const pack = (n, credits, bonus, cents) => ({
  id: uuid(100 + n), credits, bonus_credits: bonus, price_cents: cents, currency: "PLN",
  stripe_price_id: "price_probe_pack" + n, stripe_price_cents: cents, stripe_sync_status: "synced", sort_order: n - 1, active: true,
});
const TABLES = {
  subscription_plans: [
    plan(1, "free", "Free", 0, 25, false, { products: 5, workspace_members: 1 }),
    plan(2, "starter", "Starter", 9900, 300, false, { products: 50, workspace_members: 2 }),
    plan(3, "pro", "Pro", 29900, 1200, true, { products: 500, priority_queue: true, workspace_members: 5 }),
    plan(4, "agency", "Agency", 99900, 5000, false, { products: -1, operator_mode: true, priority_queue: true, workspace_members: -1 }),
  ],
  credit_packages: [pack(1, 100, 0, 1900), pack(2, 500, 50, 7900), pack(3, 1000, 150, 13900), pack(4, 2500, 500, 29900)],
};
const LOG = process.env.ICE_VR_FAKE_LOG || null;
const json = (status, body, extra) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", ...(extra || {}) },
});
const origin = globalThis.fetch;
globalThis.fetch = async function fakeSupabaseFetch(input, init) {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
  let url;
  try { url = new URL(href); } catch { return origin(input, init); }
  if (!url.hostname.endsWith(".supabase.co")) return origin(input, init);
  const method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
  const headers = new Headers((init && init.headers) || (input && typeof input === "object" && input.headers) || undefined);
  if (LOG) { try { fs.appendFileSync(LOG, method + " " + url.pathname + url.search + "\\n"); } catch {} }
  const p = url.pathname;
  if (p.startsWith("/rest/v1/rpc/")) {
    return json(404, { code: "PGRST202", details: null, hint: null, message: "Could not find the function " + p.slice(13) + " in the schema cache" });
  }
  if (p.startsWith("/rest/v1/")) {
    const rows = TABLES[p.slice(9)] || [];
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "*/" + rows.length } });
    if (method !== "GET") return json(201, []);
    if ((headers.get("accept") || "").includes("vnd.pgrst.object")) {
      return rows.length === 1 ? json(200, rows[0])
        : json(406, { code: "PGRST116", details: "The result contains " + rows.length + " rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" });
    }
    return json(200, rows, { "content-range": rows.length ? "0-" + (rows.length - 1) + "/" + rows.length : "*/0" });
  }
  if (p.startsWith("/auth/v1/")) return json(401, { code: 401, error_code: "no_authorization", msg: "This endpoint requires a valid Bearer token" });
  return json(404, { message: "not found" });
};
`;

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

if (argv[0] === "--fake-supabase") {
  const out = path.resolve(argv[1] ?? "fake-supabase.cjs");
  fs.writeFileSync(out, FAKE_SUPABASE_SRC);
  console.log(`fake Supabase preload written to ${out} — start each server with NODE_OPTIONS="--require ${out}"`);
  process.exit(0);
}

if (argv[0] === "--harness" || argv[0] === "--clean") {
  const root = path.resolve(argv[1] ?? ".");
  const dir = path.join(root, HARNESS_DIR);
  if (argv[0] === "--harness") {
    for (const [file, src] of Object.entries(HARNESS_FILES)) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), src);
    }
    console.log(`harness written to ${dir}`);
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
    const parent = path.join(root, "app/probe-tmp");
    if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmSync(parent, { recursive: true });
    console.log("harness removed");
  }
  process.exit(0);
}

/* ── configuration ─────────────────────────────────────────────────────── */

const positional = argv.filter((a) => !a.startsWith("--"));
const OLD = (positional[0] ?? "http://127.0.0.1:3301").replace(/\/$/, "");
const NEW = (positional[1] ?? "http://127.0.0.1:3302").replace(/\/$/, "");
const OUT = path.resolve(positional[2] ?? "ice-vr-out");
const SHOTS = path.join(OUT, "shots");
const OLD_DIR = flag("old-dir");
const NEW_DIR = flag("new-dir");
const REPS = Number(flag("reps") ?? 2);
const ONLY = flag("pages")?.split(",") ?? null;
/** The height both sides' focus section is pinned to for the shift-free capture. */
const PIN = Number(flag("pin") ?? 600);
/** A channel difference above this is a real change; at or below it, anti-aliasing. */
const TOL = Number(flag("tol") ?? 24);
/** Tallest viewport the capture grows to (Chromium's texture limit is 16384). */
const MAX_H = 16000;
fs.mkdirSync(SHOTS, { recursive: true });

/** Each page: the address a customer types, and — for the signed-in or
 *  CMS-backed ones — the harness page the browser is given instead. `focus`
 *  names the one element whose change is intended. */
const HARNESS_URL = `/${HARNESS_DIR.replace(/^app\//, "")}`;
const PAGES = [
  { id: "plany", path: "/plany" },
  { id: "landing", path: "/" },
  { id: "regulamin", path: "/regulamin" },
  { id: "home", path: "/home", harness: `${HARNESS_URL}/home`, focus: "[data-seller-before-after]" },
  { id: "tools", path: "/tools", harness: `${HARNESS_URL}/tools` },
  { id: "cms", path: "/o-nas", harness: `${HARNESS_URL}/cms` },
].filter((p) => !ONLY || ONLY.includes(p.id));
const ALL_PAGES = PAGES;
const VIEWPORTS = [[390, 844], [834, 1112], [1440, 900]];
const THEMES = ["light", "dark"];

function executablePath() {
  for (const p of [process.env.PLAYWRIGHT_CHROMIUM_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"]) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: executablePath() });
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const results = { old: OLD, new: NEW, startedAt: new Date().toISOString(), tol: TOL, pin: PIN, theme: null, shots: [], checks: {} };

/** A browser context in which `base` serves the page, the signed-in /
 *  CMS addresses are answered by the harness, and nothing leaves localhost
 *  (aborted and logged — both sides see the same failures). */
async function openContext(base, { width, height, theme, cookies = [] }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce",
    colorScheme: theme ?? "dark", locale: "pl-PL", timezoneId: "Europe/Warsaw",
  });
  await ctx.addCookies([{ name: "ecs_locale", value: "pl", url: base }, ...cookies.map((c) => ({ ...c, url: base }))]);
  if (theme) {
    await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch { /* none */ } }, theme);
  }
  const external = new Set();
  const origin = new URL(base).origin;
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.add(url.host); return route.abort().catch(() => {}); }
    const page = ALL_PAGES.find((p) => p.harness && p.path === url.pathname);
    if (page) {
      url.pathname = page.harness;
      try {
        const response = await route.fetch({ url: url.toString() });
        return await route.fulfill({ response });
      } catch { return route.abort().catch(() => {}); }
    }
    return route.continue().catch(() => {});
  });
  return { ctx, external };
}

/** Load, let every lazy picture and every reveal happen, come back to the top. */
async function settlePage(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y); await new Promise((r) => setTimeout(r, 70));
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => Promise.all([...document.images].filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.decode().catch(() => {}))));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/** Geometry and overflow, on the settled page, at the real viewport. */
const measure = (page, focus) => page.evaluate((sel) => {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX)) return true;
    }
    return false;
  };
  const escapees = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 0.5 || r.left < -0.5) && !inScroller(el) && getComputedStyle(el).position !== "fixed") {
      escapees.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} [${Math.round(r.left)},${Math.round(r.right)}]`);
    }
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  const f = sel ? document.querySelector(sel) : null;
  const fr = f?.getBoundingClientRect();
  const frame = f?.querySelector("[data-ba-card] .overflow-hidden")?.getBoundingClientRect();
  return {
    dark: doc.classList.contains("dark"), vw, scrollWidth: doc.scrollWidth, height: doc.scrollHeight,
    escapees: escapees.slice(0, 8), escapeCount: escapees.length,
    focus: fr ? { top: r2(fr.top + scrollY), bottom: r2(fr.bottom + scrollY), height: r2(fr.height) } : null,
    baFrame: frame ? { w: r2(frame.width), h: r2(frame.height) } : null,
    baCards: f ? f.querySelectorAll("[data-ba-card]").length : null,
    brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 5),
    iceLaunch: document.querySelectorAll("[data-ice-launch]").length,
  };
}, focus ?? null);

/**
 * THE CAPTURE. Playwright's fullPage capture on Chromium renders "beyond the
 * viewport" by resizing the frame for the duration of the capture — which
 * wakes ResizeObservers mid-capture (the /home tool carousel re-anchors on
 * every width change and was caught one card further along, and consecutive
 * captures of one load differed). So the viewport itself is grown to the
 * page's own height first (repeated until the height holds; the pages only
 * use viewport height for `min-h-dvh` wrappers, which then equal the content),
 * the page settles at that size, and the capture is an ordinary viewport
 * capture with nothing resized under it.
 */
async function capture(page, file) {
  const width = page.viewportSize().width;
  let H = 0, grown = true;
  for (let k = 0; k < 6; k++) {
    H = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (H === page.viewportSize().height) break;
    if (H > MAX_H) { grown = false; break; }
    await page.setViewportSize({ width, height: H });
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: file, fullPage: !grown, animations: "disabled", caret: "hide" });
  return { height: H, grown };
}

async function shoot(base, pageDef, vp, theme, file, { pin = false } = {}) {
  const { ctx, external } = await openContext(base, { width: vp[0], height: vp[1], theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  const resp = await page.goto(base + pageDef.path, { waitUntil: "load", timeout: 60000 });
  await settlePage(page);
  const m = await measure(page, pageDef.focus);
  if (pin && pageDef.focus) {
    // The same outer height on both sides: everything after the section sits
    // at the same place, so any pixel outside it that differs is a real change.
    await page.addStyleTag({ content: `${pageDef.focus}{height:${PIN}px!important;min-height:0!important;max-height:none!important;overflow:hidden!important}` });
    await page.waitForTimeout(300);
    m.pinned = (await measure(page, pageDef.focus)).focus;
  }
  const cap = await capture(page, file);
  await ctx.close();
  return { status: resp?.status() ?? null, ...m, capture: cap, external: [...external], errors };
}

/* ── pixel diff (sharp raw buffers) ────────────────────────────────────── */

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Compare rows [ya, ya+rows) of A with rows [yb, yb+rows) of B over the
 *  common width: every differing pixel (`count`), those differing by more than
 *  TOL in some channel (`tolCount`), the largest channel difference, and the
 *  bounding boxes (in A's coordinates). */
function compareRegion(A, B, ya, yb, rows) {
  const w = Math.min(A.w, B.w);
  rows = Math.max(0, Math.min(rows, A.h - ya, B.h - yb));
  let count = 0, tolCount = 0, maxDelta = 0;
  const box = () => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1 });
  const all = box(), big = box();
  const grow = (b, x, y) => { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; };
  for (let r = 0; r < rows; r++) {
    const ra = (ya + r) * A.w * 4, rb = (yb + r) * B.w * 4;
    for (let x = 0; x < w; x++) {
      const ia = ra + x * 4, ib = rb + x * 4;
      const d = Math.max(Math.abs(A.data[ia] - B.data[ib]), Math.abs(A.data[ia + 1] - B.data[ib + 1]), Math.abs(A.data[ia + 2] - B.data[ib + 2]), Math.abs(A.data[ia + 3] - B.data[ib + 3]));
      if (d) {
        count++; if (d > maxDelta) maxDelta = d; grow(all, x, ya + r);
        if (d > TOL) { tolCount++; grow(big, x, ya + r); }
      }
    }
  }
  const out = (b) => (b.x1 < 0 ? null : { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 });
  return { rows, pixels: w * rows, count, tolCount, maxDelta, bbox: out(all), tolBbox: out(big) };
}

/** Whole-image diff, top-aligned; rows only one image has count as differing. */
async function diffFiles(fa, fb, outFile) {
  const A = await raw(fa), B = await raw(fb);
  const W = Math.max(A.w, B.w), H = Math.max(A.h, B.h);
  const common = compareRegion(A, B, 0, 0, Math.min(A.h, B.h));
  const extra = (H - Math.min(A.h, B.h)) * W + (A.w !== B.w ? Math.abs(A.w - B.w) * Math.min(A.h, B.h) : 0);
  const count = common.count + extra, tolCount = common.tolCount + extra;
  let bbox = common.bbox;
  if (extra > 0) {
    const y = Math.min(A.h, B.h);
    bbox = bbox ? { x: 0, y: bbox.y, w: W, h: H - bbox.y } : { x: 0, y, w: W, h: H - y };
  }
  if (outFile && count > 0) {
    // The old picture faded to grey; red = a real difference (> TOL), orange =
    // anti-aliasing-level (≤ TOL), magenta = rows only one side has.
    const out = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (!(x < A.w && y < A.h && x < B.w && y < B.h)) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 255; out[o + 3] = 255; continue; }
      const ia = (y * A.w + x) * 4, ib = (y * B.w + x) * 4;
      const d = Math.max(Math.abs(A.data[ia] - B.data[ib]), Math.abs(A.data[ia + 1] - B.data[ib + 1]), Math.abs(A.data[ia + 2] - B.data[ib + 2]));
      if (d === 0) {
        const g = Math.round(0.3 * A.data[ia] + 0.59 * A.data[ia + 1] + 0.11 * A.data[ia + 2]);
        const v = Math.round(200 + g * 55 / 255);
        out[o] = v; out[o + 1] = v; out[o + 2] = v;
      } else if (d > TOL) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; }
      else { out[o] = 255; out[o + 1] = 150; out[o + 2] = 0; }
      out[o + 3] = 255;
    }
    await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(outFile);
  }
  return {
    a: { w: A.w, h: A.h }, b: { w: B.w, h: B.h }, count, tolCount, maxDelta: common.maxDelta,
    pct: (100 * count) / (W * H), tolPct: (100 * tolCount) / (W * H), bbox, tolBbox: common.tolBbox, A, B,
  };
}

const slim = (d) => ({ count: d.count, tolCount: d.tolCount, maxDelta: d.maxDelta, pct: d.pct, bbox: d.bbox, tolBbox: d.tolBbox });
const verdictOf = (d) => (d.count === 0 ? "identical" : d.tolCount === 0 ? `anti-aliasing only (max Δ${d.maxDelta})` : "DIFFERS");

/* ── 0. which theme switch works ───────────────────────────────────────── */

console.log("\n0. THEME: what decides light/dark");
{
  const out = {};
  for (const [label, scheme, stored] of [
    ["prefers light, nothing stored", "light", null],
    ["prefers dark, nothing stored", "dark", null],
    ["localStorage theme=light (prefers dark)", "dark", "light"],
    ["localStorage theme=dark (prefers light)", "light", "dark"],
    ["localStorage theme=system, prefers light", "light", "system"],
    ["localStorage theme=system, prefers dark", "dark", "system"],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    if (stored) await ctx.addInitScript((t) => localStorage.setItem("theme", t), stored);
    await ctx.route("**/*", (r) => (new URL(r.request().url()).origin === new URL(NEW).origin ? r.continue() : r.abort()));
    const p = await ctx.newPage();
    await p.goto(`${NEW}/regulamin`, { waitUntil: "load" });
    out[label] = (await p.evaluate(() => document.documentElement.classList.contains("dark"))) ? "dark" : "light";
    await ctx.close();
    console.log(`  ${label}: <html> is ${out[label]}`);
  }
  results.theme = out;
}

/* ── 1. screenshots and pixel diffs ────────────────────────────────────── */

console.log("\n1. SCREENSHOTS, OLD vs NEW (and the noise floor)");
for (const pg of PAGES) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const tag = `${pg.id}-${vp[0]}-${theme}`;
      const f = (s) => path.join(SHOTS, `${tag}-${s}.png`);
      const mo = await shoot(OLD, pg, vp, theme, f("old"));
      const mn = await shoot(NEW, pg, vp, theme, f("new"));
      const noise = {};
      if (REPS > 1) {
        const mo2 = await shoot(OLD, pg, vp, theme, f("old2"));
        const mn2 = await shoot(NEW, pg, vp, theme, f("new2"));
        const no = await diffFiles(f("old"), f("old2"), f("noise-old"));
        const nn = await diffFiles(f("new"), f("new2"), f("noise-new"));
        noise.old = slim(no); noise.new = slim(nn);
        noise.heights = { old: [mo.capture.height, mo2.capture.height], new: [mn.capture.height, mn2.capture.height] };
      }
      const d = await diffFiles(f("old"), f("new"), f("diff"));
      const row = {
        page: pg.id, path: pg.path, width: vp[0], theme, tag,
        status: { old: mo.status, new: mn.status },
        darkApplied: { old: mo.dark, new: mn.dark },
        size: { old: d.a, new: d.b }, capture: { old: mo.capture, new: mn.capture },
        diff: slim(d), verdict: verdictOf(d),
        noise,
        overflow: { old: { sw: mo.scrollWidth, vw: mo.vw, escapes: mo.escapeCount, list: mo.escapees }, new: { sw: mn.scrollWidth, vw: mn.vw, escapes: mn.escapeCount, list: mn.escapees } },
        brokenImages: { old: mo.brokenImages, new: mn.brokenImages },
        pageErrors: { old: mo.errors, new: mn.errors },
        external: [...new Set([...mo.external, ...mn.external])],
        iceLaunch: { old: mo.iceLaunch, new: mn.iceLaunch },
      };
      if (pg.focus && mo.focus && mn.focus) {
        // NATURAL: above the section, then below it re-aligned on its bottom
        // edge — at the best whole-pixel offset (the height change can be
        // fractional, and then nothing below can be bit-identical).
        const above = compareRegion(d.A, d.B, 0, 0, Math.floor(Math.min(mo.focus.top, mn.focus.top)));
        const startOld = Math.ceil(mo.focus.bottom);
        const shift = mn.focus.bottom - mo.focus.bottom;
        let below = null;
        for (const s of [Math.floor(shift), Math.ceil(shift), Math.round(shift) - 1, Math.round(shift) + 1]) {
          const c = compareRegion(d.A, d.B, startOld, startOld + s, d.A.h - startOld);
          if (!below || c.count < below.count) below = { ...c, offset: s };
        }
        // PINNED: both sides' section forced to the same outer height.
        const po = await shoot(OLD, pg, vp, theme, f("old-pinned"), { pin: true });
        const pn = await shoot(NEW, pg, vp, theme, f("new-pinned"), { pin: true });
        const pd = await diffFiles(f("old-pinned"), f("new-pinned"), f("diff-pinned"));
        const top = Math.floor(Math.min(po.pinned.top, pn.pinned.top));
        const bottom = Math.ceil(Math.max(po.pinned.bottom, pn.pinned.bottom));
        const pAbove = compareRegion(pd.A, pd.B, 0, 0, top);
        const pInside = compareRegion(pd.A, pd.B, top, top, bottom - top);
        const pBelow = compareRegion(pd.A, pd.B, bottom, bottom, pd.A.h - bottom);
        row.focus = {
          selector: pg.focus, old: mo.focus, new: mn.focus,
          heightDelta: Math.round((mn.focus.height - mo.focus.height) * 100) / 100,
          pageHeightDelta: mn.height - mo.height, baFrame: { old: mo.baFrame, new: mn.baFrame }, baCards: { old: mo.baCards, new: mn.baCards },
          natural: { above: { rows: above.rows, ...slim(above) }, below: { offset: below.offset, rows: below.rows, ...slim(below) } },
          pinned: {
            height: PIN, sizes: { old: pd.a, new: pd.b }, section: { top, bottom },
            whole: slim(pd), above: slim(pAbove), inside: slim(pInside), below: slim(pBelow),
          },
        };
        delete pd.A; delete pd.B;
      }
      results.shots.push(row);
      const nz = REPS > 1 ? ` | noise old ${noise.old.count}px(${noise.old.tolCount}>Δ${TOL}) new ${noise.new.count}px(${noise.new.tolCount}>Δ${TOL})` : "";
      console.log(`  ${tag}: ${row.verdict} ${d.count}px (${d.tolCount} >Δ${TOL}) bbox ${JSON.stringify(d.bbox)} (${d.a.w}×${d.a.h} → ${d.b.w}×${d.b.h})${nz}`);
      if (row.focus) {
        const fx = row.focus;
        console.log(`    BA section ${fx.old.height}→${fx.new.height}px (Δ${fx.heightDelta}), frame ${JSON.stringify(fx.baFrame.old)}→${JSON.stringify(fx.baFrame.new)}, page ${mo.height}→${mn.height}`);
        console.log(`    natural: above ${fx.natural.above.count}px; below re-aligned (offset ${fx.natural.below.offset}) ${fx.natural.below.count}px, ${fx.natural.below.tolCount} >Δ${TOL}, max Δ${fx.natural.below.maxDelta}`);
        console.log(`    pinned ${PIN}px: above ${fx.pinned.above.count}px, inside ${fx.pinned.inside.count}px, below ${fx.pinned.below.count}px (sizes ${JSON.stringify(fx.pinned.sizes)})`);
      }
      delete d.A; delete d.B;
    }
  }
}

/* ── HTML: markup and flight payload, normalised ───────────────────────── */

async function getHtml(base, p, cookie) {
  const res = await fetch(base + p, { headers: { ...(cookie ? { cookie } : {}), "accept-language": "pl" }, redirect: "manual" });
  return { status: res.status, html: await res.text() };
}

const buildIdOf = (dir) => {
  try { return dir ? fs.readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8").trim() : null; } catch { return null; }
};
const OLD_BUILD = buildIdOf(OLD_DIR), NEW_BUILD = buildIdOf(NEW_DIR);

/** Asset names without content hashes or webpack's numeric chunk ids. */
function normAssets(s) {
  return s
    .replace(/static\/chunks\/\d+-[0-9a-f]{8,}\.js/g, "static/chunks/N.js")
    .replace(/static\/chunks\/([\w\-/[\]().%@]+?)-[0-9a-f]{8,}\.js/g, "static/chunks/$1.js")
    .replace(/static\/chunks\/[0-9a-f]{8,}\.js/g, "static/chunks/H.js")
    .replace(/static\/css\/[0-9a-f]{8,}\.css/g, "static/css/H.css")
    .replace(/static\/media\/([\w\-.]+?)\.[0-9a-f]{8,}\.(\w+)/g, "static/media/$1.$2")
    .replace(/nonce="[^"]*"/g, 'nonce="N"');
}

/** Every distinct React useId renamed by order of first appearance — a pure
 *  renaming leaves the text equal; anything else does not. */
function renameIds(s) {
  const map = new Map();
  return s.replace(/_R_[0-9A-Za-z]+_/g, (m) => {
    if (!map.has(m)) map.set(m, `_R_${map.size + 1}_`);
    return map.get(m);
  });
}

/** The page's markup (inline flight scripts taken out) and its flight payload. */
function splitHtml(html, buildId) {
  const parts = [];
  let markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (all, attrs, body) => {
    const m = /^\s*self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?\s*$/.exec(body);
    if (!m) return all;
    try {
      const arr = JSON.parse(m[1]);
      parts.push(arr[0] === 1 && typeof arr[1] === "string" ? arr[1] : `\n[[push ${JSON.stringify(arr).slice(0, 60)}]]\n`);
    } catch { parts.push("\n[[unparsed push]]\n"); }
    return `<script${attrs}>FLIGHT</script>`;
  });
  if (buildId) markup = markup.split(buildId).join("BUILD");
  // Next splits the payload into scripts at arbitrary byte offsets: how MANY
  // scripts there are says nothing about the page.
  markup = markup.replace(/(<script>FLIGHT<\/script>)+/g, "<script>FLIGHT…</script>");
  let flight = parts.join("");
  if (buildId) flight = flight.split(buildId).join("BUILD");
  return { markup: renameIds(normAssets(markup)), flight };
}

/** Flight rows (`<hex id>:<row>\n`, text rows `<id>:T<hex byte length>,<text>`). */
function parseRows(payload) {
  const buf = Buffer.from(payload, "utf8");
  const rows = [];
  let i = 0;
  while (i < buf.length) {
    let j = i;
    while (j < buf.length && buf[j] !== 0x3a && buf[j] !== 0x0a) j++;
    const id = buf.subarray(i, j).toString();
    if (buf[j] !== 0x3a || !/^[0-9a-f]+$/.test(id)) {
      let k = buf.indexOf(0x0a, i); if (k < 0) k = buf.length;
      rows.push({ id: null, body: buf.subarray(i, k).toString() }); i = k + 1; continue;
    }
    j++;
    if (buf[j] === 0x54 /* T */) {
      let k = j + 1; while (k < buf.length && buf[k] !== 0x2c) k++;
      const len = parseInt(buf.subarray(j + 1, k).toString(), 16);
      rows.push({ id, body: "T" + buf.subarray(k + 1, k + 1 + len).toString() });
      i = k + 1 + len; continue;
    }
    let k = buf.indexOf(0x0a, j); if (k < 0) k = buf.length;
    rows.push({ id, body: buf.subarray(j, k).toString() });
    i = k + 1;
  }
  return rows;
}

/**
 * Rows renamed by CONTENT: a row's name is the hash of its normalised body,
 * with every reference to another row replaced by that row's name. An
 * inserted or renumbered row then disturbs nothing else; a changed row
 * changes its own name and, through it, its ancestors' (reported as
 * "propagated").
 */
function canonicalFlight(payload) {
  const rows = parseRows(payload);
  const byId = new Map(rows.filter((r) => r.id).map((r) => [r.id, r]));
  const REF = /"\$([A-Za-z@]?)([0-9a-f]+)((?::[^"]*)?)"/g;
  const norm = (b) => renameIds(normAssets(b))
    .replace(/^I\[\d+,/, "I[M,")
    .replace(/"\d+","static\/chunks\//g, '"C","static/chunks/')
    .replace(/"[0-9a-f]{40,44}"/g, '"ACTION_ID"');
  const memo = new Map(), visiting = new Set();
  const canon = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return "cycle";
    visiting.add(id);
    const r = byId.get(id);
    const body = norm(r.body).replace(REF, (m, t, rid, rest) => (byId.has(rid) ? `"$${t}<${canon(rid)}>${rest}"` : m));
    r.canon = body;
    const name = sha(body).slice(0, 10);
    visiting.delete(id); memo.set(id, name);
    return name;
  };
  for (const r of rows) if (r.id) canon(r.id);
  return rows.map((r) => (r.id ? r.canon : `RAW ${norm(r.body)}`)).filter((s) => s !== "RAW ");
}

function multisetDiff(a, b) {
  const count = (l) => { const m = new Map(); for (const x of l) m.set(x, (m.get(x) ?? 0) + 1); return m; };
  const A = count(a), B = count(b);
  const onlyA = [], onlyB = [];
  for (const [x, n] of A) for (let k = B.get(x) ?? 0; k < n; k++) onlyA.push(x);
  for (const [x, n] of B) for (let k = A.get(x) ?? 0; k < n; k++) onlyB.push(x);
  return { onlyA, onlyB };
}

/** The changed window of two similar strings. */
function windowDiff(a, b) {
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0; while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const from = Math.max(0, p - 60);
  return { at: p, old: a.slice(from, a.length - s + 30), new: b.slice(from, b.length - s + 30) };
}

/** Pair up rows only one side has: same shape apart from child-row names =
 *  "propagated"; otherwise the changed window; unpaired = added / removed. */
function explainRows(onlyA, onlyB) {
  const shape = (s) => s.replace(/<[0-9a-f]{10}>|<cycle>/g, "<*>");
  const out = [];
  const restB = [...onlyB];
  for (const a of onlyA) {
    let best = -1, bestP = -1;
    restB.forEach((b, k) => {
      if (shape(a) === shape(b)) { if (bestP < Infinity) { best = k; bestP = Infinity; } return; }
      let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
      if (p > bestP && p >= Math.min(12, a.length)) { best = k; bestP = p; }
    });
    if (best < 0) { out.push({ kind: "only-old", row: a.slice(0, 300) }); continue; }
    const b = restB.splice(best, 1)[0];
    if (shape(a) === shape(b)) out.push({ kind: "propagated", row: shape(a).slice(0, 120) });
    else out.push({ kind: "changed", ...windowDiff(a, b) });
  }
  for (const b of restB) out.push({ kind: "only-new", row: b.slice(0, 300) });
  return out;
}

/** Markup lines (one tag per line) and flight rows that differ. */
function compareHtml(htmlA, buildA, htmlB, buildB) {
  const A = splitHtml(htmlA, buildA), B = splitHtml(htmlB, buildB);
  const lines = (s) => s.replace(/></g, ">\n<").split("\n");
  const md = multisetDiff(lines(A.markup), lines(B.markup));
  const fd = multisetDiff(canonicalFlight(A.flight), canonicalFlight(B.flight));
  return {
    markupIdentical: A.markup === B.markup,
    markup: { onlyOld: md.onlyA.map((l) => l.slice(0, 300)), onlyNew: md.onlyB.map((l) => l.slice(0, 300)) },
    flightIdentical: fd.onlyA.length === 0 && fd.onlyB.length === 0,
    flight: explainRows(fd.onlyA, fd.onlyB),
    markupA: A.markup, markupB: B.markup,
  };
}

function printCompare(c) {
  for (const l of c.markup.onlyOld.slice(0, 8)) console.log(`      markup - ${l.slice(0, 200)}`);
  for (const l of c.markup.onlyNew.slice(0, 8)) console.log(`      markup + ${l.slice(0, 200)}`);
  for (const r of c.flight.slice(0, 12)) {
    if (r.kind === "changed") console.log(`      flight ~ …${r.old.slice(0, 220)}…\n             → …${r.new.slice(0, 220)}…`);
    else console.log(`      flight ${r.kind}: ${r.row.slice(0, 220)}`);
  }
}

/* ── network helpers ───────────────────────────────────────────────────── */

/** Files in a build's .next/static that contain a marker. */
function staticFilesWith(dir, marker, ext) {
  if (!dir) return [];
  const root = path.join(dir, ".next/static");
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(ext) && fs.readFileSync(p, "utf8").includes(marker)) out.push(path.relative(path.join(dir, ".next"), p));
    }
  };
  walk(root);
  return out;
}

/** Every same-origin JS/CSS response of one visit, with its bytes. */
async function assets(base, p, cookies = []) {
  const { ctx } = await openContext(base, { width: 1440, height: 900, theme: "dark", cookies });
  const page = await ctx.newPage();
  const got = [];
  page.on("response", async (res) => {
    const u = new URL(res.url());
    if (u.origin !== new URL(base).origin) return;
    if (!/\.(js|css)$/.test(u.pathname)) return;
    try {
      const body = await res.body();
      got.push({ path: u.pathname, bytes: body.length, gzip: zlib.gzipSync(body, { level: 9 }).length, sha: sha(body), type: u.pathname.endsWith(".css") ? "css" : "js", body });
    } catch { got.push({ path: u.pathname, bytes: null, type: "?" }); }
  });
  await page.goto(base + p, { waitUntil: "load" });
  await settlePage(page);
  await page.waitForTimeout(500);
  const dom = await page.evaluate(() => ({
    iceLaunch: document.querySelectorAll("[data-ice-launch]").length,
    iceTarget: document.querySelectorAll("[data-ice-target]").length,
    markers: /\u2060[\u200c\u200d]/.test(document.body.innerText + document.title),
  }));
  await ctx.close();
  return { list: got, dom };
}

const stripHash = (p) => p.replace(/\/\d+-[0-9a-f]{8,}\.js$/, "/N.js").replace(/-[0-9a-f]{8,}(\.js|\.css)$/, "$1").replace(/\/[0-9a-f]{8,}(\.js|\.css)$/, "/HASH$1");

/** Webpack module bodies of a chunk (Next's production chunk format). */
function modulesOf(src) {
  const out = new Map();
  const at = src.indexOf("push([[");
  if (at < 0) return out;
  let i = src.indexOf("{", at) + 1;
  while (i > 0 && i < src.length) {
    const m = /^\s*(\d+):/.exec(src.slice(i, i + 24));
    if (!m) break;
    let j = i + m[0].length, depth = 0, inStr = null, began = false;
    for (; j < src.length; j++) {
      const c = src[j];
      if (inStr) { if (c === "\\") { j++; continue; } if (c === inStr) inStr = null; continue; }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "{" || c === "(" || c === "[") { depth++; began = true; }
      else if (c === "}" || c === ")" || c === "]") { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0 && began) break;
    }
    out.set(m[1], src.slice(i + m[0].length, j));
    if (src[j] === "}") break;
    i = j + 1;
  }
  return out;
}
const tellOf = (body) => (body.match(/"[^"\\]{5,48}"/g) ?? []).filter((s) => s !== '"use strict"').slice(0, 4).join(" ");

/** Top-level CSS rules, `@media … :: selector{decls}`, one per selector. */
function cssEntries(css) {
  const out = [];
  let start = 0; const prefix = [];
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") {
      const head = css.slice(start, i).trim();
      if (/^@(media|supports|container|layer)/.test(head)) { prefix.push(head); start = i + 1; continue; }
      let d = 1, j = i + 1; for (; j < css.length && d; j++) { if (css[j] === "{") d++; else if (css[j] === "}") d--; }
      const decls = css.slice(i + 1, j - 1);
      // Split the selector list at top-level commas.
      const sels = []; let depth = 0, s0 = 0;
      for (let k = 0; k < head.length; k++) {
        const ch = head[k];
        if (ch === "\\") { k++; continue; }
        if (ch === "(" || ch === "[") depth++; else if (ch === ")" || ch === "]") depth--;
        else if (ch === "," && depth === 0) { sels.push(head.slice(s0, k)); s0 = k + 1; }
      }
      sels.push(head.slice(s0));
      for (const s of sels) out.push({ media: prefix.join(" "), selector: s.trim(), decls, key: `${prefix.join(" ")} :: ${s.trim()}{${decls}}` });
      i = j - 1; start = j;
    } else if (c === "}") { prefix.pop(); start = i + 1; }
  }
  return out;
}

/* ── a) CSS a visitor loads ────────────────────────────────────────────── */

console.log("\na) CSS FILES A VISITOR LOADS, OLD vs NEW");
const net = {};
const addedCss = new Map();
for (const p of ["/plany", "/", "/regulamin"]) {
  const o = await assets(OLD, p), n = await assets(NEW, p);
  net[p] = { o, n };
  const cssO = o.list.filter((x) => x.type === "css"), cssN = n.list.filter((x) => x.type === "css");
  const same = JSON.stringify(cssO.map((x) => x.sha).sort()) === JSON.stringify(cssN.map((x) => x.sha).sort());
  const hover = cssN.filter((x) => x.body.toString("utf8").includes("hoverLabel")).map((x) => x.path);
  // Rule-level diff of the files that changed.
  const shasN = new Set(cssN.map((x) => x.sha)), shasO = new Set(cssO.map((x) => x.sha));
  const changedO = cssO.filter((x) => !shasN.has(x.sha)), changedN = cssN.filter((x) => !shasO.has(x.sha));
  const eO = changedO.flatMap((x) => cssEntries(x.body.toString("utf8"))), eN = changedN.flatMap((x) => cssEntries(x.body.toString("utf8")));
  const kO = new Set(eO.map((e) => e.key)), kN = new Set(eN.map((e) => e.key));
  const added = eN.filter((e) => !kO.has(e.key)), removed = eO.filter((e) => !kN.has(e.key));
  const orderKept = JSON.stringify(eO.map((e) => e.key).filter((k) => kN.has(k))) === JSON.stringify(eN.map((e) => e.key).filter((k) => kO.has(k)));
  for (const e of added) addedCss.set(e.key, e);
  results.checks[`a ${p}`] = {
    pass: hover.length === 0 && removed.length === 0 && orderKept,
    identicalBytes: same,
    old: cssO.map(({ path: q, bytes, sha: h }) => ({ path: q, bytes, sha: h.slice(0, 16) })),
    new: cssN.map(({ path: q, bytes, sha: h }) => ({ path: q, bytes, sha: h.slice(0, 16) })),
    newCssWithHoverLabel: hover,
    rulesAdded: added.map((e) => e.key), rulesRemoved: removed.map((e) => e.key), commonRulesInSameOrder: orderKept,
  };
  console.log(`  ${p}: ${cssO.length} CSS old / ${cssN.length} new — ${same ? "byte-identical" : "NOT byte-identical"}; editor CSS (hoverLabel) loaded: ${hover.length ? hover.join(",") : "no"}`);
  for (const x of cssO) console.log(`    old ${x.path} ${x.bytes} B sha ${x.sha.slice(0, 16)}`);
  for (const x of cssN) console.log(`    new ${x.path} ${x.bytes} B sha ${x.sha.slice(0, 16)}`);
  if (!same) {
    console.log(`    rule-level: ${added.length} selector rule(s) added, ${removed.length} removed, every old rule kept in its order: ${orderKept}`);
    for (const e of added) console.log(`      + ${e.key.slice(0, 200)}`);
    for (const e of removed) console.log(`      - ${e.key.slice(0, 200)}`);
  }
}
// Does any added selector match anything on any page? (pseudo-elements dropped)
if (addedCss.size > 0) {
  const sels = [...new Set([...addedCss.values()].map((e) => e.selector.replace(/::?-webkit-[\w-]+|::[\w-]+/g, "")))];
  const matches = {};
  for (const pg of PAGES) {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      const { ctx } = await openContext(NEW, { width: w, height: h, theme: "light" });
      const page = await ctx.newPage();
      await page.goto(NEW + pg.path, { waitUntil: "load" });
      await settlePage(page);
      matches[`${pg.id}@${w}`] = await page.evaluate((list) => Object.fromEntries(list.map((s) => {
        try { return [s, document.querySelectorAll(s).length]; } catch { return [s, "invalid"]; }
      })), sels);
      await ctx.close();
    }
  }
  const hits = Object.entries(matches).flatMap(([k, v]) => Object.entries(v).filter(([, n]) => n !== 0).map(([s, n]) => `${k} ${s} → ${n}`));
  results.checks["a added-selectors-match-nothing"] = { pass: hits.length === 0, selectors: sels, hits, matches };
  console.log(`  added selectors matched on NEW pages (all 6 pages, 390 and 1440): ${hits.length ? hits.join("; ") : "none — every added rule is inert on these pages"}`);
}

/* ── b) anonymous HTML ─────────────────────────────────────────────────── */

console.log("\nb) ANONYMOUS HTML, OLD vs NEW (build ids, chunk names, useIds normalised)");
for (const p of ["/plany", "/", "/regulamin"]) {
  const o = await getHtml(OLD, p), n = await getHtml(NEW, p);
  const c = compareHtml(o.html, OLD_BUILD, n.html, NEW_BUILD);
  const rawUseIds = { old: new Set(o.html.match(/_R_[0-9A-Za-z]+_/g) ?? []).size, new: new Set(n.html.match(/_R_[0-9A-Za-z]+_/g) ?? []).size };
  results.checks[`b ${p}`] = {
    pass: c.markupIdentical && c.flightIdentical,
    status: { old: o.status, new: n.status }, bytes: { old: o.html.length, new: n.html.length }, distinctUseIds: rawUseIds,
    markupIdentical: c.markupIdentical, markup: c.markup, flightIdentical: c.flightIdentical, flight: c.flight,
  };
  const stem = p === "/" ? "landing" : p.slice(1);
  fs.writeFileSync(path.join(OUT, `html-${stem}-old.markup.html`), c.markupA);
  fs.writeFileSync(path.join(OUT, `html-${stem}-new.markup.html`), c.markupB);
  console.log(`  ${p}: markup ${c.markupIdentical ? "IDENTICAL" : "DIFFERS"}; flight ${c.flightIdentical ? "IDENTICAL" : `${c.flight.length} row(s) differ`} (${o.html.length} → ${n.html.length} bytes raw; ${rawUseIds.old}/${rawUseIds.new} distinct useIds)`);
  printCompare(c);
}

/* ── c) forged editor cookies on NEW ───────────────────────────────────── */

console.log("\nc) FORGED EDITOR COOKIES ON NEW (no session)");
/** FNV-1a, as lib/server/ice/session.ts names an edit cookie for a path. */
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
for (const p of ["/plany", "/", "/regulamin"]) {
  const plain = await getHtml(NEW, p);
  const variants = {
    "gb_ice=1 + gb_ice_e_deadbeef=abcdefgh~path": `gb_ice=1; gb_ice_e_deadbeef=abcdefgh~${p}`,
    "gb_ice=1 + gb_ice_e_<fnv(path)>=abcdefgh~path": `gb_ice=1; gb_ice_e_${fnv(p)}=abcdefgh~${p}`,
  };
  for (const [label, cookie] of Object.entries(variants)) {
    const forged = await getHtml(NEW, p, cookie);
    const h = forged.html;
    const launcher = h.includes("data-ice-launch");
    const markers = /\u2060[\u200c\u200d]/.test(h) || /\\u2060\\u200[cdCD]/.test(h);
    const anyInvisible = (h.match(/[\u2060\u200c\u200d]/g) ?? []).length;
    const iceNs = /"ice":\{/.test(h) || /\\"ice\\":\{/.test(h);
    const c = compareHtml(plain.html, NEW_BUILD, h, NEW_BUILD);
    const markupDelta = [...c.markup.onlyOld.map((l) => `- ${l}`), ...c.markup.onlyNew.map((l) => `+ ${l}`)];
    const onlySuspense = c.markup.onlyOld.length === 0 && c.markup.onlyNew.every((l) => l === "<!--$-->" || l === "<!--/$-->");
    results.checks[`c ${p} ${label}`] = {
      pass: forged.status === plain.status && !launcher && !markers && !iceNs && onlySuspense,
      status: forged.status, launcher, markers, invisibleChars: anyInvisible, iceNamespace: iceNs,
      markupIdentical: c.markupIdentical, markupDelta, flightIdentical: c.flightIdentical, flight: c.flight,
    };
    console.log(`  ${p} [${label}]: status ${forged.status}; launcher ${launcher ? "PRESENT" : "none"}; markers ${markers ? "PRESENT" : "none"} (${anyInvisible} U+2060/200C/200D chars); "ice" namespace ${iceNs ? "PRESENT" : "none"}; markup ${c.markupIdentical ? "identical" : `differs by ${markupDelta.join(" ")}`}; flight ${c.flightIdentical ? "identical" : `${c.flight.length} row(s) differ`}`);
    if (!c.flightIdentical) printCompare({ markup: { onlyOld: [], onlyNew: [] }, flight: c.flight });
  }
}

/* ── d) network: what a visitor's browser downloads ────────────────────── */

console.log("\nd) NETWORK: JS/CSS REQUESTED BY A VISITOR, OLD vs NEW");
const editorJs = staticFilesWith(NEW_DIR, "data-ice-target", ".js");
const editorCss = staticFilesWith(NEW_DIR, "hoverLabel", ".css");
console.log(`  editor chunk(s) in the NEW build (contain "data-ice-target"): ${editorJs.join(", ") || "none found"}`);
console.log(`  editor CSS in the NEW build (contains "hoverLabel"): ${editorCss.join(", ") || "none found"}`);
console.log(`  OLD build files containing "data-ice-target": ${staticFilesWith(OLD_DIR, "data-ice-target", ".js").length}`);
results.checks.editorFiles = { js: editorJs, css: editorCss };
const editorPaths = new Set([...editorJs, ...editorCss].map((f) => "/_next/" + f));
for (const p of ["/plany", "/", "/regulamin"]) {
  const { o, n } = net[p];
  // A forged-cookie visit too: the cookies must not pull the editor in either.
  const forged = await assets(NEW, p, [{ name: "gb_ice", value: "1" }, { name: `gb_ice_e_${fnv(p)}`, value: `abcdefgh~${p}` }]);
  const requestedEditor = [...n.list, ...forged.list]
    .filter((x) => editorPaths.has(x.path) || (x.type === "js" && x.body && x.body.toString("utf8").includes("data-ice-target"))).map((x) => x.path);
  const total = (l, k) => l.reduce((s, x) => s + (x[k] ?? 0), 0);
  const layout = (l) => l.find((x) => /\/chunks\/app\/layout-[0-9a-f]+\.js$/.test(x.path));
  const lo = layout(o.list), ln = layout(n.list);
  // Module accounting across every JS file of the visit.
  const mods = (l) => { const m = new Map(); for (const x of l) if (x.type === "js" && x.body) for (const [id, body] of modulesOf(x.body.toString("utf8"))) m.set(id, { body, file: x.path }); return m; };
  const MO = mods(o.list), MN = mods(n.list);
  const addedMods = [...MN].filter(([id]) => !MO.has(id)).map(([id, v]) => ({ id, bytes: v.body.length, file: stripHash(v.file), tell: tellOf(v.body) }));
  const removedMods = [...MO].filter(([id]) => !MN.has(id)).map(([id, v]) => ({ id, bytes: v.body.length, file: stripHash(v.file), tell: tellOf(v.body) }));
  const resized = [...MN].filter(([id, v]) => MO.has(id) && MO.get(id).body.length !== v.body.length).map(([id, v]) => ({ id, from: MO.get(id).body.length, to: v.body.length, file: stripHash(v.file) }));
  results.checks[`d ${p}`] = {
    pass: requestedEditor.length === 0 && forged.dom.iceLaunch === 0 && n.dom.iceLaunch === 0,
    requests: { old: o.list.length, new: n.list.length, newWithForgedCookies: forged.list.length },
    totals: { oldBytes: total(o.list, "bytes"), newBytes: total(n.list, "bytes"), oldGzip: total(o.list, "gzip"), newGzip: total(n.list, "gzip") },
    layoutChunk: { old: lo && { path: lo.path, bytes: lo.bytes, gzip: lo.gzip }, new: ln && { path: ln.path, bytes: ln.bytes, gzip: ln.gzip } },
    requestedEditor, modules: { added: addedMods, removed: removedMods, resized },
    dom: { new: n.dom, forged: forged.dom },
    files: { old: o.list.map((x) => `${stripHash(x.path)} ${x.bytes}`), new: n.list.map((x) => `${stripHash(x.path)} ${x.bytes}`) },
  };
  const sameNames = JSON.stringify(o.list.map((x) => stripHash(x.path)).sort()) === JSON.stringify(n.list.map((x) => stripHash(x.path)).sort());
  console.log(`  ${p}: ${o.list.length} JS/CSS requests old, ${n.list.length} new (${forged.list.length} with forged cookies), same files by name: ${sameNames}; editor requested: ${requestedEditor.length ? requestedEditor.join(",") : "never"}`);
  console.log(`    all JS+CSS: ${total(o.list, "bytes")} → ${total(n.list, "bytes")} B (${total(n.list, "bytes") - total(o.list, "bytes") >= 0 ? "+" : ""}${total(n.list, "bytes") - total(o.list, "bytes")}), gzip ${total(o.list, "gzip")} → ${total(n.list, "gzip")} B (${total(n.list, "gzip") - total(o.list, "gzip") >= 0 ? "+" : ""}${total(n.list, "gzip") - total(o.list, "gzip")})`);
  if (lo && ln) console.log(`    app/layout chunk: ${lo.bytes} → ${ln.bytes} B (+${ln.bytes - lo.bytes}), gzip ${lo.gzip} → ${ln.gzip} B (+${ln.gzip - lo.gzip})`);
  for (const m of addedMods) console.log(`    module + ${m.id} ${m.bytes} B in ${m.file}: ${m.tell}`);
  for (const m of removedMods) console.log(`    module - ${m.id} ${m.bytes} B in ${m.file}: ${m.tell}`);
  for (const m of resized) console.log(`    module ~ ${m.id} ${m.from} → ${m.to} B in ${m.file}`);
  console.log(`    DOM (new): ${JSON.stringify(n.dom)}; with forged cookies: ${JSON.stringify(forged.dom)}`);
}

/* ── e) horizontal overflow on NEW at 390 ──────────────────────────────── */

console.log("\ne) NO HORIZONTAL OVERFLOW ON NEW AT 390 px");
for (const r of results.shots.filter((s) => s.width === 390)) {
  const ok = r.overflow.new.sw <= r.overflow.new.vw && r.overflow.new.escapes === 0;
  results.checks[`e ${r.tag}`] = { pass: ok, ...r.overflow.new };
  console.log(`  ${r.tag}: scrollWidth ${r.overflow.new.sw} / viewport ${r.overflow.new.vw}, escaping elements ${r.overflow.new.escapes} — ${ok ? "ok" : "OVERFLOW " + r.overflow.new.list.join(" | ")}`);
}

await browser.close();

/* ── the table ─────────────────────────────────────────────────────────── */

const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "body" ? undefined : v)));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(strip(results), null, 2));
console.log("\nSUMMARY (counts in pixels; >Δ = channel difference above the tolerance)");
console.log("page       width theme  verdict                       px        >Δ        bbox                       noise old/new px");
for (const r of results.shots) {
  const b = r.diff.bbox ? `${r.diff.bbox.x},${r.diff.bbox.y} ${r.diff.bbox.w}×${r.diff.bbox.h}` : "-";
  const nz = r.noise.old ? `${r.noise.old.count}/${r.noise.new.count}` : "-";
  console.log(`${r.page.padEnd(10)} ${String(r.width).padEnd(5)} ${r.theme.padEnd(6)} ${r.verdict.padEnd(29)} ${String(r.diff.count).padStart(8)}  ${String(r.diff.tolCount).padStart(8)}  ${b.padEnd(26)} ${nz}`);
}
const failedChecks = Object.entries(results.checks).filter(([, v]) => v && v.pass === false).map(([k]) => k);
console.log(`\nchecks: ${failedChecks.length === 0 ? "all pass" : "NOT PASSING: " + failedChecks.join("; ")}`);
console.log(`results: ${path.join(OUT, "results.json")}`);
