"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

/** Login is a NATIVE form POST to /auth/sign-in (303 + Set-Cookie) — the only
 *  flow installed standalone PWAs handle as reliably as a browser tab. No
 *  fetch, no server-action roundtrip, no client router on the auth path. */
export default function LoginPage() {
  const { t } = useI18n();
  const params = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const failed = params.get("error") === "invalid";
  const next = params.get("next") ?? "";
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="font-display text-xl font-semibold">{t("auth.loginTitle")}</h1>
      <form method="post" action="/auth/sign-in" className="mt-6 space-y-4" onSubmit={() => setSubmitting(true)}>
        <input type="hidden" name="next" value={next} />
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {failed && !submitting && <p className="text-sm text-red-600">{t("auth.invalidCredentials")}</p>}
        <button type="submit" disabled={submitting}
          className="cta flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60">
          {submitting && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {submitting ? t("common.loading") : t("auth.signIn")}
        </button>
      </form>
      <div className="mt-5 flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-muted hover:text-ink">{t("auth.forgotPassword")}</Link>
        <Link href="/register" className="font-medium text-accent">{t("auth.signUp")}</Link>
      </div>
    </Card>
  );
}
