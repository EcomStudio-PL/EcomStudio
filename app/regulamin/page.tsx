import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";

/** Placeholder until the owner-approved legal text lands: it says HONESTLY
 *  that the document is being finalized — no invented legal language. */
export default async function TermsPage() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-10">
      <Brand />
      <h1 className="mt-10 font-display text-2xl font-semibold tracking-tight">{t("legal.termsTitle")}</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted">{t("legal.pendingBody")}</p>
      <p className="mt-3 text-sm text-muted">
        {t("legal.contactPre")} <Link href="/login?next=/support" className="font-medium text-accent">{t("nav.help")}</Link>.
      </p>
      <Link href="/register" className="mt-8 text-sm font-medium text-accent">← {t("legal.back")}</Link>
    </main>
  );
}
