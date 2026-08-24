import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/workspace";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { AdminShell } from "@/components/layout/admin-mobile";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
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
    <div className="flex min-h-dvh w-full min-w-0">
      <AdminSidebar name={profile.full_name ?? profile.email} email={profile.email} role={profile.role}
        stats={{ users: stats.users, usersToday: stats.usersToday, revenueTodayCents: stats.revenueTodayCents, revenue30dCents: stats.revenue30dCents }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminShell name={profile.full_name ?? profile.email} email={profile.email} role={profile.role}
          stats={{ users: stats.users, usersToday: stats.usersToday, revenueTodayCents: stats.revenueTodayCents, revenue30dCents: stats.revenue30dCents }} />
        <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-4 pb-[calc(var(--dock-h)+2rem+env(safe-area-inset-bottom))] pt-5 sm:px-5 lg:px-6 lg:pb-12 lg:pt-6 xl:px-7">
          {children}
        </main>
      </div>
    </div>
  );
}
