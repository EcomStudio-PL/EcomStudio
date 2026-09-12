import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/services/workspace";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { AdminShell } from "@/components/layout/admin-mobile";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { adminBusinessStats } from "@/lib/services/admin";
import { enforceLoginSecurity } from "@/lib/server/login-security";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // TWO CHECKS, ONE WAIT. The step-up gate — an admin on a new device confirms
  // a code before the admin surface, with its customer data, will render — and
  // the role lookup both need only the user id, and neither reads what the
  // other writes. Running them in sequence meant every admin page paid for two
  // round trips to learn two independent facts.
  //
  // Both still decide BEFORE anything is fetched or rendered: the redirects are
  // below, and adminBusinessStats does not start until the role is known.
  const [gate, profile] = await Promise.all([
    enforceLoginSecurity(supabase),
    getProfile(supabase, user.id),
  ]);
  if (gate) redirect(gate);
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
