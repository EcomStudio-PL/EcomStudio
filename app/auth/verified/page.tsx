import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Card } from "@/components/ui/card";
import { ResendLink } from "@/components/auth/resend-link";

/**
 * Where /auth/confirm sends people. One card, two states:
 *
 *  - default: the address is verified. The primary action depends on whether
 *    the confirmation actually established a session (it usually does, but a
 *    link opened in another browser verifies without signing in) — into the
 *    app when it did, to /login when it did not. Checked server-side; the
 *    button never promises a session that is not there.
 *  - ?state=invalid: expired / already-used / malformed link. Offers a
 *    fresh confirmation email instead of a dead end.
 */
export default async function VerifiedPage({ searchParams }: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const { dict } = await getDictionary();
  const t = makeT(dict);

  if (state === "invalid") {
    return (
      <Card className="relative mx-auto w-full max-w-md overflow-hidden p-6 text-center sm:p-8">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
          style={{ background: "radial-gradient(18rem 7rem at 50% -30%, rgb(var(--warning) / 0.14), transparent 70%)" }} />
        <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--warning)/0.14)] text-warning">
          <AlertTriangle size={26} aria-hidden />
        </span>
        <h1 className="relative mt-4 font-display text-xl font-semibold tracking-tight">{t("auth.linkInvalidTitle")}</h1>
        <p className="relative mt-2 text-sm leading-relaxed text-muted">{t("auth.linkInvalidBody")}</p>
        <div className="relative mt-6"><ResendLink /></div>
        <p className="relative mt-5 text-sm text-muted">
          <Link href="/login" className="font-medium text-accent">{t("auth.backToLogin")}</Link>
        </p>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <Card className="relative mx-auto w-full max-w-md overflow-hidden p-6 text-center sm:p-8">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(18rem 7rem at 50% -30%, rgb(var(--accent) / 0.14), transparent 70%)" }} />
      <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--success)/0.14)] text-success">
        <CheckCircle2 size={26} aria-hidden />
      </span>
      <h1 className="relative mt-4 font-display text-xl font-semibold tracking-tight">{t("auth.verifiedTitle")}</h1>
      <p className="relative mt-2 text-sm leading-relaxed text-muted">{t("auth.verifiedBody")}</p>
      <Link href={user ? "/home" : "/login"}
        className="cta relative mt-6 flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold">
        {user ? t("auth.verifiedApp") : t("auth.verifiedLogin")}
      </Link>
    </Card>
  );
}
