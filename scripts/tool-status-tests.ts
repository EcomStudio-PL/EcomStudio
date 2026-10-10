/**
 * TOOL STATUS TESTS — "Aktywny" in Narzędzia i silniki means what it says.
 *
 * The bug: an operator set Usuń tło / Zmień kolor tła / Dodaj tło AI / Dodaj
 * cień to Aktywny, the save landed, and customers still saw "Wkrótce" — the
 * catalogue's provider readiness (no Photoroom key yet) was rendered with the
 * publication word and closed the card. These tests pin the separation:
 *
 *   A. readiness helpers — waiting for a provider never closes a card
 *   B. the four statuses × the four tools, through every customer rule
 *   C. /tools cards, rendered: no "Wkrótce" on an Aktywny tool, whatever its key
 *   D. the save path: a real write, refusals, persistence, every surface refreshed
 *   E. the admin readiness read: the real cause (no key / provider off / test key / service)
 *   F. visibility stays independent of status, including across a window
 *   G. direct URLs and APIs stay blocked server-side; no charge without a provider
 *   H. search and Start: the same publication words, no readiness in them
 *   I. copy: PL/EN/DE, no "Wkrótce" for a readiness state
 *   J. Retusz untouched
 *
 * No network: fetch throws. No database: an in-memory client.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Scissors } from "lucide-react";
import {
  FEATURE_REGISTRY, featureForPhotoTool, menuBadge, menuVisible, routeReachable,
  type AvailabilityMap, type FeatureKey, type FeatureStatus,
} from "@/lib/features";
import { effectiveState, getAvailabilityMap, type FeatureRow } from "@/lib/server/feature-availability";
import { PHOTO_TOOLS, type PhotoToolSlug } from "@/lib/images/tools";
import { WAITING_REASONS, readinessCloses, waitingForProvider } from "@/lib/tool-readiness";
import { notReady, readinessCause, type ToolReadiness } from "@/lib/tool-readiness-admin";
import { readToolReadiness } from "@/lib/server/tool-readiness";
import { searchGate } from "@/lib/tool-search";
import { ToolsCatalogue, type CatalogueCard, type CatalogueSection } from "@/components/tools/tools-catalogue";
import { batchFeatureStatusAction, saveFeatureAvailabilityAction, type FeatureSaveInput } from "@/app/actions/features";
import { makeT } from "@/lib/i18n/t";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}`}`);
  if (!cond) failures += 1;
}
const read = (p: string) => readFileSync(p, "utf8");

// Nothing in this suite may reach a provider. A paid call would be a bug twice over.
let fetches = 0;
globalThis.fetch = (async () => { fetches += 1; throw new Error("network is off in tool-status tests"); }) as typeof fetch;

/* ── an in-memory database ──────────────────────────────────────────────── */

type Row = Record<string, unknown>;
type Store = Record<string, Row[]> & { __failUpsert?: Row[] };
const KEY_COLUMN: Record<string, string> = { feature_availability: "feature_key" };

function fakeClient(store: Store, userId: string | null) {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const rows = (): Row[] => {
      let r = store[table] ?? [];
      for (const [k, v] of filters) r = r.filter((x) => x[k] === v);
      return r;
    };
    const q = {
      select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      in: () => q, order: () => q, limit: () => q, gte: () => q, lt: () => q, neq: () => q, is: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(res, rej),
      upsert: async (input: Row | Row[]) => {
        if (store.__failUpsert) return { data: null, error: { message: "permission denied" } };
        const key = KEY_COLUMN[table] ?? "id";
        const list = (store[table] ??= []);
        for (const row of Array.isArray(input) ? input : [input]) {
          const at = list.findIndex((x) => x[key] === row[key]);
          if (at >= 0) list[at] = { ...list[at], ...row }; else list.push({ hidden_from_menu: false, auto_reenable: false, custom_title: null, custom_message: null, ...row });
        }
        return { data: null, error: null };
      },
      insert: async (row: Row) => { (store[table] ??= []).push(row); return { data: null, error: null }; },
    };
    return q;
  };
  return {
    from,
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
  };
}
type Client = Parameters<typeof getAvailabilityMap>[0];
const G = globalThis as unknown as { __statusDb?: unknown; __statusUser?: { id: string } | null; __revalidated?: string[] };
function signIn(store: Store, userId: string | null) {
  const c = fakeClient(store, userId);
  G.__statusDb = c;
  G.__statusUser = userId ? { id: userId } : null;
  return c as unknown as Client;
}

