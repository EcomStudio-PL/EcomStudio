import { createClient } from "@/lib/supabase/server";
import { RegisterForm } from "@/components/auth/register-form";

/**
 * Server shell around the (client) registration form. Its one job is fetching
 * the PUBLIC Turnstile site key: captcha_site_key() returns "" unless the
 * admin has saved BOTH halves (site key + secret envelope), so a
 * half-configured captcha can never demand a token the server cannot verify —
 * the form simply renders without the widget. Same on an RPC error: no key,
 * no captcha, registration keeps working.
 */
export default async function RegisterPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("captcha_site_key");
  return <RegisterForm captchaSiteKey={data ?? ""} />;
}
