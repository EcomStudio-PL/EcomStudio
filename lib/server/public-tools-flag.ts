import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/services/workspace";
import { isAdminUser } from "@/lib/server/feature-availability";
import { GUEST_PREVIEW_COOKIE } from "@/lib/public-tools";

/**
 * PUBLIC TOOLS V1 — the switch and the admin's guest preview, alone.
 *
 * Kept apart from lib/server/public-tools.ts (who is looking at a tool page,
 * the catalogue's listing, a member's facts) because the public site asks
 * these two questions on every page — where "Narzędzia" in its menu leads —
 * and must not pull the tool catalogue into its pages to ask them.
 */

/* ── the switch ──────────────────────────────────────────────────────────── */

export const PUBLIC_TOOLS_KEY = "public_tools";

export type PublicToolsFlag = { enabled: boolean; updatedAt: string | null };

const OFF: PublicToolsFlag = { enabled: false, updatedAt: null };

/**
 * FAIL CLOSED. Every other switch in this product fails OPEN (a settings
 * outage must not take the product down for customers). This one is the
 * opposite kind of switch: it opens the tools to strangers, so a read that
 * fails means "off" — the pre-launch page, exactly as before the feature
 * existed. Off is also the default: no row, no visitor access.
 */
export const getPublicToolsFlag = cache(async (supabase: Client): Promise<PublicToolsFlag> => {
  try {
    const { data, error } = await supabase
      .from("app_settings").select("value, updated_at").eq("key", PUBLIC_TOOLS_KEY).maybeSingle();
    if (error || !data) return OFF;
    const value = data.value as { enabled?: unknown } | null;
    return { enabled: value?.enabled === true, updatedAt: data.updated_at ?? null };
  } catch {
    return OFF;
  }
});

/**
 * IS THE APP CATALOGUE A VISITOR'S PAGE FOR THIS REQUEST? The switch on, or an
 * admin looking through "Podgląd jako gość" (which shows what the switch would
 * open). Decides where /narzedzia leads — never who may see a tool.
 */
export const publicCatalogueOpen = cache(async (): Promise<boolean> => {
  try {
    if (await guestPreviewActive()) return true;
    return (await getPublicToolsFlag(await createClient())).enabled;
  } catch {
    // Outside a request (a build, a static render): the switch's own default.
    return false;
  }
});

/* ── "Podgląd jako gość" ────────────────────────────────────────────────── */

/**
 * The cookie alone means nothing: the REAL role (the profiles row, guarded by
 * the self-escalation trigger) is read first, so a customer or a stranger who
 * sets it gets exactly what they had. It works with the switch off — that is
 * what it is for: seeing the visitor's interface before opening it.
 */
export const guestPreviewActive = cache(async (): Promise<boolean> => {
  try {
    if ((await cookies()).get(GUEST_PREVIEW_COOKIE)?.value !== "1") return false;
    return await isAdminUser(await createClient());
  } catch {
    return false;
  }
});

