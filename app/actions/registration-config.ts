"use server";
import { createClient } from "@/lib/supabase/server";
import {
  getRegistrationConfig, REGISTRATION_DEFAULTS, type RegistrationConfig,
} from "@/lib/server/registration-config";

export type RegistrationFormConfig = {
  /** The PUBLIC Turnstile site key. Empty unless the admin saved BOTH halves,
   *  so a half-configured captcha never demands a token the server cannot
   *  verify — the form simply renders without the widget. */
  captchaSiteKey: string;
  fields: RegistrationConfig;
  /** Credits a NEW account actually receives at signup — the number the DB
   *  trigger grants, read from the same function it calls. One source of
   *  truth: the dialog's subtitle and its benefits list both render this, so
   *  they cannot disagree with each other or with the wallet. It is NOT the
   *  72-hour welcome bonus, which is a separate, larger, claimable grant. */
  signupCredits: number;
};

/**
 * What the registration form needs and the browser cannot know, fetched when
 * the auth dialog first opens its register mode.
 *
 * The same two values /register's server shell has always read — this is the
 * lazy door to them, not a second source. Nothing secret crosses: the site key
 * is public by definition and the field config is what the form renders.
 * A failed read degrades to "no captcha, default fields", exactly as the page
 * does, rather than blocking signup.
 */
export async function registrationFormConfig(): Promise<RegistrationFormConfig> {
  try {
    const supabase = await createClient();
    const [{ data }, registration, credits] = await Promise.all([
      supabase.rpc("captcha_site_key"),
      getRegistrationConfig(supabase),
      supabase.rpc("get_welcome_credits"),
    ]);
    const granted = Number(credits.data);
    return {
      captchaSiteKey: data ?? "",
      fields: registration.signup,
      // A number we could not read is not shown at all — better a sentence
      // without a figure than a figure that is wrong.
      signupCredits: Number.isFinite(granted) && granted > 0 ? granted : 0,
    };
  } catch {
    // No captcha rather than no signup: the server action still enforces
    // everything on submit, so the worst case here is a form the admin
    // configured slightly differently, not an unguarded registration.
    return { captchaSiteKey: "", fields: REGISTRATION_DEFAULTS.signup, signupCredits: 0 };
  }
}
