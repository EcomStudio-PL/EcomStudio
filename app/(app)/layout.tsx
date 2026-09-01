import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentWorkspace, getCurrentWorkspaceFresh, getProfile, getProfileFresh,
} from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { MegaTopbar } from "@/components/layout/mega-topbar";
import { CustomerDrawer } from "@/components/layout/customer-drawer";
import { CustomerBottomNav } from "@/components/layout/customer-bottom-nav";
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
    // (account created outside the normal signup flow), OR this is the very
    // first request after sign-in and the read raced the fresh session.
    // Self-heal idempotently, then read again — the second read is what
    // usually succeeds, so a real account never lands on the error screen
    // just because it arrived a few hundred milliseconds early.
    const { error: bootstrapError } = await supabase.rpc("bootstrap_current_user");
    if (bootstrapError) console.error("bootstrap", bootstrapError.code, bootstrapError.message);
    for (let attempt = 0; attempt < 2 && (!profile || !workspace); attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 350));
      // The Fresh readers bypass the per-request memo: this loop exists to
      // observe rows the bootstrap RPC just created, and the cached getters
      // would replay the pre-bootstrap null.
      [profile, workspace] = await Promise.all([
        getProfileFresh(supabase, user.id),
        getCurrentWorkspaceFresh(supabase, user.id),
      ]);
    }
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
    // Tell a FAILED read apart from an account that genuinely has no records:
    // reporting "your account could not be set up" for what is really a
    // transport or policy failure is what made a transient look permanent.
    // A real failure raises, and the error boundary offers a retry.
    const { error: probe } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (probe) throw new Error(`account read failed (${probe.code ?? "unknown"})`);
    console.error("app.setup-missing", user.id, "profile:", Boolean(profile), "workspace:", Boolean(workspace));
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
      {/* Horizontal-navigation shell per the UX spec: no permanent left
          sidebar — the full width belongs to the work. */}
      {/* `app-shell` is a hook, not a style: a work-surface page (the
          generator) turns this frame into a viewport-height box so the page
          itself stops scrolling. Every other page keeps min-h-dvh and
          scrolls normally. */}
      <div className="app-shell flex min-h-dvh w-full min-w-0 flex-col">
        <MegaTopbar name={displayName} email={profile.email} credits={wallet?.balance ?? 0} plan={planName} isAdmin={isAdmin} notifications={notifs ?? []} unread={unread} />
        {/* Full-width work surface. The bottom padding is DERIVED from the
            chrome tokens, so the fixed navigation can never cover the last
            element on the page — the defect that showed up on every phone
            screenshot. */}
        <main className="mx-auto w-full min-w-0 max-w-[var(--content-max)] flex-1 px-[var(--page-x)] pt-4 pb-[var(--page-bottom)] sm:px-6 sm:pt-5 lg:px-8 lg:pb-14 lg:pt-6 xl:px-10">
          {children}
        </main>
        <CustomerBottomNav name={displayName} />
        <CustomerDrawer name={displayName} email={profile.email} credits={wallet?.balance ?? 0} plan={planName} isAdmin={isAdmin} />
      </div>
    </DrawerProvider>
  );
}
