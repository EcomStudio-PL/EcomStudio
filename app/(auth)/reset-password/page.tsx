import Link from "next/link";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Card } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const dynamic = "force-dynamic";

/**
 * SET A NEW PASSWORD. The emailed link lands on /auth/callback, which
 * exchanges the recovery code for a session and forwards here — so a valid
 * visit always carries a user. No user means the link was expired, already
 * used, or the page was opened directly: that gets an honest explanation
 * and a way back, never a blank page or a raw error.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  if (!user) {
    return (
      <Card className="mx-auto w-full max-w-md p-6 text-center sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--warning)/0.14)] text-warning">
          <KeyRound size={24} aria-hidden />
        </span>
        <h1 className="mt-4 font-display text-xl font-semibold">{t("auth.linkExpiredTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("auth.linkExpiredBody")}</p>
        <Link href="/forgot-password"
          className="cta mt-6 inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold">
          {t("auth.sendReset")}
        </Link>
      </Card>
    );
  }

  return <ResetPasswordForm />;
}
