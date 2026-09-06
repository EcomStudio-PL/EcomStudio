"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { CLIENT_PREVIEW_COOKIE } from "@/lib/server/feature-availability";
import {
  FEATURE_REGISTRY, FEATURE_STATUSES, defaultStatusFor, isFeatureKey,
  type FeatureGroup, type FeatureKey, type FeatureStatus,
} from "@/lib/features";

/**
 * FEATURE AVAILABILITY — admin writes. Re-checks the admin role here (a
 * server action is its own entry point) and refuses any key outside the
 * registry, so the C11 modules (login, auth confirm, security verification,
 * settings, billing) are unreachable by construction — there is no key to
 * write for them.
 */

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const PAGE = "/admin/settings/features";

export type FeatureSaveInput = {
  key: string;
  status: FeatureStatus;
  hiddenFromMenu: boolean;
  startsAt: string | null;
  endsAt: string | null;
  autoReenable: boolean;
  customTitle: string;
  customMessage: string;
};

function parseWhen(value: string | null): { ok: boolean; iso: string | null } {
  if (!value) return { ok: true, iso: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { ok: false, iso: null };
  return { ok: true, iso: d.toISOString() };
}

export async function saveFeatureAvailabilityAction(input: FeatureSaveInput): Promise<Result> {
  try {
    if (!isFeatureKey(input.key)) return { ok: false, error: "invalid" };
    if (!FEATURE_STATUSES.includes(input.status)) return { ok: false, error: "invalid" };
    const starts = parseWhen(input.startsAt);
    const ends = parseWhen(input.endsAt);
    if (!starts.ok || !ends.ok) return { ok: false, error: "invalid" };
    if (starts.iso && ends.iso && starts.iso >= ends.iso) return { ok: false, error: "window" };

    const { supabase, adminId } = await requireAdmin();
    const row = {
      feature_key: input.key,
      status: input.status,
      hidden_from_menu: input.hiddenFromMenu === true,
      starts_at: starts.iso,
      ends_at: ends.iso,
      auto_reenable: input.autoReenable === true,
      custom_title: input.customTitle.trim().slice(0, 120) || null,
      custom_message: input.customMessage.trim().slice(0, 500) || null,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    };
    const { error } = await supabase.from("feature_availability")
      .upsert(row, { onConflict: "feature_key" });
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "feature_availability.saved",
      entityType: "feature_availability", entityId: input.key,
      after: { status: row.status, hidden: row.hidden_from_menu, starts_at: row.starts_at, ends_at: row.ends_at, auto_reenable: row.auto_reenable },
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** Batch (C7): one status for a set of keys — "wyłącz wszystkie narzędzia",
 *  "włącz wszystko". Unknown keys are refused, not skipped silently. */
export async function batchFeatureStatusAction(keys: FeatureKey[], status: FeatureStatus): Promise<Result> {
  try {
    if (!FEATURE_STATUSES.includes(status)) return { ok: false, error: "invalid" };
    const unique = [...new Set(keys)];
    if (unique.length === 0 || unique.some((k) => !isFeatureKey(k))) return { ok: false, error: "invalid" };

    const { supabase, adminId } = await requireAdmin();
    const now = new Date().toISOString();
    const rows = unique.map((key) => ({
      feature_key: key,
      status,
      // A batch is a blunt switch: it clears any scheduled window so the new
      // status means what it says, immediately.
      starts_at: null,
      ends_at: null,
      updated_at: now,
      updated_by: adminId,
    }));
    const { error } = await supabase.from("feature_availability")
      .upsert(rows, { onConflict: "feature_key" });
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "feature_availability.batch",
      entityType: "feature_availability", entityId: unique.join(","),
      after: { status, count: unique.length },
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/**
 * Batch menu visibility — "ukryj w menu" / "pokaż w menu" for a selection.
 * Deliberately independent of the status (§28): a live module can be hidden
 * while it is being piloted, and a restricted one can stay listed so the
 * customer sees the WKRÓTCE badge instead of silently losing the entry.
 */
export async function batchMenuVisibilityAction(keys: FeatureKey[], hidden: boolean): Promise<Result> {
  try {
    const unique = [...new Set(keys)];
    if (unique.length === 0 || unique.some((k) => !isFeatureKey(k))) return { ok: false, error: "invalid" };

    const { supabase, adminId } = await requireAdmin();
    const now = new Date().toISOString();
    // Read first: a menu-only change must not reset a status the admin set.
    const { data: existing } = await supabase.from("feature_availability")
      .select("feature_key, status").in("feature_key", unique);
    const statusByKey = new Map((existing ?? []).map((r) => [r.feature_key as string, r.status as FeatureStatus]));
    const rows = unique.map((key) => ({
      feature_key: key,
      status: statusByKey.get(key) ?? defaultStatusFor(key),
      hidden_from_menu: hidden,
      updated_at: now,
      updated_by: adminId,
    }));
    const { error } = await supabase.from("feature_availability")
      .upsert(rows, { onConflict: "feature_key" });
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "feature_availability.menu",
      entityType: "feature_availability", entityId: unique.join(","),
      after: { hidden, count: unique.length },
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/**
 * "Podgląd jako klient" — an admin asks to be shown exactly what a customer
 * sees. The cookie only ever REMOVES privilege (lib/server/feature-availability
 * checks the real role first), so it is a view preference, not a security
 * boundary, and it never needs a signature.
 */
export async function setClientPreviewAction(on: boolean): Promise<Result> {
  try {
    await requireAdmin();
    const jar = await cookies();
    if (on) {
      jar.set(CLIENT_PREVIEW_COOKIE, "1", {
        httpOnly: true, sameSite: "lax", path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 8,
      });
    } else {
      jar.delete(CLIENT_PREVIEW_COOKIE);
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** Is this admin currently previewing the app as a customer? */
export async function clientPreviewStateAction(): Promise<boolean> {
  try {
    await requireAdmin();
    return (await cookies()).get(CLIENT_PREVIEW_COOKIE)?.value === "1";
  } catch {
    return false;
  }
}

export type FeatureAdminRow = {
  key: FeatureKey;
  nameKey: string;
  path: string;
  group: FeatureGroup;
  status: FeatureStatus;
  hiddenFromMenu: boolean;
  startsAt: string | null;
  endsAt: string | null;
  autoReenable: boolean;
  customTitle: string;
  customMessage: string;
  updatedAt: string | null;
};

/** Registry × stored rows for the admin tiles. */
export async function listFeatureAvailabilityAction(): Promise<FeatureAdminRow[] | null> {
  try {
    const { supabase } = await requireAdmin();
    const { data } = await supabase.from("feature_availability").select("*");
    const byKey = new Map((data ?? []).map((r) => [r.feature_key, r]));
    return FEATURE_REGISTRY.map((entry) => {
      const row = byKey.get(entry.key);
      return {
        key: entry.key,
        nameKey: entry.nameKey,
        path: entry.path,
        group: entry.group,
        // No row means the registry default — which is ACTIVE for everything
        // except the modules that honestly have no backend yet.
        status: (row?.status as FeatureStatus | undefined) ?? defaultStatusFor(entry.key),
        hiddenFromMenu: row?.hidden_from_menu === true,
        startsAt: row?.starts_at ?? null,
        endsAt: row?.ends_at ?? null,
        autoReenable: row ? row.auto_reenable === true : true,
        customTitle: row?.custom_title ?? "",
        customMessage: row?.custom_message ?? "",
        updatedAt: row?.updated_at ?? null,
      };
    });
  } catch {
    return null;
  }
}
