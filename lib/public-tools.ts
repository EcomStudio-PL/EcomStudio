/**
 * PUBLIC TOOLS V1 — what a visitor may open, and what a viewer of a tool panel
 * may do next. Pure: no server import, no browser API — the middleware, the
 * server pages, the panels and the tests all read the same rules.
 *
 * THE SWITCH. Everything here is reached only while `public_tools` is on
 * (app_settings, off by default — lib/server/public-tools.ts) or while an
 * admin runs "Podgląd jako gość". With it off a visitor is sent to the
 * sign-in dialog exactly as before.
 *
 * WHAT A VISITOR MAY OPEN is the intersection of two lists:
 *
 *   1. PUBLIC_TOOLS below — the panels that were ADAPTED for a visitor: photos
 *      stay in the browser (never Storage, never a provider), Generate opens
 *      the sign-in dialog instead of calling the backend, and the work is kept
 *      locally until they come back signed in. A panel that is not adapted is
 *      never shown to a visitor, whatever the catalogue says — it would upload
 *      on select.
 *   2. What the customer catalogue lists right now (the availability
 *      switchboard + the admin's catalogue layout — lib/tool-layout.ts
 *      hubSectionsFor + the menu items). A tool hidden there is a 404 for a
 *      visitor; one that is "Wkrótce" keeps its "Wkrótce" screen.
 *
 * There is no second system of switching tools on: (2) is the existing one.
 */

/** The panels a visitor can use, by the kind of component that renders them. */
export type PublicPanel =
  | "retouch" | "photo" | "thumbnail" | "custom" | "managed"
  | "resize" | "compress" | "workbench" | "editor";

export type PublicTool = {
  /** The catalogue key (lib/tool-cards.ts CATALOG_ITEMS) — also the key FAQ
   *  questions are assigned to and analytics events carry. */
  key: string;
  /** The tool's one address. Equal to its catalogue card's href (tested). */
  path: string;
  panel: PublicPanel;
};

export const PUBLIC_TOOLS: readonly PublicTool[] = [
  { key: "generator", path: "/prompts", panel: "managed" },
  { key: "custom", path: "/generator", panel: "custom" },
  { key: "retouch", path: "/retusz", panel: "retouch" },
  { key: "remove_bg", path: "/tools/remove_bg", panel: "photo" },
  { key: "background", path: "/tools/white_bg", panel: "photo" },
  { key: "ai_background", path: "/tools/ai_background", panel: "photo" },
  { key: "shadow", path: "/tools/ai_shadow", panel: "photo" },
  { key: "ecommerce.thumbnail", path: "/k/ecommerce/thumbnail", panel: "thumbnail" },
  { key: "resize", path: "/tools/resize", panel: "resize" },
  { key: "compress", path: "/tools/compress", panel: "compress" },
  { key: "upscale", path: "/tools/upscale", panel: "workbench" },
  { key: "expand", path: "/tools/expand", panel: "workbench" },
  { key: "watermark", path: "/tools/watermark", panel: "workbench" },
  { key: "editor", path: "/tools/editor", panel: "editor" },
] as const;

/**
 * The request header the middleware stamps with the path being rendered, so a
 * layout (which Next does not tell its pathname) can send a visitor to the
 * sign-in dialog with the right returnTo. Always overwritten by the
 * middleware — a value a client sent is never what the server reads.
 */
export const PATH_HEADER = "x-gb-path";

/**
 * "Podgląd jako gość". The cookie only ever REMOVES privilege — an admin is
 * shown the visitor's interface — and the server honours it only after
 * checking the real role (lib/server/public-tools.ts guestPreviewActive), so
 * anybody else holding it gets exactly what they had. While it is set the
 * middleware refuses the endpoints that spend credits, so the simulated
 * visitor can never generate with the admin's account behind it.
 */
export const GUEST_PREVIEW_COOKIE = "grovbase_guest_preview";

/** The one endpoint a previewing admin may still POST to: the way out. */
export const GUEST_PREVIEW_ROUTE = "/api/admin/guest-preview";

/** The catalogue itself. Public too, under the same switch. */
export const PUBLIC_CATALOGUE_PATH = "/tools";

