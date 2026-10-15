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
fs.mkdirSync(SHOTS, { recursive: true });

/** Each page: the address a customer types, and — for the signed-in or
 *  CMS-backed ones — the harness page the browser is given instead. `focus`
 *  names the one element whose change is intended. */
const PAGES = [
  { id: "plany", path: "/plany" },
  { id: "landing", path: "/" },
  { id: "regulamin", path: "/regulamin" },
  { id: "home", path: "/home", harness: `/${HARNESS_DIR.replace(/^app\//, "")}/home`, focus: "[data-seller-before-after]" },
  { id: "tools", path: "/tools", harness: `/${HARNESS_DIR.replace(/^app\//, "")}/tools` },
  { id: "cms", path: "/o-nas", harness: `/${HARNESS_DIR.replace(/^app\//, "")}/cms` },
].filter((p) => !ONLY || ONLY.includes(p.id));
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
const results = { old: OLD, new: NEW, startedAt: new Date().toISOString(), theme: null, shots: [], checks: {} };

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
    const page = PAGES.find((p) => p.harness && p.path === url.pathname);
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

/** Geometry and overflow, on the settled page. */
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
  const f = sel ? document.querySelector(sel) : null;
  const fr = f?.getBoundingClientRect();
  const frame = f?.querySelector("[data-ba-card] .overflow-hidden")?.getBoundingClientRect();
  return {
    dark: doc.classList.contains("dark"), vw, scrollWidth: doc.scrollWidth, height: doc.scrollHeight,
    escapees: escapees.slice(0, 8), escapeCount: escapees.length,
    focus: fr ? { top: Math.round(fr.top + scrollY), bottom: Math.round(fr.bottom + scrollY), height: Math.round(fr.height) } : null,
    baFrame: frame ? { w: Math.round(frame.width * 10) / 10, h: Math.round(frame.height * 10) / 10 } : null,
    brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 5),
    iceLaunch: document.querySelectorAll("[data-ice-launch]").length,
  };
}, focus ?? null);

async function shoot(base, pageDef, vp, theme, file) {
  const { ctx, external } = await openContext(base, { width: vp[0], height: vp[1], theme });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const resp = await page.goto(base + pageDef.path, { waitUntil: "load", timeout: 60000 });
  await settlePage(page);
  const m = await measure(page, pageDef.focus);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled", caret: "hide" });
  await ctx.close();
  return { status: resp?.status() ?? null, ...m, external: [...external], errors };
}

/* ── pixel diff (sharp raw buffers) ────────────────────────────────────── */

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Compare rows [ya, ya+rows) of A with rows [yb, yb+rows) of B over the
 *  common width; returns the count and bounding box (in A's coordinates). */
function compareRegion(A, B, ya, yb, rows) {
  const w = Math.min(A.w, B.w);
  let count = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let r = 0; r < rows; r++) {
    const ra = (ya + r) * A.w * 4, rb = (yb + r) * B.w * 4;
    for (let x = 0; x < w; x++) {
      const ia = ra + x * 4, ib = rb + x * 4;
      if (A.data[ia] !== B.data[ib] || A.data[ia + 1] !== B.data[ib + 1] || A.data[ia + 2] !== B.data[ib + 2] || A.data[ia + 3] !== B.data[ib + 3]) {
        count++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (ya + r < y0) y0 = ya + r; if (ya + r > y1) y1 = ya + r;
      }
    }
  }
  return { pixels: w * rows, count, bbox: count ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}

/** Whole-image diff, top-aligned; rows only one image has count as differing. */
async function diffFiles(fa, fb, outFile) {
  const A = await raw(fa), B = await raw(fb);
  const W = Math.max(A.w, B.w), H = Math.max(A.h, B.h);
  const common = compareRegion(A, B, 0, 0, Math.min(A.h, B.h));
  const extraRows = H - Math.min(A.h, B.h);
  const count = common.count + extraRows * W + (A.w !== B.w ? Math.abs(A.w - B.w) * Math.min(A.h, B.h) : 0);
  let bbox = common.bbox;
  if (extraRows > 0) {
    const y = Math.min(A.h, B.h);
    bbox = bbox ? { x: 0, y: bbox.y, w: W, h: H - bbox.y } : { x: 0, y, w: W, h: extraRows };
  }
  if (outFile) {
    // The old picture, faded to grey; differing pixels red, rows only one side has magenta.
    const out = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const inA = x < A.w && y < A.h, inB = x < B.w && y < B.h;
      if (!inA || !inB) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 255; out[o + 3] = 255; continue; }
      const ia = (y * A.w + x) * 4, ib = (y * B.w + x) * 4;
      const same = A.data[ia] === B.data[ib] && A.data[ia + 1] === B.data[ib + 1] && A.data[ia + 2] === B.data[ib + 2];
      if (same) {
        const g = Math.round(0.3 * A.data[ia] + 0.59 * A.data[ia + 1] + 0.11 * A.data[ia + 2]);
        const v = Math.round(200 + g * 55 / 255);
        out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
      } else { out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255; }
    }
    await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(outFile);
  }
  return { a: { w: A.w, h: A.h }, b: { w: B.w, h: B.h }, count, pct: (100 * count) / (W * H), bbox, A, B };
}

