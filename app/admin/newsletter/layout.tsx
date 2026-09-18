import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { NewsletterNav } from "@/components/admin/newsletter/nav";

/**
 * THE NEWSLETTER MODULE'S SHELL.
 *
 * One header and one sub-navigation for all nine screens, so a page inside
 * this module never has to remember to render either.
 *
 * THE ROLE CHECK IS HERE AS WELL AS IN RLS, and both are load-bearing for
 * different reasons. RLS is the lock: a non-admin who reaches any of these
 * routes gets empty result sets from every query, because every newsletter
 * table answers `is_admin()`. This check is the DOOR: it turns "a screen full
 * of zeroes" into "you are not supposed to be here", and it stops a
 * non-admin's browser from even rendering the shell. Hiding the menu entry is
 * neither of those things and would not be enough on its own.
 */
export default async function NewsletterLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") redirect("/dashboard");

  const { dict } = await getDictionary();
  const t = makeT(dict);

  return (
    <div>
      <PageHeader
        overline={t("admin.navGroups.marketing")}
        title={t("newsletter.title")}
        sub={t("newsletter.sub")}
      />
      <NewsletterNav />
      {children}
    </div>
  );
}
