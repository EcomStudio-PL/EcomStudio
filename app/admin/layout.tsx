import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/workspace";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Brand } from "@/components/layout/brand";
import { AdminNav } from "@/components/layout/admin-nav";
import { AdminShell } from "@/components/layout/admin-mobile";
import { adminBusinessStats } from "@/lib/services/admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const profile = await getProfile(supabase, user.id);
  if (profile?.role !== "admin") redirect("/dashboard");
  const [{ dict }, stats] = await Promise.all([getDictionary(), adminBusinessStats(supabase)]);
  const t = makeT(dict);

  return (
    <div className="flex min-h-dvh">
      <aside className="glass hidden w-60 shrink-0 flex-col rounded-none border-y-0 border-l-0 px-3 py-5 lg:flex">
        <div className="px-3 pb-2"><Brand href="/admin" /></div>
        <p className="px-3 pb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{t("admin.title")}</p>
        <div className="flex-1 overflow-y-auto"><AdminNav /></div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminShell name={profile.full_name ?? profile.email} email={profile.email} role={profile.role}
          stats={{ users: stats.users, usersToday: stats.usersToday, revenueTodayCents: stats.revenueTodayCents, revenue30dCents: stats.revenue30dCents }} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}
