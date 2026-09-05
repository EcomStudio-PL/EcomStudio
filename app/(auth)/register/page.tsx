import { createClient } from "@/lib/supabase/server";
import { getRegistrationConfig } from "@/lib/server/registration-config";
import { RegisterForm } from "@/components/auth/register-form";

/**
 * Server shell around the (client) registration form. It fetches the two
 * things the form cannot know for itself.
 *
 * The PUBLIC Turnstile site key: captcha_site_key() returns "" unless the
 * admin has saved BOTH halves (site key + secret envelope), so a
 * half-configured captcha can never demand a token the server cannot verify —
 * the form simply renders without the widget. Same on an RPC error: no key,
 * no captcha, registration keeps working.
 *
 * And which optional fields to ask for: getRegistrationConfig falls back to
 * the seeded defaults when the settings row is missing or malformed, so this
 * page renders the full form rather than an empty one if the read degrades.
 */
export default async function RegisterPage() {
  const supabase = await createClient();
  const [{ data }, registration] = await Promise.all([
    supabase.rpc("captcha_site_key"),
    getRegistrationConfig(supabase),
  ]);
  return <RegisterForm captchaSiteKey={data ?? ""} fields={registration.signup} />;
}
