import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { toolCatalogue } from "@/lib/server/image-tools";
import { PageHeader } from "@/components/ui/page-header";
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
  const entry = catalogue.find((c) => c.slug === "format")!;

  return (
    <div>
      <Link href="/tools"
        className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> {t("tools.title")}
      </Link>
      <PageHeader
        overline={entry.credits === 0 ? t("tools.free") : t("tools.creditsTotal", { n: entry.credits })}
        title={t("resize.title")}
        sub={t("resize.sub")}
      />
      <ResizeWorkbench
        available={entry.available}
        credits={entry.credits}
        reason={entry.reason}
        balance={wallet?.balance ?? 0}
      />
    </div>
  );
}
