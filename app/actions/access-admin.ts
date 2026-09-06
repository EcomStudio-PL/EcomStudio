"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import {
  ACCESS_SETTINGS_KEY, LEGACY_SECURITY_KEY, getPlatformAccess,
} from "@/lib/server/platform-access";
import type { AccessCopy, PlatformAccess } from "@/lib/platform-access";

/**
 * ADMIN — who may get into the platform.
 *
 * Four switches, a schedule and the words a shut door says. The role is
 * re-checked on every write because a server action is its own entry point,
 * and every string is clamped here rather than trusted.
 *
 * One subtlety worth stating: `allow_signup` is mirrored into the older
 * `security.registration_enabled` flag. That flag already existed and already
 * closed registration; leaving the two independent would mean two panels
 * quietly disagreeing about the same door. There is one configuration, written
 * in two places for compatibility, and never two sources of truth.
 */

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const PAGE = "/admin/settings/access";

export type AccessSaveInput = {
  allowSignup: boolean;
  allowLogin: boolean;
  showAuthEntry: boolean;
  waitlistEnabled: boolean;
  /** ISO instant, or null for "no schedule". The client converts from the
   *  admin's own zone; what is stored and compared is always UTC. */
  signupOpensAt: string | null;
  copy: AccessCopy;
  mobileOverride: boolean;
  mobileCopy: AccessCopy;
};

const clampCopy = (c: AccessCopy): AccessCopy => {
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 400) : "");
  return {
    loginTitle: s(c?.loginTitle), loginBody: s(c?.loginBody), loginCta: s(c?.loginCta),
    signupTitle: s(c?.signupTitle), signupBody: s(c?.signupBody), signupCta: s(c?.signupCta),
    closedTitle: s(c?.closedTitle), closedBody: s(c?.closedBody),
  };
};

export async function saveAccessConfigAction(input: AccessSaveInput): Promise<Result> {
  try {
    let opensAt: string | null = null;
    if (typeof input.signupOpensAt === "string" && input.signupOpensAt.trim() !== "") {
      const d = new Date(input.signupOpensAt);
      if (Number.isNaN(d.getTime())) return { ok: false, error: "date" };
      opensAt = d.toISOString();
    }

    const { supabase, adminId } = await requireAdmin();
    const allowSignup = input.allowSignup === true;

    const { error } = await supabase.from("app_settings").upsert({
      key: ACCESS_SETTINGS_KEY,
      value: {
        allow_signup: allowSignup,
        allow_login: input.allowLogin === true,
        show_auth_entry: input.showAuthEntry === true,
        waitlist_enabled: input.waitlistEnabled === true,
        signup_opens_at: opensAt,
        copy: clampCopy(input.copy),
        mobile_override: input.mobileOverride === true,
        mobile_copy: clampCopy(input.mobileCopy),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) return { ok: false, error: "generic" };

    // Keep the legacy kill switch in step. Read-modify-write so the other
    // security settings living in the same row (IP cap, maintenance mode)
    // survive untouched.
    const { data: legacyRow } = await supabase
      .from("app_settings").select("value").eq("key", LEGACY_SECURITY_KEY).maybeSingle();
    const legacy = (legacyRow?.value ?? {}) as Record<string, unknown>;
    if (legacy.registration_enabled !== allowSignup) {
      await supabase.from("app_settings").upsert({
        key: LEGACY_SECURITY_KEY,
        value: { ...legacy, registration_enabled: allowSignup },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    }

    await logAudit(supabase, {
      actorId: adminId, action: "platform_access.saved",
      entityType: "app_settings", entityId: ACCESS_SETTINGS_KEY,
      after: {
        allow_signup: allowSignup,
        allow_login: input.allowLogin === true,
        show_auth_entry: input.showAuthEntry === true,
        waitlist_enabled: input.waitlistEnabled === true,
        signup_opens_at: opensAt,
      },
    });
    revalidatePath(PAGE);
    // The public front doors read this on every render; the landing page is
    // cached per-tag, and the header block sits outside that cache.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** The saved configuration, for the panel to edit. */
export async function accessConfigAction(): Promise<PlatformAccess | null> {
  try {
    const { supabase } = await requireAdmin();
    return await getPlatformAccess(supabase);
  } catch {
    return null;
  }
}
