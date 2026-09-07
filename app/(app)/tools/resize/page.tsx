import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { toolCatalogue } from "@/lib/server/image-tools";
import { ResizeWorkbench } from "@/components/tools/resize-workbench";

export const dynamic = "force-dynamic";

/**
 * RESIZE — its own screen, one step above `/tools/format`.
 *
 * Scaling a whole shoot is the operation sellers repeat most, so it gets a
 * batch surface of its own instead of a preset buried in the format tool's
 * settings rail. The tool underneath IS "format": the same catalogue row, the
 * same price, the same sharp call — which is why availability and cost are
 * read from `toolCatalogue` here rather than assumed to be free. A local tool
 * costs nothing today, but the number on the button comes from the catalogue,
 * so the day an operator prices it the screen tells the truth by itself.
 */
export default async function ResizePage() {
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
  // A lookup that "cannot fail" is exactly how the editor page crashed. If the
  // catalogue ever comes back without this row, the screen says the tool is
  // unavailable — it does not throw the customer into the error boundary.
  const entry = catalogue.find((c) => c.slug === "format")
    ?? { slug: "format" as const, kind: "local" as const, available: false, credits: 0, providerLabel: null, reason: "maintenance" as const };

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
        <h1 className="font-display text-[19px] font-semibold tracking-tight">{t("resize.title")}</h1>
        <span className="text-[12px] font-semibold text-muted">
          {entry.credits === 0 ? t("tools.free") : t("tools.creditsTotal", { n: entry.credits })}
        </span>
        <p className="min-w-0 basis-full text-[13px] leading-relaxed text-muted sm:basis-auto">{t("resize.sub")}</p>
      </div>
      <ResizeWorkbench
        available={entry.available}
        credits={entry.credits}
        reason={entry.reason}
        balance={wallet?.balance ?? 0}
      />
    </div>
  );
}
