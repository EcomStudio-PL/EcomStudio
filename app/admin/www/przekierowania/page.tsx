import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { listRedirects } from "@/lib/services/cms";
import { RedirectManager } from "@/components/admin/cms/redirects";
import { CmsNav } from "@/components/admin/cms/cms-nav";

/**
 * REDIRECTS, their own screen.
 *
 * Kept out of the page list on purpose: a redirect is not a page, and the
 * list of pages is what that screen is for.
 */
export default async function RedirectsRoute() {
  const supabase = await createClient();
  const [rows, { locale }] = await Promise.all([listRedirects(supabase), getDictionary()]);
  return (
    <div>
      <CmsNav />
      <RedirectManager rows={rows} locale={locale} />
    </div>
  );
}
