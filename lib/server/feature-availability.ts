import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Client } from "@/lib/services/workspace";
import {
  ACTIVE_STATE, allDefaults, defaultStateFor, isFeatureKey,
  type AvailabilityMap, type FeatureKey, type FeatureState, type FeatureStatus,
} from "@/lib/features";

/**
 * FEATURE AVAILABILITY — server side: read the table, apply the time window,
 * answer "may this render / may this API run". The admin WRITE path lives in
 * app/actions/features.ts; nothing here mutates.
 *
 * Failure posture: any read problem degrades to "everything ACTIVE". The
 * availability switchboard exists to take single modules down on purpose —
 * it must never take the whole product down by accident.
 */

export type FeatureRow = {
  feature_key: string;
  status: string;
  hidden_from_menu: boolean;
  starts_at: string | null;
  ends_at: string | null;
  auto_reenable: boolean;
  custom_title: string | null;
  custom_message: string | null;
  updated_at: string;
  updated_by: string | null;
};

/**
 * The window bounds the RESTRICTION, not the feature: before starts_at the
 * module is still active; after ends_at it reopens when auto_reenable is on,
 * otherwise it stays restricted until the admin acts. `reopensAt` is only
 * ever a date the system will honour by itself — never a promise it won't keep.
 */
export function effectiveState(row: FeatureRow | undefined, now: Date): FeatureState {
  if (!row) return ACTIVE_STATE;
  const status = row.status as FeatureStatus;
  if (status !== "COMING_SOON" && status !== "MAINTENANCE" && status !== "DISABLED") {
    // ACTIVE still carries the admin's menu choice: "visible" and "status" are
    // independent settings (§28), so a feature can be live and still hidden.
    return row.hidden_from_menu ? { ...ACTIVE_STATE, hiddenFromMenu: true } : ACTIVE_STATE;
  }
  const starts = row.starts_at ? new Date(row.starts_at) : null;
  const ends = row.ends_at ? new Date(row.ends_at) : null;
  if (starts && !Number.isNaN(starts.getTime()) && now < starts) return ACTIVE_STATE;
  if (ends && !Number.isNaN(ends.getTime()) && now >= ends && row.auto_reenable) return ACTIVE_STATE;
  const reopensAt = row.auto_reenable && ends && !Number.isNaN(ends.getTime()) && now < ends
    ? ends.toISOString() : null;
  return {
    status,
    hiddenFromMenu: row.hidden_from_menu === true,
    customTitle: row.custom_title?.trim() || null,
    customMessage: row.custom_message?.trim() || null,
    reopensAt,
  };
}

/** One SELECT per request (React cache dedupes the layout + page + API reads
 *  that share a render), overlaid on the registry. */
export const getAvailabilityMap = cache(async (supabase: Client): Promise<AvailabilityMap> => {
  try {
    // ONE query for the whole menu — never one per entry. React's cache()
    // dedupes the layout, the page and any API guard sharing a render.
    const { data, error } = await supabase.from("feature_availability").select("*");
    if (error) return allDefaults();
    const now = new Date();
    const map = allDefaults();
    for (const row of (data ?? []) as FeatureRow[]) {
      // A stored row wins over the registry default; an unknown key (a feature
      // that was removed from the code) is ignored rather than crashing.
      if (isFeatureKey(row.feature_key)) map[row.feature_key] = effectiveState(row, now);
    }
    return map;
  } catch {
    // A configuration outage must never read as "the product is gone": fall
    // back to what the registry declares, and show the customer no error.
    return allDefaults();
  }
});

/** The REAL role check (C9): the profiles row, written only by the DB trigger
 *  guarded against self-escalation — never a query param, header or cookie. */
export const isAdminUser = cache(async (supabase: Client): Promise<boolean> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return data?.role === "admin";
  } catch {
    return false;
  }
});

/** The cookie the admin panel sets for "look at this as a customer". */
export const CLIENT_PREVIEW_COOKIE = "grovbase_client_preview";

/**
 * Does THIS VIEWER get admin treatment right now — the real role, minus a
 * deliberate client-preview. Used by the menu and the gate together, so the
 * drawer and the page can never disagree about what the customer sees.
 *
 * The cookie can only ever take privilege away, which is why it needs no
 * signature: turning it on shows an admin less, never more.
 */
export const viewerIsAdmin = cache(async (supabase: Client): Promise<boolean> => {
  if (!(await isAdminUser(supabase))) return false;
  try {
    return (await cookies()).get(CLIENT_PREVIEW_COOKIE)?.value !== "1";
  } catch {
    return true;
  }
});

/**
 * API-side guard. Returns null when the caller may proceed (feature ACTIVE,
 * or a real admin testing a restricted module), otherwise the blocking
 * status for the route to turn into a 503.
 */
export async function featureBlockedForApi(
  supabase: Client,
  key: FeatureKey,
): Promise<Exclude<FeatureStatus, "ACTIVE"> | null> {
  const map = await getAvailabilityMap(supabase);
  const status = (map[key] ?? defaultStateFor(key)).status;
  if (status === "ACTIVE") return null;
  if (await isAdminUser(supabase)) return null;
  return status;
}
