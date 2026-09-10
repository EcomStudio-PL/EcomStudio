import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { LoginForm } from "@/components/auth/login-form";

/**
 * /admin/login — THE OPERATOR'S WAY IN DURING PRE-LAUNCH.
 *
 * It lives in the (auth) group, not under app/admin, on purpose: app/admin
 * has a layout that redirects anyone without a session to sign in, and a
 * sign-in page inside it would redirect to itself. Here it gets the plain auth
 * shell, and /admin/layout.tsx keeps guarding every actual admin screen.
 *
 * WHAT THIS IS NOT. It is not a bypass. There is no magic password, no token
 * in the URL, no header, no environment escape hatch. The form is the SAME
 * LoginForm the public dialog draws and it posts to the SAME /auth/sign-in,
 * which verifies the password, then reads the profiles row to decide whether
 * this account may hold a session while public login is closed. Knowing this
 * address gets a stranger a login form and nothing else — and /admin/layout
 * sends any non-admin who does authenticate to /dashboard.
 *
 * What it IS: a door that does not depend on the marketing homepage. When "/"
 * is the pre-launch page and the dialog there is showing a waiting list, the
 * operator still needs a form; this is that form, at an address that does not
 * change when the front door does.
 *
 * The access panel's own switches are deliberately NOT consulted here. Closing
 * public login must never hide the page that reaches the panel which reopens
 * it — the enforcement is in the sign-in route, where it cannot be skipped.
 */

export const dynamic = "force-dynamic";

// Never indexed, never previewed, never suggested. /admin is already in the
// robots disallow list; this says the same thing per-page, for crawlers that
// only read the tag.
export const metadata: Metadata = {
  title: "Panel",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  // /auth/sign-in bounces a failed attempt from this door back to this door,
  // so the operator reads the reason here rather than on the pre-launch page.
  // It arrives as `e`/`m` because the auth dialog's provider deletes `error`
  // and `email` from the address of every page it is mounted on.
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };

  // The middleware already forwards a signed-in visitor to /admin. This is the
  // same answer computed where it cannot be skipped — a request that reaches
  // the page with a session should never be shown a login form.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/admin");

  return (
    <div className="mx-auto w-full max-w-[440px]">
      <div className="panel relative overflow-hidden rounded-3xl p-5 sm:p-6">
        <span className="brand-gradient flex h-11 w-11 items-center justify-center rounded-2xl">
          <ShieldCheck size={22} className="text-white" aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-[21px] font-semibold tracking-tight">
          {t("adminLogin.title")}
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
          {t("adminLogin.sub")}
        </p>
        <div className="mt-5">
          {/* `next` is a fixed literal, not a query parameter: this page has
              exactly one destination, and an open redirect is not something to
              re-invent on the admin path. /auth/sign-in validates it anyway. */}
          <LoginForm next="/admin" error={one("e")} email={one("m")} showSignup={false} />
        </div>
      </div>
      <p className="mt-4 text-center text-[12px] leading-relaxed text-faint">
        {t("adminLogin.note")}
      </p>
    </div>
  );
}
