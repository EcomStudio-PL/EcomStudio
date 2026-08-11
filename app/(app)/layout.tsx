import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { Sidebar, MobileNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [profile, workspace] = await Promise.all([
    getProfile(supabase, user.id),
    getCurrentWorkspace(supabase, user.id),
  ]);
  if (!profile || !workspace) redirect("/login");
  const wallet = await getWallet(supabase, workspace.id);
  const isAdmin = profile.role === "admin";
  return (
    <div className="flex min-h-dvh">
      <Sidebar isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={profile.full_name ?? profile.email} credits={wallet?.balance ?? 0} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>
      <MobileNav isAdmin={isAdmin} />
    </div>
  );
}
