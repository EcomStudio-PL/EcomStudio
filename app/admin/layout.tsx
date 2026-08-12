import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/workspace";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Brand } from "@/components/layout/brand";
import { AdminNav } from "@/components/layout/admin-nav";
import { AdminMobileShell } from "@/components/layout/admin-mobile";

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
      <aside className="glass hidden w-60 shrink-0 flex-col rounded-none border-y-0 border-l-0 px-3 py-5 lg:flex">
        <div className="px-3 pb-2"><Brand href="/admin" /></div>
        <p className="px-3 pb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{t("admin.title")}</p>
        <div className="flex-1 overflow-y-auto"><AdminNav /></div>
        <Link href="/dashboard" className="mt-3 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-raised hover:text-ink">
          ← {t("admin.backToApp")}
        </Link>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminMobileShell />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
