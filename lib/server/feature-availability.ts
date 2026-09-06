import "server-only";
import { cache } from "react";
import type { Client } from "@/lib/services/workspace";
import {
  ACTIVE_STATE, allActive, isFeatureKey,
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
    return ACTIVE_STATE;
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
    const { data, error } = await supabase.from("feature_availability").select("*");
    if (error) return allActive();
    const now = new Date();
    const map = allActive();
    for (const row of (data ?? []) as FeatureRow[]) {
      if (isFeatureKey(row.feature_key)) map[row.feature_key] = effectiveState(row, now);
    }
    return map;
  } catch {
    return allActive();
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
  const status = (map[key] ?? ACTIVE_STATE).status;
  if (status === "ACTIVE") return null;
  if (await isAdminUser(supabase)) return null;
  return status;
}
