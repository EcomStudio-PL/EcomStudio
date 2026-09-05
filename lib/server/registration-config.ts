import "server-only";
import type { Client } from "@/lib/services/workspace";

/**
 * WHAT THE TWO SIGNUP FORMS ASK FOR.
 *
 * The columns behind these fields already exist — profiles.first_name /
 * last_name / phone / acquisition_source since 0039, the waitlist's three
 * since 0055 — so this row decides what is ASKED, never what can be stored.
 *
 * Three answers per field rather than a checkbox, because "not asked" and
 * "asked but not insisted on" are different products: a required phone number
 * costs signups, a hidden one costs the sales call that would have followed.
 *
 * The store is app_settings."registration", which 0055 seeds with FLAT STRING
 * VALUES on purpose — /admin/system renders every settings row through a
 * generic editor that would print a nested object as "[object Object]" and
 * save it back the same way. The `wl_` prefix is what keeps the landing form's
 * three fields flat instead of nested, and this module is the only place that
 * has to know those spellings.
 *
 * Nothing here throws at the caller. A missing row, an RLS refusal or a value
 * nobody recognises degrades to the seeded defaults, because a broken setting
 * must never take the registration page down with it.
 */

export type FieldMode = "hidden" | "optional" | "required";

export type RegistrationConfig = {
  firstName: FieldMode;
  lastName: FieldMode;
  phone: FieldMode;
  acquisition: FieldMode;
};

/** The landing form asks for less by design — no acquisition question on a
 *  page whose whole job is one address. */
export type WaitlistFieldConfig = {
  firstName: FieldMode;
  lastName: FieldMode;
  phone: FieldMode;
};

export type RegistrationFields = { signup: RegistrationConfig; waitlist: WaitlistFieldConfig };

/** The settings row, spelled once. */
export const REGISTRATION_SETTINGS_KEY = "registration";

export const FIELD_MODES: readonly FieldMode[] = ["hidden", "optional", "required"];

/**
 * Field → the flat key 0055 stores it under. The reader below and the admin
 * action both walk these maps, so the two halves of the round trip cannot
 * drift and no other file has to repeat a key name.
 */
export const SIGNUP_FIELD_KEYS: Readonly<Record<keyof RegistrationConfig, string>> = {
  firstName: "first_name",
  lastName: "last_name",
  phone: "phone",
  acquisition: "acquisition",
};

export const WAITLIST_FIELD_KEYS: Readonly<Record<keyof WaitlistFieldConfig, string>> = {
  firstName: "wl_first_name",
  lastName: "wl_last_name",
  phone: "wl_phone",
};

/** Exactly what 0055 seeds, so a deployment whose row was never saved and one
 *  saved with the defaults render identically. Exported because the admin UI
 *  and the forms have to agree on what "unset" looks like. */
export const REGISTRATION_DEFAULTS: RegistrationFields = {
  signup: { firstName: "required", lastName: "required", phone: "optional", acquisition: "optional" },
  waitlist: { firstName: "optional", lastName: "hidden", phone: "optional" },
};

export function isFieldMode(value: unknown): value is FieldMode {
  return typeof value === "string" && (FIELD_MODES as readonly string[]).includes(value);
}

/** One group of fields, read off the flat row. Anything absent or unrecognised
 *  falls back per field, so a single bad value never blanks the rest. */
function readGroup<K extends string>(
  row: Record<string, unknown>,
  keys: Readonly<Record<K, string>>,
  defaults: Record<K, FieldMode>,
): Record<K, FieldMode> {
  const out = {} as Record<K, FieldMode>;
  for (const field of Object.keys(keys) as K[]) {
    const stored = row[keys[field]];
    out[field] = isFieldMode(stored) ? stored : defaults[field];
  }
  return out;
}

export async function getRegistrationConfig(supabase: Client): Promise<RegistrationFields> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", REGISTRATION_SETTINGS_KEY).maybeSingle();
  // jsonb can legally hold a string or an array; only an object has keys worth
  // reading, and everything else means "use the defaults".
  const value = data?.value;
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    signup: readGroup(row, SIGNUP_FIELD_KEYS, REGISTRATION_DEFAULTS.signup),
    waitlist: readGroup(row, WAITLIST_FIELD_KEYS, REGISTRATION_DEFAULTS.waitlist),
  };
}
