"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import {
  REGISTRATION_SETTINGS_KEY, SIGNUP_FIELD_KEYS, WAITLIST_FIELD_KEYS, isFieldMode,
  type FieldMode, type RegistrationFields,
} from "@/lib/server/registration-config";

/**
 * WHICH FIELDS THE SIGNUP FORMS ASK FOR — the one write behind that decision.
 *
 * The role is re-checked here rather than trusted from the admin layout: a
 * server action is its own entry point, and a session that is no longer an
 * admin must not be able to rewrite the registration form by replaying a call.
 *
 * Error codes: forbidden · invalid · generic.
 */

type Result = { ok: true } | { ok: false; error: string };

const ADMIN_PATH = "/admin/settings/registration";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/** requireAdmin throws so no action body can forget it; this is where that
 *  throw becomes a code, and anything else becomes "generic". */
function reason(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  return message === "unauthenticated" || message === "not_admin" ? "forbidden" : "generic";
}

/**
 * The seven modes, keyed the way 0055 stores them — or null when one of them
 * is missing or is not one of the three words.
 *
 * All-or-nothing on purpose: a word the forms do not understand reads back as
 * the seeded default, which would silently undo the admin's choice on the very
 * screen that reports "saved".
 */
function normalise(input: RegistrationFields): Record<string, FieldMode> | null {
  const groups: [Readonly<Record<string, string>>, unknown][] = [
    [SIGNUP_FIELD_KEYS, input?.signup],
    [WAITLIST_FIELD_KEYS, input?.waitlist],
  ];
  const row: Record<string, FieldMode> = {};
  for (const [keys, group] of groups) {
    if (!group || typeof group !== "object") return null;
    const values = group as Record<string, unknown>;
    for (const [field, storedKey] of Object.entries(keys)) {
      const mode = values[field];
      if (!isFieldMode(mode)) return null;
      row[storedKey] = mode;
    }
  }
  return row;
}

export async function saveRegistrationConfigAction(input: RegistrationFields): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const row = normalise(input);
    if (!row) return { ok: false, error: "invalid" };

    // The whole row is replaced rather than merged: normalise() just produced
    // every key the readers look at, so a merge could only preserve a stale
    // key from an older shape.
    const { error } = await supabase.from("app_settings").upsert(
      { key: REGISTRATION_SETTINGS_KEY, value: row },
      { onConflict: "key" },
    );
    if (error) return { ok: false, error: "generic" };

    // Nothing here is a credential — it is a list of form fields — so the
    // audit entry records the modes themselves and stays readable.
    await logAudit(supabase, {
      actorId: adminId, action: "registration.config_saved",
      entityType: "app_settings", entityId: REGISTRATION_SETTINGS_KEY,
      after: row,
    });

    // Both forms are server-rendered: /register reads the config beside the
    // captcha site key, and "/" renders the launch page in place when the
    // waitlist is the live front door.
    revalidatePath("/register");
    revalidatePath("/");
    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: reason(e) };
  }
}
