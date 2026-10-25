import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { createClient, getRequestUser } from "@/lib/supabase/server";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { getAvailabilityMap } from "@/lib/server/feature-availability";
import { getToolsLayout } from "@/lib/server/tool-layout";
import { hubSectionsFor, itemReachable, menuItemKeys } from "@/lib/tool-layout";
import { catalogItem } from "@/lib/tool-cards";
import { menuVisible } from "@/lib/features";
import { authModalUrl } from "@/lib/auth-routes";
import { getBonusConfig, readOffer, toView } from "@/lib/server/welcome-bonus";
import { requireActivePaidPlan } from "@/lib/server/billing";
import { decideTrialWatermark } from "@/lib/server/trial-watermark/pipeline";
import {
  PATH_HEADER, PUBLIC_CATALOGUE_PATH, cleanPath, publicToolForPath,
  type ToolViewerFacts,
} from "@/lib/public-tools";

/**
 * PUBLIC TOOLS V1 — server side: the switch, the admin's guest preview, who
 * is looking at a tool page, and the facts a panel's status is computed from.
 * The pure rules (which panels, which state) are lib/public-tools.ts.
 */

/* ── the switch and the guest preview (lib/server/public-tools-flag.ts) ── */

export {
  PUBLIC_TOOLS_KEY, getPublicToolsFlag, guestPreviewActive, publicCatalogueOpen, type PublicToolsFlag,
} from "@/lib/server/public-tools-flag";
import { getPublicToolsFlag, guestPreviewActive } from "@/lib/server/public-tools-flag";

/* ── what the customer catalogue lists ─────────────────────────────────── */

/**
 * The addresses a CUSTOMER is shown right now: every card of /tools as the
 * catalogue layout and the availability switchboard draw it for a customer,
 * plus the tools the header menu lists. The existing switches — nothing of
 * its own. A tool that is not here does not exist for a visitor (404).
 */
export async function listedToolPaths(supabase: Client): Promise<Set<string>> {
  const [avail, layout] = await Promise.all([getAvailabilityMap(supabase), getToolsLayout(supabase)]);
  const out = new Set<string>();
  for (const section of hubSectionsFor(avail, false, layout)) {
    for (const card of section.cards) out.add(cleanPath(card.href));
  }
  for (const key of menuItemKeys(layout)) {
    const item = catalogItem(key);
    if (item && itemReachable(avail, item, false) && menuVisible(avail, item.gates ?? item.href, false)) {
      out.add(cleanPath(item.href));
    }
  }
  return out;
}

/* ── who is looking ──────────────────────────────────────────────────────── */

export type ToolAudience = { kind: "guest"; preview: boolean } | { kind: "member" };

/** The path this request renders, as the middleware stamped it. */
export async function requestPath(): Promise<string> {
  try {
    return cleanPath((await headers()).get(PATH_HEADER) ?? "");
  } catch {
    return "";
  }
}

/**
 * The sign-in dialog with a returnTo, exactly as the middleware has always
 * sent a visitor who opened a protected page.
 */
export function signInRedirect(path: string): never {
  redirect(authModalUrl("login", path ? { next: path } : undefined));
}

/**
 * WHO IS LOOKING AT THIS PUBLIC TOOL PAGE — and may they.
 *
 *   an admin in guest preview          → a guest (preview) — switch or not;
 *                                        404 where a visitor would get one
 *   anyone signed in                   → a member, as before
 *   nobody, switch OFF                 → the sign-in dialog (as before)
 *   nobody, switch ON, not listed      → 404: the tool does not exist for them
 *   nobody, switch ON, listed          → a guest
 *
 * `path` is the page's own canonical address (lib/public-tools.ts), never a
 * value from the request — the request only says WHERE to come back to.
 */
export const publicToolAudience = cache(async (path: string): Promise<ToolAudience> => {
  const own = cleanPath(path);
  if (await guestPreviewActive()) {
    // The preview shows what a visitor would get once the switch is on —
    // whatever the switch says now — so a tool the catalogue hides from
    // customers is a 404 here too.
    if (own !== PUBLIC_CATALOGUE_PATH && !(await listedToolPaths(await createClient())).has(own)) notFound();
    return { kind: "guest", preview: true };
  }
  const user = await getRequestUser();
  if (user) return { kind: "member" };
  const supabase = await createClient();
  const isPublic = own === PUBLIC_CATALOGUE_PATH || publicToolForPath(own) !== null;
  if (!isPublic || !(await getPublicToolsFlag(supabase)).enabled) signInRedirect((await requestPath()) || own);
  if (own !== PUBLIC_CATALOGUE_PATH && !(await listedToolPaths(supabase)).has(own)) notFound();
  return { kind: "guest", preview: false };
});

/* ── reading prices for a visitor ────────────────────────────────────────── */

/**
 * THE SERVER'S OWN READ, FOR A VISITOR'S PAGE.
 *
 * A visitor has no session, and the objects a tool's price is computed from
 * (ai_models, ai_providers, the token-gated readers) are not theirs to read.
 * Migration 0157 lets them be read by a request that carries the server token
 * in `x-grovbase-server` — and THIS is the only client that sends it. Server
 * code only (`server-only` above); nothing it reads is handed to the browser
 * except prices, availability and preset names, exactly what a customer's
 * page hands over.
 *
 * Null when the server has no token: the pages then show the tool as
 * unavailable rather than guessing a price.
 */
export function guestReadClient(): Client | null {
  const token = dispatchToken();
  if (!token) return null;
  return createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-grovbase-server": token } },
  }) as unknown as Client;
}

/* ── a member's facts ────────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

type MemberUser = { id: string; email_confirmed_at?: string | null; created_at?: string | null };

/**
 * What a member's panel status is computed from (lib/public-tools.ts
 * toolState). Every value is the server's: the bonus offer row, the paid-plan
 * rule the checkout itself applies to top-ups, the address confirmation. A
 * read that fails degrades to the conservative answer (no bonus, no plan) —
 * it never unlocks anything; the run endpoints re-check everything anyway.
 */
export async function memberToolFacts(
  supabase: Client, user: MemberUser, workspace: { id: string },
): Promise<Extract<ToolViewerFacts, { kind: "member" }>> {
  const [config, offer, gate] = await Promise.all([
    getBonusConfig(supabase).catch(() => null),
    readOffer(supabase, user.id).catch(() => null),
    requireActivePaidPlan(supabase, workspace).catch(() => ({ ok: false as const })),
  ]);
  const view = offer ? toView(offer) : null;
  const created = user.created_at ? Date.parse(user.created_at) : Number.NaN;
  return {
    kind: "member",
    viewerKey: user.id,
    emailVerified: Boolean(user.email_confirmed_at),
    planActive: gate.ok === true,
    bonus: view?.status === "ELIGIBLE" && view.amount > 0 ? { amount: view.amount } : null,
    bonusOffered: config?.active && config.amount > 0 ? config.amount : null,
    fresh: Number.isFinite(created) && Date.now() - created < DAY_MS,
  };
}

/**
 * Would the next paid run of this workspace be watermarked as a trial? The
 * SAME decision the run makes (trial_watermark_decide), asked for one credit —
 * so it says "your next image carries the watermark" exactly when the run
 * would put it there. Undecidable is "no note": the note is information, the
 * watermark itself is the run's to apply.
 */
export async function trialWatermarkLikely(supabase: Client, workspaceId: string): Promise<boolean> {
  try {
    const decision = await decideTrialWatermark(supabase, { workspaceId, credits: 1 });
    return "mode" in decision && decision.mode === "trial";
  } catch {
    return false;
  }
}