/** A path as the router sees it: no query, no trailing slash. */
export function cleanPath(pathname: string): string {
  const p = (pathname ?? "").split("?")[0].split("#")[0];
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

const BY_PATH = new Map(PUBLIC_TOOLS.map((t) => [t.path, t]));
const BY_KEY = new Map(PUBLIC_TOOLS.map((t) => [t.key, t]));

export function publicToolForPath(pathname: string): PublicTool | null {
  return BY_PATH.get(cleanPath(pathname)) ?? null;
}

export function publicToolByKey(key: string): PublicTool | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * Could this address be a public tool page at all? The middleware's question
 * — cheap, no database: it only decides whether a request without a session
 * is handed to the server to decide (switch, catalogue) instead of being sent
 * to the sign-in dialog at the edge. The server then decides for real.
 */
export function isPublicToolPath(pathname: string): boolean {
  const p = cleanPath(pathname);
  return p === PUBLIC_CATALOGUE_PATH || BY_PATH.has(p);
}

/* ── the viewer of a tool panel ──────────────────────────────────────────── */

/**
 * What the SERVER knows about whoever looks at a panel. Never from the
 * browser: the page reads it from the session, the wallet, the subscription
 * and the welcome-bonus offer, and hands it down.
 */
export type ToolViewerFacts =
  | {
      kind: "guest";
      /** An admin looking through "Podgląd jako gość". */
      preview: boolean;
    }
  | {
      kind: "member";
      /** A stable, non-secret key for "whose local draft is this" (the
       *  account id). Compared in this browser only. */
      viewerKey: string;
      emailVerified: boolean;
      /** An active PAID plan — the same rule the checkout applies to top-ups
       *  (lib/server/billing.ts requireActivePaidPlan). */
      planActive: boolean;
      /** The welcome bonus waiting to be claimed (ELIGIBLE), if any. */
      bonus: { amount: number } | null;
      /** The configured bonus amount while the campaign runs — what an
       *  unverified account would be offered once it confirms its address. */
      bonusOffered: number | null;
      /** The account is younger than a day: a signup that just finished. */
      fresh: boolean;
    };

export type ToolState =
  /** A — a visitor: everything works except Generate, which asks to sign in. */
  | { code: "A" }
  /** B — enough credits for THIS configuration. */
  | { code: "B" }
  /** B2 — not enough, and a step of the existing onboarding would give some. */
  | { code: "B2"; step: "verify" | "survey"; missing: number; bonus: number }
  /** C — not enough, no paid plan: choose a plan. */
  | { code: "C"; missing: number }
  /** D — not enough on a paid plan: top up. */
  | { code: "D"; missing: number };

/**
 * THE ONE RULE for every panel. `balance` is the wallet the panel shows
 * (server-read, updated after a run), `cost` the price of the configuration on
 * screen — computed by the panel's own pricing, which the server re-checks on
 * every run. A balance above zero is not "enough"; only `balance >= cost` is.
 *
 * Legally available credits are never withheld: an unclaimed bonus or an
 * unconfirmed address only matters when the balance does not cover the cost.
 */
export function toolState(facts: ToolViewerFacts, balance: number, cost: number): ToolState {
  if (facts.kind === "guest") return { code: "A" };
  const price = Math.max(0, Math.ceil(Number.isFinite(cost) ? cost : 0));
  const have = Math.max(0, Math.floor(Number.isFinite(balance) ? balance : 0));
  if (have >= price) return { code: "B" };
  const missing = price - have;
  if (!facts.emailVerified && facts.bonusOffered && facts.bonusOffered > 0) {
    return { code: "B2", step: "verify", missing, bonus: facts.bonusOffered };
  }
  if (facts.bonus && facts.bonus.amount > 0) {
    return { code: "B2", step: "survey", missing, bonus: facts.bonus.amount };
  }
  return facts.planActive ? { code: "D", missing } : { code: "C", missing };
}

/* ── which pack to suggest ───────────────────────────────────────────────── */

export type PackOption = {
  /** The pack's nominal credits (its slot). */
  slot: number;
  bonusCredits: number;
  /** null = not on sale right now (no approved price). */
  href: string | null;
  amountCents: number | null;
};

/**
 * THE SMALLEST PACK THAT COVERS WHAT IS MISSING, among the packs that can
 * actually be bought (a price and a checkout link). When none covers it, the
 * largest buyable one — the customer can still top up more than once. Null
 * when nothing is on sale. Never a pack the checkout would refuse.
 */
export function recommendedPack<T extends PackOption>(packs: readonly T[], missing: number): T | null {
  const buyable = packs.filter((p) => p.href && p.amountCents !== null && p.amountCents > 0);
  if (buyable.length === 0) return null;
  const total = (p: T) => p.slot + Math.max(0, p.bonusCredits);
  const sorted = [...buyable].sort((a, b) => total(a) - total(b) || (a.amountCents! - b.amountCents!));
  return sorted.find((p) => total(p) >= missing) ?? sorted[sorted.length - 1];
}

/* ── the local draft ─────────────────────────────────────────────────────── */

/** How long a visitor's prepared tool lives in this browser. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/** The schema version of a stored draft. A draft of another version is
 *  discarded, never half-read. */
export const DRAFT_VERSION = 1;

/** A draft is the visitor's own until an account claims it; afterwards it
 *  belongs to that account (its viewerKey). */
export const GUEST_OWNER = "guest";

export type DraftMeta = {
  v: number;
  tool: string;
  path: string;
  owner: string;
  savedAt: number;
  expiresAt: number;
  fileCount: number;
};

export function draftExpired(meta: Pick<DraftMeta, "expiresAt" | "v">, now: number): boolean {
  return meta.v !== DRAFT_VERSION || !Number.isFinite(meta.expiresAt) || meta.expiresAt <= now;
}

/**
 * MAY THIS VIEWER TAKE THIS DRAFT WITHOUT BEING ASKED? A visitor's own draft,
 * back in the same browser as the same visitor — yes. A member's own draft —
 * yes. Anything else (a visitor's draft meeting an account, another account's
 * draft) is offered with "Przywróć / Odrzuć", never applied silently: two
 * people sharing a computer must not inherit each other's photos.
 */
export function draftNeedsConsent(meta: Pick<DraftMeta, "owner">, facts: ToolViewerFacts): boolean {
  if (facts.kind === "guest") return meta.owner !== GUEST_OWNER;
  return meta.owner !== facts.viewerKey;
}

/** The owner a draft is saved under. */
export function draftOwner(facts: ToolViewerFacts): string {
  return facts.kind === "guest" ? GUEST_OWNER : facts.viewerKey;
}

/* ── analytics ───────────────────────────────────────────────────────────── */

/**
 * The tool funnel, in this project's GA vocabulary (lib/analytics/ga.ts keeps
 * the closed list). Carried with the tool key and where it happened — never a
 * photo, a prompt, a token or a name.
 */
export const TOOL_EVENTS = [
  "public_tool_view",
  "guest_tool_settings_interaction",
  "guest_tool_local_upload",
  "tool_auth_modal_open",
  "tool_signup_started",
  "tool_signup_completed",
  "tool_onboarding_completed",
  "tool_state_restored",
  "tool_state_b2_shown",
  "tool_state_c_shown",
  "tool_state_d_shown",
  "tool_choose_plan_click",
  "tool_topup_click",
  "tool_checkout_completed",
] as const;
export type ToolEvent = (typeof TOOL_EVENTS)[number];

/* ── the tool's public block (visitors only) ─────────────────────────────── */

/** Before/after examples a tool's page may show — 1:1, filled in "Edytuj
 *  stronę"; an unfilled pair is simply not drawn, and with none filled the
 *  examples are not drawn at all (never a made-up result). */
export const TOOL_EXAMPLE_PAIRS = 4;

/** The media slot of one half of one example: `toolPage.<tool>.ex<n>.<side>`. */
export function toolExampleSlot(tool: string, n: number, side: "before" | "after"): string {
  return `toolPage.${tool}.ex${n}.${side}`;
}

/** The block's own copy, per tool — what "Edytuj stronę" edits, and what the
 *  page's title and description are taken from (so one edit changes both). */
export function toolPageTextKeys(tool: string): { headline: string; lead: string } {
  return { headline: `toolPage.${tool}.headline`, lead: `toolPage.${tool}.lead` };
}

/** The block's shared copy (the same on every tool page). */
export const TOOL_PAGE_SHARED_KEYS = {
  examples: "toolPage.examples",
  before: "toolPage.before",
  after: "toolPage.after",
  faq: "toolPage.faq",
  cta: "toolPage.cta",
  ctaSub: "toolPage.ctaSub",
} as const;
