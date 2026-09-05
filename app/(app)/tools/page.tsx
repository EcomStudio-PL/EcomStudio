import { redirect } from "next/navigation";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight, Contrast, Crop, Frame, Gauge, Maximize2, Palette, Scaling, Scissors,
  SlidersHorizontal, Square, Stamp, Sun, WandSparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { toolCatalogue, type ToolAvailability } from "@/lib/server/image-tools";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import type { ToolSlug } from "@/lib/images/tools";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** A tool that keeps a screen and a batch queue of its own. */
type ToolCard = {
  key: string;
  href: string;
  icon: LucideIcon;
  tone: string;
  title: string;
  body: string;
  /** Catalogue row that decides whether it opens and what it costs. Retusz is
   *  not one of the sharp tools, so it has no row here. */
  slug: ToolSlug | null;
};

/** An entry point into the one editor — a section of it, not a second copy. */
type EditorCard = {
  key: string;
  href: string;
  icon: LucideIcon;
  tone: string;
  title: string;
  /** The paid step behind the section, when there is one. Everything the
   *  editor bakes itself is local, and local is free. */
  paid: ToolSlug | null;
};

/**
 * TOOLS — the hub.
 *
 * Two groups, because a seller is choosing between two different things: a
 * batch screen that runs one operation over a whole shoot, and the editor,
 * where background, shadow, format, colour and crop are five sections of one
 * pass over a single photo. The editor rows link INTO it with `?tool=` — they
 * are shortcuts, never a second implementation.
 *
 * Every card states what it costs before it is opened, and the price is the
 * real one: local work says free because it genuinely never touches a paid
 * API, and the paid rows show the credits the currently connected provider
 * implies. A tool with no backend says why instead of opening onto a button
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
  const row = (slug: ToolSlug): ToolAvailability | null =>
    catalogue.find((c) => c.slug === slug) ?? null;
  const editor = row("editor");

  const tools: ToolCard[] = [
    {
      key: "retouch", href: "/retusz", icon: WandSparkles, tone: "bg-accent-soft text-accent",
      title: t("tools.retouch.name"), body: t("tools.retouch.body"), slug: null,
    },
    {
      // The resize screen runs the "format" tool — same catalogue row, same
      // price, so it reads its state from there rather than assuming free.
      key: "resize", href: "/tools/resize", icon: Scaling, tone: "bg-accent2-soft text-accent2",
      title: t("resize.title"), body: t("resize.sub"), slug: "format",
    },
    {
      key: "compress", href: "/tools/compress", icon: Gauge, tone: "bg-sunken text-muted",
      title: t("compress.title"), body: t("compress.sub"), slug: "compress",
    },
    {
      key: "upscale", href: "/tools/upscale", icon: Maximize2, tone: "bg-accent-soft text-accent",
      title: t("tools.upscale.name"), body: t("tools.upscale.body"), slug: "upscale",
    },
    {
      key: "expand", href: "/tools/expand", icon: Crop, tone: "bg-accent-soft text-accent",
      title: t("tools.expand.name"), body: t("tools.expand.body"), slug: "expand",
    },
    {
      key: "watermark", href: "/tools/watermark", icon: Stamp, tone: "bg-accent2-soft text-accent2",
      title: t("tools.watermark.name"), body: t("tools.watermark.body"), slug: "watermark",
    },
  ];

  const sections: EditorCard[] = [
    {
      key: "open", href: "/tools/editor", icon: SlidersHorizontal, tone: "bg-accent-soft text-accent",
      title: t("hub.openEditor"), paid: null,
    },
    {
      key: "remove_bg", href: "/tools/editor?tool=remove-background", icon: Scissors,
      tone: "bg-accent2-soft text-accent2", title: t("tools.remove_bg.name"), paid: "remove_bg",
    },
    {
      key: "white_bg", href: "/tools/editor?tool=white-background", icon: Square,
      tone: "bg-sunken text-muted", title: t("tools.white_bg.name"), paid: null,
    },
    {
      key: "color", href: "/tools/editor?tool=background", icon: Palette,
      tone: "bg-accent-soft text-accent", title: t("editor.bg.color"), paid: null,
    },
    {
      key: "shadow", href: "/tools/editor?tool=shadow", icon: Sun,
      tone: "bg-sunken text-muted", title: t("tools.shadow.name"), paid: null,
    },
    {
      key: "adjust", href: "/tools/editor?tool=adjust", icon: Contrast,
      tone: "bg-accent-soft text-accent", title: t("editor.s.adjust"), paid: null,
    },
    {
      key: "transform", href: "/tools/editor?tool=transform", icon: Frame,
      tone: "bg-accent2-soft text-accent2", title: t("editor.s.transform"), paid: null,
    },
  ];

  // A section is only as open as the editor itself: when the editor's own row
  // is switched off, no shortcut into it can be taken, whatever the paid step
  // behind that shortcut says.
  const sectionState = (paid: ToolSlug | null): ToolAvailability | null =>
    editor && !editor.available ? editor : paid ? row(paid) : editor;

  return (
    <div>
      <PageHeader overline={t("mega.edit")} title={t("hub.title")} sub={t("hub.sub")} />

      <section>
        <div className="mb-3">
          <h2 className="font-display text-[15px] font-semibold tracking-tight">{t("nav.tools")}</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{t("tools.sub")}</p>
        </div>
        <div className="stagger grid gap-3 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((card) => (
            <ToolTile key={card.key} card={card} state={card.slug ? row(card.slug) : null} t={t} />
          ))}
        </div>
      </section>

      <section className="mt-7">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold tracking-tight">{t("nav.editor")}</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{t("editor.sub")}</p>
          </div>
          {/* One badge for the whole editor — the rows below only speak up
              when their own step costs credits or cannot run. */}
          <StateBadge state={editor} t={t} />
        </div>
        <div className="stagger grid gap-2 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((card) => (
            <EditorTile key={card.key} card={card} state={sectionState(card.paid)} t={t} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** The price when the tool can be opened, the reason when it cannot. */
