import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { formatInstant } from "@/lib/utils";
import { makeT } from "@/lib/i18n/t";
import { GuestShell } from "@/components/public-tools/guest-shell";
import { guestPreviewActive, publicToolAudience, requestPath } from "@/lib/server/public-tools";
import { isPublicToolPath } from "@/lib/public-tools";
import { AppChrome, resolveAppViewer } from "@/components/layout/app-chrome";

export default async function AppLayout({ children, searchParams }: {
  children: React.ReactNode;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  /*
    PUBLIC TOOLS V1. A visitor (or an admin looking through "Podgląd jako
    gość") on a public tool page gets the app's shell with the two doors in
    and none of an account's data. publicToolAudience decides — the switch,
    the catalogue's own visibility — and with the switch off sends a visitor
    to the sign-in dialog exactly as the middleware would have. Every other
    page without a session is answered as before.
  */
  const preview = user ? await guestPreviewActive() : false;
  if (!user || preview) {
    const path = await requestPath();
    if (isPublicToolPath(path)) {
      const audience = await publicToolAudience(path);
      if (audience.kind === "guest") return <GuestShell preview={audience.preview}>{children}</GuestShell>;
    }
  }
  if (!user) redirect("/login");
  // The login security check, the account's records and a block in force —
  // components/layout/app-chrome.tsx, shared with the informational pages.
  const viewer = await resolveAppViewer(supabase, user);
  if (viewer.state === "gate") redirect(viewer.to);
  if (viewer.state === "blocked") {
    const { dict, locale } = await getDictionary();
    const t = makeT(dict);
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-3xl">🔒</p>
          <h1 className="mt-3 font-display text-lg font-semibold">{t("auth2.blockedTitle")}</h1>
          {/* A pause with an end time says the end time. "Contact support" is
              the honest answer only when there is nothing better to say. */}
          <p className="mt-2 text-sm text-muted">
            {viewer.until
              ? t("auth2.blockedUntil", { when: formatInstant(viewer.until, locale) })
              : t("auth2.blockedBody")}
          </p>
          <form method="post" action="/auth/sign-out" className="mt-6">
            <button className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:bg-raised">
              {t("common.signOut")}
            </button>
          </form>
        </div>
      </main>
    );
  }
  if (viewer.state === "missing") {
    // Tell a FAILED read apart from an account that genuinely has no records:
    // reporting "your account could not be set up" for what is really a
    // transport or policy failure is what made a transient look permanent.
    // A real failure raises, and the error boundary offers a retry.
    const { error: probe } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (probe) throw new Error(`account read failed (${probe.code ?? "unknown"})`);
    console.error("app.setup-missing", user.id, "profile:", Boolean(viewer.profile), "workspace:", Boolean(viewer.workspace));
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
  const askedForBonus = ((await searchParams)?.bonus ?? "") === "1";
  return (
    <AppChrome supabase={supabase} user={user} profile={viewer.profile} workspace={viewer.workspace}
      preview={preview} askedForBonus={askedForBonus}>
      {children}
    </AppChrome>
  );
}