/* ── 0. which theme switch works ───────────────────────────────────────── */

console.log("\n0. THEME: what decides light/dark");
{
  const out = {};
  for (const [label, scheme, stored] of [
    ["prefers light, no stored theme", "light", null],
    ["prefers dark, no stored theme", "dark", null],
    ["stored theme=light (prefers light)", "light", "light"],
    ["stored theme=dark (prefers light)", "light", "dark"],
    ["stored theme=system (prefers light)", "light", "system"],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    if (stored) await ctx.addInitScript((t) => localStorage.setItem("theme", t), stored);
    await ctx.route("**/*", (r) => (new URL(r.request().url()).origin === new URL(NEW).origin ? r.continue() : r.abort()));
    const p = await ctx.newPage();
    await p.goto(`${NEW}/plany`, { waitUntil: "load" });
    out[label] = (await p.evaluate(() => document.documentElement.classList.contains("dark"))) ? "dark" : "light";
    await ctx.close();
    console.log(`  ${label}: html is ${out[label]}`);
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
        await shoot(OLD, pg, vp, theme, f("old2"));
        await shoot(NEW, pg, vp, theme, f("new2"));
        const no = await diffFiles(f("old"), f("old2"), null);
        const nn = await diffFiles(f("new"), f("new2"), null);
        noise.old = { count: no.count, pct: no.pct, bbox: no.bbox };
        noise.new = { count: nn.count, pct: nn.pct, bbox: nn.bbox };
      }
      const d = await diffFiles(f("old"), f("new"), f("diff"));
      const row = {
        page: pg.id, path: pg.path, width: vp[0], theme, tag,
        status: { old: mo.status, new: mn.status },
        darkApplied: { old: mo.dark, new: mn.dark },
        size: { old: d.a, new: d.b },
        diff: { count: d.count, pct: d.pct, bbox: d.bbox },
        noise,
        overflow: { old: { sw: mo.scrollWidth, vw: mo.vw, escapes: mo.escapeCount, list: mo.escapees }, new: { sw: mn.scrollWidth, vw: mn.vw, escapes: mn.escapeCount, list: mn.escapees } },
        brokenImages: { old: mo.brokenImages, new: mn.brokenImages },
        pageErrors: { old: mo.errors, new: mn.errors },
        external: [...new Set([...mo.external, ...mn.external])],
        iceLaunch: { old: mo.iceLaunch, new: mn.iceLaunch },
      };
      if (pg.focus && mo.focus && mn.focus) {
        // Above the intended change, the change, and below it re-aligned on its bottom edge.
        const above = compareRegion(d.A, d.B, 0, 0, Math.min(mo.focus.top, mn.focus.top));
        const belowRowsOld = d.A.h - mo.focus.bottom, belowRowsNew = d.B.h - mn.focus.bottom;
        const below = compareRegion(d.A, d.B, mo.focus.bottom, mn.focus.bottom, Math.min(belowRowsOld, belowRowsNew));
        row.focus = {
          selector: pg.focus, old: mo.focus, new: mn.focus, heightDelta: mn.focus.height - mo.focus.height,
          pageHeightDelta: d.b.h - d.a.h, baFrame: { old: mo.baFrame, new: mn.baFrame },
          above: { rows: Math.min(mo.focus.top, mn.focus.top), count: above.count, bbox: above.bbox },
          below: { rowsOld: belowRowsOld, rowsNew: belowRowsNew, count: below.count, bbox: below.bbox },
        };
      }
      results.shots.push(row);
      const verdict = d.count === 0 ? "IDENTICAL" : `DIFFERS ${d.pct.toFixed(3)}% bbox ${JSON.stringify(d.bbox)}`;
      const nz = REPS > 1 ? ` | noise old ${noise.old.count}px new ${noise.new.count}px` : "";
      console.log(`  ${tag}: ${verdict} (${d.a.w}×${d.a.h} → ${d.b.w}×${d.b.h})${nz}${row.focus ? ` | BA ${row.focus.old.height}→${row.focus.new.height}px, above ${row.focus.above.count}px, below(re-aligned) ${row.focus.below.count}px` : ""}`);
      delete d.A; delete d.B;
    }
  }
}

