import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

/** Support / messages scaffold. Honest "coming soon" module reserving the
 *  route, navigation slot and layout for the future customer ↔ admin message
 *  center — no fake inbox, no fake tickets. */
export default async function SupportPage() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("support.title")} sub={t("support.sub")} />
      <Card className="p-8 text-center">
        <p aria-hidden className="text-3xl">✉</p>
        <h2 className="mt-3 font-display text-lg font-semibold">{t("support.comingTitle")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t("support.comingBody")}</p>
        <ul className="mx-auto mt-6 max-w-xs space-y-2 text-left text-sm text-muted">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex items-start gap-2.5">
              <span aria-hidden className="mt-0.5 text-accent2">◆</span>
              {t(`support.f${n}`)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
