import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { toolCatalogue } from "@/lib/server/image-tools";
import { CompressWorkbench } from "@/components/tools/compress-workbench";

export const dynamic = "force-dynamic";

/**
 * COMPRESS — its own screen, one step above `/tools/compress` as the generic
 * workbench renders it.
 *
 * Same tool underneath: the "compress" catalogue row, the same price, the same
 * sharp call. What the dedicated surface adds is the reporting — weight
 * before, weight after, and what the whole batch saved — which the generic
 * workbench has no room for. This static segment sits in front of `[slug]`, so
 * `/tools/compress` lands here and every other slug still falls through to the
 * shared page.
 *
 * Availability and cost are read from `toolCatalogue` rather than assumed:
 * a local tool costs nothing today, but the number on the button comes from
 * the catalogue, so the day an operator prices it the screen tells the truth
 * by itself.
 */
export default async function CompressPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const [catalogue, wallet] = await Promise.all([
    toolCatalogue(supabase),
    getWallet(supabase, workspace.id),
  ]);
  // Same guard as the resize screen: a missing catalogue row degrades to an
  // honest "unavailable", never to a crash.
  const entry = catalogue.find((c) => c.slug === "compress")
    ?? { slug: "compress" as const, kind: "local" as const, available: false, credits: 0, providerLabel: null, reason: "maintenance" as const };

  return (
    <div>
      {/* One compact line instead of an overline, a display headline and a
          subtitle: the panel and the gallery are what the seller came for, and
          the price still leads — it is the first thing on the row. */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href="/tools"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> {t("tools.title")}
        </Link>
        <span aria-hidden className="h-3.5 w-px bg-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]" />
        <h1 className="font-display text-[19px] font-semibold tracking-tight">{t("compress.title")}</h1>
        <span className="text-[12px] font-semibold text-muted">
          {entry.credits === 0 ? t("tools.free") : t("tools.creditsTotal", { n: entry.credits })}
        </span>
        <p className="min-w-0 basis-full text-[13px] leading-relaxed text-muted sm:basis-auto">{t("compress.sub")}</p>
      </div>
      <CompressWorkbench
        available={entry.available}
        credits={entry.credits}
        reason={entry.reason}
        balance={wallet?.balance ?? 0}
      />
    </div>
  );
}