/* ── helpers for the HTML and network checks ───────────────────────────── */

async function getHtml(base, p, cookie) {
  const res = await fetch(base + p, { headers: { ...(cookie ? { cookie } : {}), "accept-language": "pl" }, redirect: "manual" });
  return { status: res.status, html: await res.text() };
}

/** Build ids, chunk hashes, nonces and per-request ids out of the way. */
function normalise(html, buildId) {
  let s = html;
  if (buildId) s = s.split(buildId).join("BUILD_ID");
  return s
    .replace(/\/_next\/static\/chunks\/([\w\-\/\[\]().%@]+?)-[0-9a-f]{8,20}\.js/g, "/_next/static/chunks/$1-HASH.js")
    .replace(/\/_next\/static\/chunks\/[0-9a-f]{8,20}\.js/g, "/_next/static/chunks/HASH.js")
    .replace(/\/_next\/static\/css\/[0-9a-f]{8,20}\.css/g, "/_next/static/css/HASH.css")
    .replace(/\/_next\/static\/media\/([\w\-.]+?)\.[0-9a-f]{8,20}\.(\w+)/g, "/_next/static/media/$1.HASH.$2")
    .replace(/nonce="[^"]*"/g, 'nonce="NONCE"')
    .replace(/"b":"[^"]+"/g, '"b":"BUILD"')
    .replace(/\\"b\\":\\"[^"\\]+\\"/g, '\\"b\\":\\"BUILD\\"');
}

/** Lines to diff: one tag or one flight chunk per line. */
const lines = (s) => s.replace(/></g, ">\n<").replace(/\\n/g, "\\n\n").split("\n");

function lineDiff(a, b) {
  const A = lines(a), B = lines(b);
  const setA = new Map(), setB = new Map();
  for (const l of A) setA.set(l, (setA.get(l) ?? 0) + 1);
  for (const l of B) setB.set(l, (setB.get(l) ?? 0) + 1);
  const onlyA = [], onlyB = [];
  for (const [l, n] of setA) { const m = setB.get(l) ?? 0; if (n > m) onlyA.push(l); }
  for (const [l, n] of setB) { const m = setA.get(l) ?? 0; if (n > m) onlyB.push(l); }
  return { onlyOld: onlyA, onlyNew: onlyB };
}

