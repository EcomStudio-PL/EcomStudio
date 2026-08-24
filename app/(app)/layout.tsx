import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Sidebar, MobileNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CustomerDrawer } from "@/components/layout/customer-drawer";
import { DrawerProvider } from "@/components/layout/shell-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  let [profile, workspace] = await Promise.all([
    getProfile(supabase, user.id),
    getCurrentWorkspace(supabase, user.id),
  ]);
  if (!profile || !workspace) {
    // Recovery: the user exists in auth but application records are missing
    // (account created outside the normal signup flow). Self-heal idempotently.
    await supabase.rpc("bootstrap_current_user");
    [profile, workspace] = await Promise.all([
      getProfile(supabase, user.id),
      getCurrentWorkspace(supabase, user.id),
    ]);
  }
  if (profile?.blocked) {
    const { dict } = await getDictionary();
    const t = makeT(dict);
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-3xl">🔒</p>
          <h1 className="mt-3 font-display text-lg font-semibold">{t("auth2.blockedTitle")}</h1>
          <p className="mt-2 text-sm text-muted">{t("auth2.blockedBody")}</p>
          <form method="post" action="/auth/sign-out" className="mt-6">
            <button className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:bg-raised">
              {t("common.signOut")}
            </button>
          </form>
        </div>
      </main>
    );
  }
  if (!profile || !workspace) {
    const { dict } = await getDictionary();
    const t = makeT(dict);
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-3xl">⚠️</p>
          <h1 className="mt-3 font-display text-lg font-semibold">{t("auth.setupErrorTitle")}</h1>
          <p className="mt-2 text-sm text-muted">{t("auth.setupErrorBody")}</p>
          <form method="post" action="/auth/sign-out" className="mt-6">
            <button className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:bg-raised">
              {t("common.signOut")}
            </button>
          </form>
        </div>
      </main>
    );
  }
  const [wallet, { data: sub }, { data: notifs }] = await Promise.all([
    getWallet(supabase, workspace.id),
    supabase.from("subscriptions").select("subscription_plans(name)")
      .eq("workspace_id", workspace.id).eq("status", "active").maybeSingle(),
    supabase.from("notifications").select("id, type, title, body, href, read_at, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
  ]);
  const unread = (notifs ?? []).filter((n) => !n.read_at).length;
  const planName = sub?.subscription_plans?.name ?? "Free";
  const isAdmin = profile.role === "admin";
  const displayName = profile.full_name ?? profile.email;
  return (
    <DrawerProvider>
      <div className="flex min-h-dvh w-full min-w-0">
        <Sidebar name={displayName} email={profile.email} credits={wallet?.balance ?? 0} plan={planName} isAdmin={isAdmin} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar name={displayName} credits={wallet?.balance ?? 0} workspace={workspace.name} isAdmin={isAdmin} notifications={notifs ?? []} unread={unread} />
          <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 pb-[calc(var(--dock-h)+2rem+env(safe-area-inset-bottom))] pt-6 sm:px-5 lg:px-8 lg:pb-12">
            {children}
          </main>
        </div>
        <MobileNav />
        <CustomerDrawer name={displayName} email={profile.email} credits={wallet?.balance ?? 0} plan={planName} isAdmin={isAdmin} />
      </div>
    </DrawerProvider>
  );
}
