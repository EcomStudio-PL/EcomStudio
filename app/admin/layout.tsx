import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/workspace";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Brand } from "@/components/layout/brand";
import { AdminNav } from "@/components/layout/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const profile = await getProfile(supabase, user.id);
  if (profile?.role !== "admin") redirect("/dashboard");
  const { dict } = await getDictionary();
  const t = makeT(dict);

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="px-3 pb-2"><Brand href="/admin" /></div>
        <p className="px-3 pb-4 text-xs font-medium uppercase tracking-wide text-muted">{t("admin.title")}</p>
        <AdminNav />
        <Link href="/dashboard" className="mt-auto rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-raised hover:text-ink">
          ← {t("admin.backToApp")}
        </Link>
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">
        <div className="mb-4 lg:hidden">
          <Link href="/dashboard" className="text-sm text-muted">← {t("admin.backToApp")}</Link>
        </div>
        {children}
      </main>
    </div>
  );
}