function StateBadge({ state, t }: { state: ToolAvailability | null; t: T }) {
  if (!state) return null;
  if (!state.available) return <Badge tone="amber">{t(`tools.state.${state.reason}`)}</Badge>;
  return state.credits === 0
    ? <Badge tone="green">{t("tools.free")}</Badge>
    : <Badge tone="neutral">{t("tools.creditsTotal", { n: state.credits })}</Badge>;
}

function ToolTile({ card, state, t }: { card: ToolCard; state: ToolAvailability | null; t: T }) {
  const Icon = card.icon;
  const open = state?.available ?? true;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", card.tone)}>
          <Icon size={19} />
        </span>
        <StateBadge state={state} t={t} />
      </div>
      <div className="mt-3 min-w-0">
        <h3 className="flex items-center gap-1 text-sm font-semibold tracking-tight">
          <span className="truncate">{card.title}</span>
          {open && <ArrowUpRight size={14} className="shrink-0 text-faint" aria-hidden />}
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{card.body}</p>
      </div>
    </>
  );

  return open ? (
    <Link href={card.href} className="panel panel-interactive flex flex-col rounded-2xl p-4">{body}</Link>
  ) : (
    <div className="panel flex flex-col rounded-2xl p-4 opacity-65">{body}</div>
  );
}

/** A shortcut row: icon, name, and a badge only when there is something the
 *  section header has not already said. */
function EditorTile({ card, state, t }: { card: EditorCard; state: ToolAvailability | null; t: T }) {
  const Icon = card.icon;
  const open = state?.available ?? true;
  const body = (
    <>
      <span aria-hidden className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", card.tone)}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight">{card.title}</span>
      {!open && state
        ? <Badge tone="amber">{t(`tools.state.${state.reason}`)}</Badge>
        : state && state.credits > 0
          ? <Badge tone="neutral">{t("tools.creditsTotal", { n: state.credits })}</Badge>
          : open && <ArrowUpRight size={14} className="shrink-0 text-faint" aria-hidden />}
    </>
  );

  return open ? (
    <Link href={card.href} className="panel panel-interactive flex items-center gap-2.5 rounded-xl p-3">{body}</Link>
  ) : (
    <div className="panel flex items-center gap-2.5 rounded-xl p-3 opacity-65">{body}</div>
  );
}