const NOW = new Date("2026-10-10T12:00:00Z");
const featureRow = (key: string, status: FeatureStatus, extra: Partial<FeatureRow> = {}): FeatureRow => ({
  feature_key: key, status, hidden_from_menu: false, starts_at: null, ends_at: null, auto_reenable: false,
  custom_title: null, custom_message: null, updated_at: NOW.toISOString(), updated_by: null, ...extra,
});
const mapWith = (entries: [FeatureKey, FeatureRow][]): AvailabilityMap => {
  const map = {} as AvailabilityMap;
  for (const [k, r] of entries) map[k] = effectiveState(r, NOW);
  return map;
};
const STATUSES: FeatureStatus[] = ["ACTIVE", "COMING_SOON", "MAINTENANCE", "DISABLED"];
const keyOf = (slug: PhotoToolSlug) => featureForPhotoTool(slug);
const hrefOf = (slug: PhotoToolSlug) => `/tools/${slug}`;

async function main() {
  console.log("\nA. READINESS IS NOT PUBLICATION");
  {
    check("the waiting reasons are exactly no_provider and sandbox", WAITING_REASONS.join() === "no_provider,sandbox");
    const cases: [string, { available: boolean; reason: string | null } | null, boolean, boolean][] = [
      ["no key yet", { available: false, reason: "no_provider" }, true, false],
      ["test key only", { available: false, reason: "sandbox" }, true, false],
      ["service switched off", { available: false, reason: "disabled" }, false, true],
      ["service in maintenance", { available: false, reason: "maintenance" }, false, true],
      ["ready", { available: true, reason: "ok" }, false, false],
      ["a place, not an operation", null, false, false],
    ];
    for (const [name, state, waiting, closes] of cases) {
      check(`${name} → waiting=${waiting}, closes the card=${closes}`,
        waitingForProvider(state) === waiting && readinessCloses(state) === closes);
    }
  }

  console.log("\nB. FOUR STATUSES × FOUR TOOLS — every customer rule reads the operator's status");
  for (const slug of PHOTO_TOOLS) {
    const key = keyOf(slug);
    const href = hrefOf(slug);
    check(`${slug} — its switch owns /tools/${slug}`, FEATURE_REGISTRY.find((f) => f.key === key)?.path === href);
    for (const status of STATUSES) {
      const map = mapWith([[key, featureRow(key, status)]]);
      const badge = menuBadge(map, href);
      const wantBadge = status === "ACTIVE" ? null : status === "COMING_SOON" ? "soon" : status === "MAINTENANCE" ? "maintenance" : "disabled";
      check(`${slug} ${status} — badge ${wantBadge ?? "none"}`, badge === wantBadge, badge);
      check(`${slug} ${status} — listed for a customer: ${status !== "DISABLED"}`, menuVisible(map, href, false) === (status !== "DISABLED"));
      check(`${slug} ${status} — door opens for a customer: ${status !== "DISABLED"}`, routeReachable(map, href, false) === (status !== "DISABLED"));
      check(`${slug} ${status} — an admin always reaches it`, routeReachable(map, href, true) && menuVisible(map, href, true));
    }
    // One switch never moves another.
    const map = mapWith([[key, featureRow(key, "ACTIVE")]]);
    const others = PHOTO_TOOLS.filter((s) => s !== slug);
    check(`${slug} ACTIVE leaves the other three as they were (no row → registry default)`,
      others.every((o) => map[keyOf(o)] === undefined));
  }

  console.log("\nC. /tools CARDS — an Aktywny tool never says \"Wkrótce\"");
  {
    const t = (k: string, vars?: Record<string, string | number>) => (vars ? `${k}(${JSON.stringify(vars)})` : k);
    const card = (slug: PhotoToolSlug, state: CatalogueCard["state"]): CatalogueCard => ({
      key: slug, href: hrefOf(slug), icon: Scissors, motif: "cutout", title: slug, body: "", state,
    } as CatalogueCard);
    const html = (status: FeatureStatus, state: CatalogueCard["state"], isAdmin = false, slug: PhotoToolSlug = "remove_bg") => {
      const key = keyOf(slug);
      const sections: CatalogueSection[] = [{ key: "edit", icon: Scissors, title: "Edycja", cards: [card(slug, state)] }];
      return renderToStaticMarkup(createElement(ToolsCatalogue, {
        sections, avail: mapWith([[key, featureRow(key, status)]]), isAdmin, t,
      }));
    };
    const link = (h: string, slug: PhotoToolSlug = "remove_bg") => h.includes(`href="${hrefOf(slug)}"`) && !h.includes('data-blocked="true"');
    const NO_KEY = { available: false, credits: 0, reason: "no_provider" };
    const SANDBOX = { available: false, credits: 0, reason: "sandbox" };
    const READY = { available: true, credits: 3, reason: "ok" };
    for (const slug of PHOTO_TOOLS) {
      const h = html("ACTIVE", NO_KEY, false, slug);
      check(`${slug} ACTIVE + no key → an open link, no "Wkrótce", no readiness badge, no price`,
        link(h, slug) && !h.includes("features.badgeSoon") && !h.includes("tools.state.") && !h.includes("tools.creditsTotal"), h.slice(0, 400));
    }
    const sb = html("ACTIVE", SANDBOX);
    check("ACTIVE + test key only → open, unbadged", link(sb) && !sb.includes("features.badgeSoon") && !sb.includes("tools.state."));
    const ready = html("ACTIVE", READY);
    check("ACTIVE + ready → open with its price", link(ready) && ready.includes("tools.creditsTotal"));
    const svc = html("ACTIVE", { available: false, credits: 0, reason: "maintenance" });
    check("ACTIVE + service in maintenance → closed with the service's word, not \"Wkrótce\"",
      svc.includes('data-blocked="true"') && svc.includes("tools.state.maintenance") && !svc.includes("features.badgeSoon"));
    const soon = html("COMING_SOON", READY);
    check("COMING_SOON → \"Wkrótce\", closed, even with a working key", soon.includes("features.badgeSoon") && soon.includes('data-blocked="true"'));
    const maint = html("MAINTENANCE", NO_KEY);
    check("MAINTENANCE → \"Prace techniczne\", closed, not \"Wkrótce\"",
      maint.includes("features.badgeMaintenance") && !maint.includes("features.badgeSoon") && maint.includes('data-blocked="true"'));
    const off = html("DISABLED", READY);
    check("DISABLED → closed (the page drops it for a customer; the card never opens)", off.includes('data-blocked="true"') && !off.includes("features.badgeSoon"));
    const adminSoon = html("COMING_SOON", NO_KEY, true);
    check("an admin's card stays open whatever the status (they switch it back on)", link(adminSoon));
    const page = read("app/(app)/tools/page.tsx");
    check("/tools hands the catalogue the customer's switchboard, not a readiness verdict as a status",
      /ToolsCatalogue/.test(page) && !/readinessCloses|waitingForProvider/.test(page));
  }

  console.log("\nD. THE SAVE — a real write, refusals, persistence, every surface refreshed");
  {
    const store: Store = { profiles: [{ id: "admin-1", role: "admin" }, { id: "user-1", role: "user" }], feature_availability: [], audit_logs: [] };
    const input = (key: string, status: FeatureStatus, hidden = false): FeatureSaveInput => ({
      key, status, hiddenFromMenu: hidden, startsAt: null, endsAt: null, autoReenable: false, customTitle: "", customMessage: "",
    });

    signIn(store, "user-1");
    const refused = await saveFeatureAvailabilityAction(input("tool_remove_bg", "ACTIVE"));
    check("a non-admin cannot save — refused, nothing written", !refused.ok && store.feature_availability.length === 0, refused);
    signIn(store, null);
    const anon = await saveFeatureAvailabilityAction(input("tool_remove_bg", "ACTIVE"));
    check("signed out — refused, nothing written", !anon.ok && store.feature_availability.length === 0);

    signIn(store, "admin-1");
    G.__revalidated = [];
    const bad = await saveFeatureAvailabilityAction(input("not_a_feature", "ACTIVE"));
    check("a key outside the registry is refused", !bad.ok && store.feature_availability.length === 0);

    store.__failUpsert = [];
    const failed = await saveFeatureAvailabilityAction(input("tool_remove_bg", "ACTIVE"));
    check("a failed write reports failure (the panel's success toast needs ok:true)", !failed.ok && store.feature_availability.length === 0, failed);
    delete store.__failUpsert;

    for (const slug of PHOTO_TOOLS) {
      const res = await saveFeatureAvailabilityAction(input(keyOf(slug), "ACTIVE"));
      check(`${slug} → Aktywny saved`, res.ok, res);
    }
    check("the rows are in the table, ACTIVE, written by the admin",
      PHOTO_TOOLS.every((s) => store.feature_availability.some((r) => r.feature_key === keyOf(s) && r.status === "ACTIVE" && r.updated_by === "admin-1")));
    check("each save is audited", store.audit_logs.filter((r) => r.action === "feature_availability.saved").length === 4);
    check("each save refreshes the admin page AND every customer surface (layout)",
      (G.__revalidated ?? []).filter((p) => p === "/admin/ai").length === 4
      && (G.__revalidated ?? []).filter((p) => p === "/|layout").length === 4, G.__revalidated);

    // "Refresh" and "another device": a fresh read on a fresh client of the same table.
    const deviceA = fakeClient(store, "user-1") as unknown as Client;
    const deviceB = fakeClient(store, null) as unknown as Client;
    const [a, b] = [await getAvailabilityMap(deviceA), await getAvailabilityMap(deviceB)];
    check("after a refresh the four read ACTIVE", PHOTO_TOOLS.every((s) => a[keyOf(s)]?.status === "ACTIVE"));
    check("on another device (signed out) the four read ACTIVE too", PHOTO_TOOLS.every((s) => b[keyOf(s)]?.status === "ACTIVE"));
    check("…and nothing badges them \"Wkrótce\"", PHOTO_TOOLS.every((s) => menuBadge(a, hrefOf(s)) === null));
    check("a tool with no row keeps its registry default (nothing was mass-switched)",
      a.video?.status === FEATURE_REGISTRY.find((f) => f.key === "video")?.defaultStatus);

    // Back to Wkrótce, then on again — every surface follows the latest save.
    await saveFeatureAvailabilityAction(input("tool_ai_shadow", "COMING_SOON"));
    let m = await getAvailabilityMap(fakeClient(store, null) as unknown as Client);
    check("Wkrótce saved → read as Wkrótce at once", m.tool_ai_shadow?.status === "COMING_SOON" && menuBadge(m, "/tools/ai_shadow") === "soon");
    await saveFeatureAvailabilityAction(input("tool_ai_shadow", "MAINTENANCE"));
    m = await getAvailabilityMap(fakeClient(store, null) as unknown as Client);
    check("Prace techniczne saved → \"maintenance\", never \"soon\"", menuBadge(m, "/tools/ai_shadow") === "maintenance");
    await saveFeatureAvailabilityAction(input("tool_ai_shadow", "DISABLED"));
    m = await getAvailabilityMap(fakeClient(store, null) as unknown as Client);
    check("Wyłączony saved → unlisted and unreachable for a customer",
      !menuVisible(m, "/tools/ai_shadow", false) && !routeReachable(m, "/tools/ai_shadow", false));
    await saveFeatureAvailabilityAction(input("tool_ai_shadow", "ACTIVE"));
    m = await getAvailabilityMap(fakeClient(store, null) as unknown as Client);
    check("Aktywny again → open, unbadged", menuBadge(m, "/tools/ai_shadow") === null && routeReachable(m, "/tools/ai_shadow", false));

    G.__revalidated = [];
    const batch = await batchFeatureStatusAction(["tool_white_bg"], "ACTIVE");
    check("the bulk bar saves and refreshes every surface too", batch.ok && (G.__revalidated ?? []).includes("/|layout"));
    const src = read("components/admin/availability-controls.tsx");
    check("the panel's success toast is conditional on the server's ok",
      /if \(res\.ok\) \{ toast\.success\(t\("featAdm\.saved"\)\); router\.refresh\(\); \}/.test(src));
    check("the panel's status buttons are the four statuses, one write", /saveFeatureAvailabilityAction\(\{/.test(src));
    check("no cache sits between the table and a customer (React per-request cache only)",
      !/unstable_cache|revalidate\s*=/.test(read("lib/server/feature-availability.ts")));
  }

  console.log("\nE. WHAT THE OPERATOR SEES — the real reason an Aktywny tool cannot run");
  {
    const env = process.env as Record<string, string | undefined>;
    delete env.PHOTOROOM_API_KEY;
    const base = (): Store => ({
      service_catalog: [], app_settings: [],
      ai_providers: [{ id: "p-photoroom", slug: "photoroom", name: "Photoroom", active: false }],
      ai_provider_credentials: [],
    });
    const readiness = async (store: Store) => readToolReadiness(fakeClient(store, "admin-1") as unknown as Client);

    let r = await readiness(base());
    check("PROD today (Photoroom off, no key) → no_key, provider named, provider off noted",
      PHOTO_TOOLS.every((s) => r[keyOf(s)]?.state === "no_key" && r[keyOf(s)]?.provider === "Photoroom" && r[keyOf(s)]?.providerActive === false),
      PHOTO_TOOLS.map((s) => r[keyOf(s)]));
    const withKey = base();
    withKey.ai_provider_credentials = [{ provider_id: "p-photoroom", active: true }];
    r = await readiness(withKey);
    check("a saved key on a switched-off provider → provider_inactive", PHOTO_TOOLS.every((s) => r[keyOf(s)]?.state === "provider_inactive"));
    const activeNoKey = base();
    activeNoKey.ai_providers = [{ id: "p-photoroom", slug: "photoroom", name: "Photoroom", active: true }];
    r = await readiness(activeNoKey);
    check("an active provider without a key → no_key, provider on", PHOTO_TOOLS.every((s) => r[keyOf(s)]?.state === "no_key" && r[keyOf(s)]?.providerActive === true));
    const pending = base();
    pending.ai_providers = [{ id: "p-photoroom", slug: "photoroom", name: "Photoroom", active: true }];
    pending.ai_provider_credentials = [{ provider_id: "p-photoroom", active: true }];
    r = await readiness(pending);
    check("provider on + key saved, yet the runner found none → key_pending, not \"no key\"",
      PHOTO_TOOLS.every((s) => r[keyOf(s)]?.state === "key_pending"), PHOTO_TOOLS.map((s) => r[keyOf(s)]?.state));
    env.PHOTOROOM_API_KEY = "sandbox_test";
    r = await readiness(base());
    check("only a test (sandbox) key → sandbox", PHOTO_TOOLS.every((s) => r[keyOf(s)]?.state === "sandbox"));
    check("an unpinned tool held back by the test key names its vendor in the cause…",
      r.tool_upscale?.state === "sandbox" && r.tool_upscale?.vendor === "Photoroom"
      && readinessCause(r.tool_upscale, makeT(pl as never)).includes("Photoroom")
      && !/ {2}/.test(readinessCause(r.tool_upscale, makeT(pl as never))), r.tool_upscale);
    check("…but is never presented as pinned to it (provider stays null)", r.tool_upscale?.provider === null);
    env.PHOTOROOM_API_KEY = "live_test";
    r = await readiness(base());
    check("a live key → ready", PHOTO_TOOLS.every((s) => r[keyOf(s)]?.state === "ready"));
    const maint = base();
    maint.service_catalog = [{ slug: "tool_ai_shadow", credits_cost: 1, enabled: true, maintenance_mode: true }];
    r = await readiness(maint);
    const formatOff = base();
    formatOff.service_catalog = [{ slug: "tool_format", credits_cost: 0, enabled: false, maintenance_mode: false }];
    r = await readiness(formatOff);
    check("Zmień rozmiar (slug \"format\") is read for its own switch \"resize\"", r.resize?.state === "service_disabled", r.resize);
    check("tools riding on the hub switch never speak for it", r.tools === undefined);
    const shadowOff = base();
    shadowOff.service_catalog = [{ slug: "tool_shadow", credits_cost: 0, enabled: false, maintenance_mode: false }];
    r = await readiness(shadowOff);
    check("the editor's shadow step never speaks for the editor switch", r.editor?.state === "ready", r.editor);
    const editorOff = base();
    editorOff.service_catalog = [{ slug: "tool_editor", credits_cost: 0, enabled: false, maintenance_mode: false }];
    r = await readiness(editorOff);
    check("…while the editor's own service still does", r.editor?.state === "service_disabled", r.editor);
    r = await readiness(maint);
    check("its service in maintenance → service_maintenance, the other three untouched",
      r.tool_ai_shadow?.state === "service_maintenance" && r.tool_remove_bg?.state === "ready", r);
    delete env.PHOTOROOM_API_KEY;

    const t = makeT(pl as never);
    const states: ToolReadiness["state"][] = ["no_key", "provider_inactive", "key_pending", "sandbox", "service_disabled", "service_maintenance"];
    for (const state of states) {
      const cause = readinessCause({ state, provider: "Photoroom", providerActive: false }, t);
      check(`PL cause for ${state} reads as a sentence, names no raw key`, cause.length > 10 && !/aicc\.|panel\./.test(cause), cause);
    }
    check("no key + provider off → both said", readinessCause({ state: "no_key", provider: "Photoroom", providerActive: false }, t).includes("wyłączony"));
    check("no key, unpinned tool → the generic sentence", !readinessCause({ state: "no_key", provider: null, providerActive: null }, t).includes("{provider}"));
    check("notReady: only a non-ready state", !notReady(null) && !notReady({ state: "ready", provider: null, providerActive: null })
      && notReady({ state: "no_key", provider: null, providerActive: null }));
    const reg = read("components/admin/tool-registry.tsx");
    const ctl = read("components/admin/availability-controls.tsx");
    check("the row shows a readiness badge beside the status", /notReady\(readiness\)/.test(reg) && /aicc\.panel\.readiness\.badge\./.test(reg));
    check("the editor drops \"klienci mogą korzystać\" for an Aktywny tool that cannot run",
      /!\(value\.status === "ACTIVE" && notReady\(readiness\)\)/.test(ctl) && /<ReadinessNote/.test(ctl));
    check("a pinned tool names its one vendor — not \"Dostawca wg możliwości i klucza\"",
      /modelLine\(tool, t, readiness\?\.provider\)/.test(reg) && /aicc\.apiPath\.pinnedShort/.test(reg) && /aicc\.panel\.pinnedNote/.test(reg)
      && t("aicc.apiPath.pinnedShort", { provider: "Photoroom" }) === "Dostawca: Photoroom");
    check("the fix links point at the real places: providers / service price list",
      /\/admin\/ai\/modele\?tab=dostawcy/.test(ctl) && /"\/admin\/services"/.test(ctl));
    check("the admin page reads readiness beside the switchboard",
      /readToolReadiness\(supabase\)/.test(read("app/admin/ai/page.tsx")) && /readToolReadiness\(supabase\)/.test(read("app/admin/ai/[tool]/page.tsx")));
    check("readiness reads credential METADATA only — never the secret columns",
      /from\("ai_provider_credentials"\)\.select\("provider_id, active"\)/.test(read("lib/server/tool-readiness.ts"))
      && !/encrypted_value|auth_tag|\biv\b/.test(read("lib/server/tool-readiness.ts")));
    check("readiness never writes", !/\.(upsert|insert|update|delete)\(/.test(read("lib/server/tool-readiness.ts")));
  }

  console.log("\nF. VISIBILITY STAYS INDEPENDENT OF STATUS");
  {
    const key = "tool_white_bg";
    const hidden = effectiveState(featureRow(key, "ACTIVE", { hidden_from_menu: true }), NOW);
    check("Aktywny + hidden → live, unlisted", hidden.status === "ACTIVE" && hidden.hiddenFromMenu);
    const before = effectiveState(featureRow(key, "COMING_SOON", { hidden_from_menu: true, starts_at: "2026-11-01T00:00:00Z" }), NOW);
    check("a Wkrótce window not started yet → live, and STILL hidden (was dropped before)", before.status === "ACTIVE" && before.hiddenFromMenu);
    const reopened = effectiveState(featureRow(key, "MAINTENANCE", { hidden_from_menu: true, ends_at: "2026-10-01T00:00:00Z", auto_reenable: true }), NOW);
    check("a maintenance window that reopened → live, and STILL hidden", reopened.status === "ACTIVE" && reopened.hiddenFromMenu);
    const shown = effectiveState(featureRow(key, "COMING_SOON", { starts_at: "2026-11-01T00:00:00Z" }), NOW);
    check("…and a visible one stays visible", shown.status === "ACTIVE" && !shown.hiddenFromMenu);
    const m = mapWith([[key, featureRow(key, "ACTIVE", { hidden_from_menu: true })]]);
    check("hidden from the lists does not shut the door", !menuVisible(m, "/tools/white_bg", false) && routeReachable(m, "/tools/white_bg", false));
    const layout = read("lib/tool-layout.ts");
    check("the catalogue placements keep their own three switches (tools / menu / start)", /tools/.test(layout) && /menu/.test(layout) && /start/.test(layout));
  }

  console.log("\nG. DIRECT URLS AND APIS — blocked on the server, and nothing is charged without a provider");
  {
    const layout = read("app/(app)/tools/[slug]/layout.tsx");
    check("/tools/<photo tool> is wrapped in its own switch's gate",
      /isPhotoTool\(slug\) \? featureForPhotoTool\(slug\)/.test(layout) && /<FeatureGate feature=\{feature\}>/.test(layout));
    const gate = read("components/feature-gate.tsx");
    const iActive = gate.indexOf('if (state.status === "ACTIVE") return <>{children}</>;');
    const iAdmin = gate.indexOf("if (admin) {");
    const iDisabled = gate.indexOf('if (state.status === "DISABLED") notFound();');
    check("the gate: ACTIVE renders, admins preview, DISABLED 404s, the rest get their own screen",
      iActive > 0 && iAdmin > iActive && iDisabled > iAdmin && /<FeatureBlockedScreen/.test(gate));
    const photo = read("app/api/tools/photo/route.ts");
    check("/api/tools/photo refuses a restricted switch (503) before it runs anything",
      photo.indexOf("featureBlockedForApi(supabase, featureForPhotoTool(tool))") > 0
      && photo.indexOf("featureBlockedForApi(supabase, featureForPhotoTool(tool))") < photo.indexOf("runTool("));
    const run = read("app/api/tools/run/route.ts");
    check("/api/tools/run answers to the photo switches too",
      /featureBlockedForApi\(supabase, featureForPhotoTool\(tool\.slug\)\)/.test(run) && run.indexOf("featureBlockedForApi") < run.indexOf("runTool("));
    const fa = read("lib/server/feature-availability.ts");
    check("the API guard trusts the real role, never a preview cookie or a header",
      /export async function featureBlockedForApi[\s\S]*?isAdminUser\(supabase\)/.test(fa));
    // The paid runner only — the local runner above it has its own, free, usage row.
    const all = read("lib/server/image-tools.ts");
    const tools = all.slice(all.indexOf("async function runPaid("), all.indexOf("export async function runToolProviderStep("));
    const iNoProvider = tools.indexOf('if (!picked) return { ok: false, error: "no_provider" };');
    check("no provider → refused before the wallet, the free allowance or a reservation",
      iNoProvider > 0 && iNoProvider < tools.indexOf("freeToolRules(supabase)") && iNoProvider < tools.indexOf("startUsage(supabase"));
    check("a customer's test key → refused before anything moves",
      tools.indexOf('if (sandbox && !input.viewerIsAdmin) return { ok: false, error: "provider_sandbox" };') < tools.indexOf("startUsage(supabase"));
    const slugPage = read("app/(app)/tools/[slug]/page.tsx");
    check("a batch tool that cannot run states no price (never \"Za darmo\" above \"niedostępne\")",
      /overline=\{!entry\.available \? undefined : entry\.credits === 0 \? t\("tools\.free"\)/.test(slugPage));
    const ui = read("components/tools/photo-tool.tsx");
    check("an Aktywny tool that cannot run shows the honest message and no upload/CTA",
      /\{!available && \(/.test(ui) && /tools\.unavailable\./.test(ui) && /\{available && <PhotoUploader/.test(ui));
  }

  console.log("\nH. SEARCH, MENUS AND START SPEAK THE SAME PUBLICATION WORDS");
  {
    const palette = read("components/layout/command-palette.tsx");
    check("search marks a Wkrótce / maintenance tool with the menus' pill", /const statusPill = \(href: string\) =>/.test(palette)
      && /menuBadge\(avail, searchGate\(href\)\)/.test(palette) && /features\.badgeSoon/.test(palette) && /features\.badgeMaintenance/.test(palette));
    check("…on the cards, the links and the result rows", (palette.match(/statusPill\(/g) ?? []).length === 3
      && /\{statusPill\(entry\.href\)\}/.test(palette) && /row\.section !== "yours" && statusPill\(row\.href\)/.test(palette));
    check("search never asks about provider keys", !/toolCatalogue|readinessCloses|waitingForProvider|no_provider/.test(palette));
    // A Moda tool answers to its category too — as its /tools card and its page gate do.
    const moda = mapWith([["image_moda", featureRow("image_moda", "COMING_SOON")], ["fashion_iron", featureRow("fashion_iron", "ACTIVE")]]);
    check("searchGate: a category workflow answers to its category and itself",
      JSON.stringify(searchGate("/k/moda/iron")) === JSON.stringify(["/k/moda", "/k/moda/iron"])
      && searchGate("/k/moda") === "/k/moda" && searchGate("/tools/remove_bg") === "/tools/remove_bg");
    check("search badges a tool inside a Wkrótce category \"soon\"", menuBadge(moda, searchGate("/k/moda/iron")) === "soon");
    const modaOff = mapWith([["image_moda", featureRow("image_moda", "DISABLED")]]);
    check("…and does not offer one inside a switched-off category", !menuVisible(modaOff, searchGate("/k/moda/iron"), false));
    check("the palette's pill and its filter both use the gate",
      /menuBadge\(avail, searchGate\(href\)\)/.test(palette) && /menuVisible\(avail, searchGate\(e\.href\), seesRestricted\)/.test(palette));
    const mega = read("components/layout/mega-topbar.tsx");
    check("the menus read the switchboard only — no provider readiness", !/toolCatalogue|tools\.state\.|no_provider/.test(mega));
    const seller = read("lib/server/seller-home.ts");
    check("/home: a tool waiting for its provider stays open, with no price promised",
      /const waiting = waitingForProvider\(entry\);/.test(seller) && /entry\.available \|\| waiting/.test(seller) && /waiting \? null : entry\.credits/.test(seller));
    const product = read("lib/home-sections.ts");
    check("Start: no provider readiness in its badges", !/toolCatalogue|no_provider/.test(product));
  }

  console.log("\nI. COPY — a readiness state never borrows the word \"Wkrótce\"");
  {
    for (const [lang, d] of [["pl", pl], ["en", en], ["de", de]] as const) {
      const dict = d as unknown as { tools: { state: Record<string, string>; unavailable: Record<string, string> }; features: Record<string, string>; aicc: Record<string, string> };
      const soon = dict.features.badgeSoon;
      check(`${lang}: tools.state.no_provider / sandbox are not "${soon}"`,
        dict.tools.state.no_provider !== soon && dict.tools.state.sandbox !== soon, dict.tools.state);
      check(`${lang}: the customer's message says it is temporary and free`,
        dict.tools.unavailable.no_provider.length > 40 && dict.tools.unavailable.sandbox === dict.tools.unavailable.no_provider);
      const missing = ["panel.readiness.active", "panel.readiness.activeService", "panel.readiness.other",
        "panel.readiness.fixProviders", "panel.readiness.fixServices", "panel.readiness.alsoInactive"]
        .filter((k) => typeof dict.aicc[k] !== "string" || !dict.aicc[k].trim());
      check(`${lang}: the admin readiness copy exists`, missing.length === 0, missing);
    }
    check("PL: no charge is promised for trying", (pl as unknown as { tools: { unavailable: Record<string, string> } }).tools.unavailable.no_provider.includes("nie pobieramy kredytów"));
  }

  console.log("\nJ. RETUSZ — not one byte changed");
  {
    const paths = [
      "app/(app)/retusz", "app/api/retouch", "components/retouch", "lib/server/retouch-delivery.ts",
      "lib/ai/providers", "lib/ai/product-lock.ts", "lib/server/generation.ts", "lib/server/ai-engine.ts",
      "lib/server/engine", "scripts/retouch-baseline.ts",
    ];
    let diff = "";
    try {
      diff = execSync(`git diff --name-only 45a2d69 -- ${paths.map((p) => `'${p}'`).join(" ")}`, { encoding: "utf8" }).trim();
    } catch (e) { diff = `git failed: ${String(e)}`; }
    check("no Retusz / provider / generation file differs from the release before this fix", diff === "", diff);
    check("no network request was made by this suite", fetches === 0, fetches);
  }

  console.log(failures ? `\n${failures} tool-status test(s) failed.` : "\nAll tool-status tests passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
