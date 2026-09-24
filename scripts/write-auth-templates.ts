/**
 * Regenerate supabase/templates/*.html from the single source of truth.
 *
 * The HTML in lib/server/auth-email-templates.ts is what actually goes out —
 * the Send Email Hook renders it. These files exist so the same markup is in
 * version control and can be pasted into the Supabase dashboard if the hook is
 * ever switched off. scripts/template-tests.ts asserts the two are identical,
 * so run this after touching the templates or the shared card.
 *
 * Run: npx tsx scripts/write-auth-templates.ts
 */
import { writeFileSync } from "fs";
import { AUTH_EMAIL_TEMPLATES } from "../lib/server/auth-email-templates";

const FILES: Record<string, string> = {
  "auth.confirm_signup": "supabase/templates/confirm-signup.html",
  "auth.reset_password": "supabase/templates/reset-password.html",
};

for (const [key, file] of Object.entries(FILES)) {
  const tpl = AUTH_EMAIL_TEMPLATES[key];
  if (!tpl) throw new Error(`no template for ${key}`);
  writeFileSync(file, tpl.html, "utf8");
  console.log(`wrote ${file} (${tpl.html.length} bytes)`);
}
