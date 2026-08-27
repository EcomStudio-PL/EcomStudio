import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight, Crop, Gauge, Maximize2, Scissors, Square, Stamp, Sun, Wand2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { toolCatalogue } from "@/lib/server/image-tools";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import type { ToolSlug } from "@/lib/images/tools";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ICONS: Record<ToolSlug, typeof Wand2> = {
  upscale: Maximize2,
  remove_bg: Scissors,
  white_bg: Square,
  expand: Crop,
  shadow: Sun,
  format: Wand2,
  compress: Gauge,
  watermark: Stamp,
};

const TONES: Record<ToolSlug, string> = {
  upscale: "bg-accent-soft text-accent",
  remove_bg: "bg-accent2-soft text-accent2",
  white_bg: "bg-sunken text-muted",
  expand: "bg-accent-soft text-accent",
  shadow: "bg-sunken text-muted",
  format: "bg-accent2-soft text-accent2",
  compress: "bg-sunken text-muted",
  watermark: "bg-accent-soft text-accent",
};

/**
 * TOOLS — the hub.
 *
 * Every card states what it costs before it is opened, and the price is the
 * real one: the free tools say free because they genuinely never touch a paid
 * API, and the paid ones show the credits the currently connected provider
 * implies. A tool with no backend says so instead of opening onto a button
 * that cannot work.
 */
export default async function ToolsPage() {
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  const catalogue = await toolCatalogue(supabase);
  const free = catalogue.filter((c) => c.kind === "local");
  const paid = catalogue.filter((c) => c.kind === "paid");

  return (
    <div>
      <PageHeader overline={t("nav.groups.create")} title={t("tools.title")} sub={t("tools.sub")} />

      <Section title={t("tools.freeGroup")} note={t("tools.freeNote")} items={free} t={t} />
      <Section title={t("tools.paidGroup")} note={t("tools.paidNote")} items={paid} t={t} className="mt-7" />
    </div>
  );
}

type Item = Awaited<ReturnType<typeof toolCatalogue>>[number];

function Section({ title, note, items, t, className }: {
  title: string;
  note: string;
  items: Item[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{note}</p>
      </div>
      <div className="stagger grid gap-3 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = ICONS[item.slug];
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONES[item.slug])}>
                  <Icon size={19} />
                </span>
                {item.available ? (
                  item.credits === 0
                    ? <Badge tone="green">{t("tools.free")}</Badge>
                    : <Badge tone="neutral">{t("tools.creditsTotal", { n: item.credits })}</Badge>
                ) : (
                  <Badge tone="amber">{t(`tools.state.${item.reason}`)}</Badge>
                )}
              </div>
              <div className="mt-3 min-w-0">
                <h3 className="flex items-center gap-1 text-sm font-semibold tracking-tight">
                  <span className="truncate">{t(`tools.${item.slug}.name`)}</span>
                  {item.available && <ArrowUpRight size={14} className="shrink-0 text-faint" aria-hidden />}
                </h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t(`tools.${item.slug}.body`)}</p>
              </div>
            </>
          );

          return item.available ? (
            <Link key={item.slug} href={`/tools/${item.slug}`}
              className="panel panel-interactive flex flex-col rounded-2xl p-4">
              {body}
            </Link>
          ) : (
            <div key={item.slug} className="panel flex flex-col rounded-2xl p-4 opacity-65">{body}</div>
          );
        })}
      </div>
    </section>
  );
}