const buildIdOf = (dir) => {
  try { return dir ? fs.readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8").trim() : null; } catch { return null; }
};
const OLD_BUILD = buildIdOf(OLD_DIR), NEW_BUILD = buildIdOf(NEW_DIR);

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

const stripHash = (p) => p.replace(/-[0-9a-f]{8,20}(\.js|\.css)$/, "$1").replace(/\/[0-9a-f]{8,20}(\.js|\.css)$/, "/HASH$1");

/* ── a) CSS a visitor loads ────────────────────────────────────────────── */

console.log("\na) CSS FILES A VISITOR LOADS, OLD vs NEW");
const net = {};
for (const p of ["/plany", "/"]) {
  const o = await assets(OLD, p), n = await assets(NEW, p);
  net[p] = { o, n };
  const cssO = o.list.filter((x) => x.type === "css"), cssN = n.list.filter((x) => x.type === "css");
  const shaO = cssO.map((x) => x.sha).sort(), shaN = cssN.map((x) => x.sha).sort();
  const same = JSON.stringify(shaO) === JSON.stringify(shaN);
  const hover = cssN.filter((x) => x.body.toString("utf8").includes("hoverLabel")).map((x) => x.path);
  results.checks[`a ${p}`] = {
    pass: same && hover.length === 0,
    old: cssO.map(({ path: q, bytes, sha: h }) => ({ path: q, bytes, sha: h.slice(0, 16) })),
    new: cssN.map(({ path: q, bytes, sha: h }) => ({ path: q, bytes, sha: h.slice(0, 16) })),
    newCssWithHoverLabel: hover,
  };
  console.log(`  ${p}: ${cssO.length} CSS old / ${cssN.length} new — ${same ? "byte-identical set" : "DIFFERENT"}; editor CSS loaded: ${hover.length ? hover.join(",") : "no"}`);
  for (const x of cssO) console.log(`    old ${x.path} ${x.bytes} B sha ${x.sha.slice(0, 16)}`);
  for (const x of cssN) console.log(`    new ${x.path} ${x.bytes} B sha ${x.sha.slice(0, 16)}`);
}

/* ── b) anonymous HTML ─────────────────────────────────────────────────── */

console.log("\nb) ANONYMOUS HTML, OLD vs NEW (normalised)");
for (const p of ["/plany", "/", "/regulamin"]) {
  const o = await getHtml(OLD, p), n = await getHtml(NEW, p);
  const no = normalise(o.html, OLD_BUILD), nn = normalise(n.html, NEW_BUILD);
  const d = lineDiff(no, nn);
  results.checks[`b ${p}`] = {
    pass: no === nn, status: { old: o.status, new: n.status }, bytes: { old: o.html.length, new: n.html.length },
    onlyOld: d.onlyOld.slice(0, 40), onlyNew: d.onlyNew.slice(0, 40),
  };
  fs.writeFileSync(path.join(OUT, `html${p === "/" ? "-landing" : p.replace(/\//g, "-")}-old.norm.html`), no);
  fs.writeFileSync(path.join(OUT, `html${p === "/" ? "-landing" : p.replace(/\//g, "-")}-new.norm.html`), nn);
  console.log(`  ${p}: ${no === nn ? "IDENTICAL after normalisation" : `${d.onlyOld.length} line(s) only in OLD, ${d.onlyNew.length} only in NEW`} (${o.html.length} → ${n.html.length} bytes raw)`);
  for (const l of d.onlyOld.slice(0, 6)) console.log(`    - ${l.slice(0, 220)}`);
  for (const l of d.onlyNew.slice(0, 6)) console.log(`    + ${l.slice(0, 220)}`);
}

/* ── c) forged editor cookies on NEW ───────────────────────────────────── */

console.log("\nc) FORGED EDITOR COOKIES ON NEW (no session)");
/** FNV-1a, as lib/server/ice/session.ts names an edit cookie for a path. */
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
for (const p of ["/plany", "/", "/regulamin"]) {
  const plain = await getHtml(NEW, p);
  const variants = {
    "gb_ice=1 + gb_ice_e_deadbeef (wrong name)": `gb_ice=1; gb_ice_e_deadbeef=abcdefgh~${p}`,
    "gb_ice=1 + gb_ice_e_<fnv(path)> (name passes the check)": `gb_ice=1; gb_ice_e_${fnv(p)}=abcdefgh~${p}`,
  };
  for (const [label, cookie] of Object.entries(variants)) {
    const forged = await getHtml(NEW, p, cookie);
    const h = forged.html;
    const launcher = h.includes("data-ice-launch");
    const markers = /\u2060[\u200c\u200d]/.test(h) || /\\u2060\\u200[cdCD]/.test(h);
    const iceNs = /"ice":\{/.test(h) || /\\"ice\\":\{/.test(h);
    const same = normalise(h, NEW_BUILD) === normalise(plain.html, NEW_BUILD);
    const d = same ? null : lineDiff(normalise(plain.html, NEW_BUILD), normalise(h, NEW_BUILD));
    results.checks[`c ${p} ${label}`] = {
      pass: !launcher && !markers && !iceNs && same, status: forged.status, launcher, markers, iceNamespace: iceNs, sameAsWithout: same,
      ...(d ? { onlyWithout: d.onlyOld.slice(0, 20), onlyWith: d.onlyNew.slice(0, 20) } : {}),
    };
    console.log(`  ${p} [${label}]: launcher ${launcher ? "PRESENT" : "none"}, markers ${markers ? "PRESENT" : "none"}, "ice" ns ${iceNs ? "PRESENT" : "none"}, HTML ${same ? "same as without cookies" : "DIFFERS"}`);
    if (d) { for (const l of d.onlyOld.slice(0, 6)) console.log(`    - ${l.slice(0, 220)}`); for (const l of d.onlyNew.slice(0, 6)) console.log(`    + ${l.slice(0, 220)}`); }
  }
}

/* ── d) network: what a visitor's browser downloads ────────────────────── */

console.log("\nd) NETWORK: JS/CSS REQUESTED BY A VISITOR, OLD vs NEW");
const editorJs = staticFilesWith(NEW_DIR, "data-ice-target", ".js");
const editorCss = staticFilesWith(NEW_DIR, "hoverLabel", ".css");
const oldEditorJs = staticFilesWith(OLD_DIR, "data-ice-target", ".js");
console.log(`  editor chunk(s) in NEW build (contain "data-ice-target"): ${editorJs.join(", ") || "none found"}`);
console.log(`  editor CSS in NEW build (contain "hoverLabel"): ${editorCss.join(", ") || "none found"}`);
console.log(`  (OLD build files with "data-ice-target": ${oldEditorJs.length})`);
results.checks.editorFiles = { js: editorJs, css: editorCss, oldJsWithMarker: oldEditorJs };
const editorPaths = new Set([...editorJs, ...editorCss].map((f) => "/_next/" + f));
for (const p of ["/plany", "/"]) {
  const { o, n } = net[p];
  // A forged-cookie visit too: the cookies must not pull the editor in either.
  const forged = await assets(NEW, p, [{ name: "gb_ice", value: "1" }, { name: `gb_ice_e_${fnv(p)}`, value: `abcdefgh~${p}` }]);
  const requestedEditor = [...n.list, ...forged.list].filter((x) => editorPaths.has(x.path) || (x.body && x.body.toString("utf8").includes("data-ice-target"))).map((x) => x.path);
  const oldShas = new Set(o.list.map((x) => x.sha));
  const oldByName = new Map(o.list.map((x) => [stripHash(x.path), x]));
  const added = n.list.filter((x) => !oldShas.has(x.sha)).map((x) => {
    const twin = oldByName.get(stripHash(x.path));
    return { path: x.path, bytes: x.bytes, gzip: x.gzip, oldTwin: twin ? { path: twin.path, bytes: twin.bytes, gzip: twin.gzip } : null };
  });
  const newShas = new Set(n.list.map((x) => x.sha));
  const removed = o.list.filter((x) => !newShas.has(x.sha)).map((x) => ({ path: x.path, bytes: x.bytes, gzip: x.gzip }));
  const total = (l, k) => l.reduce((s, x) => s + (x[k] ?? 0), 0);
  results.checks[`d ${p}`] = {
    pass: requestedEditor.length === 0,
    requests: { old: o.list.length, new: n.list.length, forgedNew: forged.list.length },
    totalBytes: { old: total(o.list, "bytes"), new: total(n.list, "bytes"), oldGzip: total(o.list, "gzip"), newGzip: total(n.list, "gzip") },
    requestedEditor, added, removed,
    dom: { new: n.dom, forged: forged.dom },
    allOld: o.list.map((x) => `${x.path} ${x.bytes}`), allNew: n.list.map((x) => `${x.path} ${x.bytes}`),
  };
  console.log(`  ${p}: ${o.list.length} JS/CSS requests old, ${n.list.length} new (${forged.list.length} with forged cookies); editor requested: ${requestedEditor.length ? requestedEditor.join(",") : "never"}`);
  console.log(`    total ${total(o.list, "bytes")} → ${total(n.list, "bytes")} B raw, ${total(o.list, "gzip")} → ${total(n.list, "gzip")} B gzip`);
  for (const a of added) console.log(`    changed/added: ${a.path} ${a.bytes} B (gz ${a.gzip})${a.oldTwin ? ` ← was ${a.oldTwin.path} ${a.oldTwin.bytes} B (gz ${a.oldTwin.gzip}): ${a.bytes - a.oldTwin.bytes >= 0 ? "+" : ""}${a.bytes - a.oldTwin.bytes} B raw, ${a.gzip - a.oldTwin.gzip >= 0 ? "+" : ""}${a.gzip - a.oldTwin.gzip} B gz` : " (no OLD twin)"}`);
  for (const r of removed) console.log(`    gone from OLD: ${r.path} ${r.bytes} B`);
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
console.log("\nSUMMARY");
console.log("page        width theme  result       %px      bbox                         noise(old/new px)");
for (const r of results.shots) {
  const res = r.diff.count === 0 ? "identical" : "differs";
  console.log(`${r.page.padEnd(11)} ${String(r.width).padEnd(5)} ${r.theme.padEnd(6)} ${res.padEnd(12)} ${r.diff.pct.toFixed(3).padStart(7)}  ${(r.diff.bbox ? `${r.diff.bbox.x},${r.diff.bbox.y} ${r.diff.bbox.w}×${r.diff.bbox.h}` : "-").padEnd(28)} ${r.noise.old ? `${r.noise.old.count}/${r.noise.new.count}` : "-"}`);
}
const failedChecks = Object.entries(results.checks).filter(([, v]) => v && v.pass === false).map(([k]) => k);
console.log(`\nchecks: ${failedChecks.length === 0 ? "all pass" : "FAILED: " + failedChecks.join("; ")}`);
console.log(`results: ${path.join(OUT, "results.json")}`);
