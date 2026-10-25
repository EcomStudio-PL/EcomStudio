import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { getAvailabilityMap, viewerIsAdmin } from "@/lib/server/feature-availability";
import { menuVisible } from "@/lib/features";
import { signImageUrls } from "@/lib/services/images";
import { readAiBackgroundPresets, toolCatalogue } from "@/lib/server/image-tools";
import { listPhotoResults } from "@/lib/server/photo-tools";
import { isPhotoTool, toolBySlug, type PhotoToolSlug, type ToolSlug } from "@/lib/images/tools";
import type { ToolAvailability } from "@/lib/server/image-tools";
import { publicPresets } from "@/lib/images/ai-background-presets";
import { PageHeader } from "@/components/ui/page-header";
import { ToolWorkbench } from "@/components/tools/workbench";
import { PhotoToolWorkspace } from "@/components/tools/photo-tool";
import { ToolScope } from "@/components/public-tools/tool-scope";
import { guestReadClient, publicToolAudience } from "@/lib/server/public-tools";
import { publicToolMetadata } from "@/lib/server/public-tool-meta";
import { publicToolForPath } from "@/lib/public-tools";

export const dynamic = "force-dynamic";

/** A public tool's title, description, canonical and robots (Public Tools V1);
 *  any other slug keeps the layout's defaults, as before. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const tool = publicToolForPath(`/tools/${(await params).slug}`);
  return tool ? publicToolMetadata(tool) : {};
}

/**
 * WHERE THE CONSOLIDATED TOOLS WENT.
 *
 * Two of the one-dial pages are sections of the editor or of the resize
 * screen. Their URLs are in bookmarks, in mails and in the browser history of
 * every seller who used them, so they are not deleted — they are forwarded,
 * server-side, onto the same operation one level up.
 *
 * "Usuń tło" (remove_bg) and "Zmień kolor tła" (white_bg) were forwarded to
 * the editor too; they are screens of their own again — two of the four photo
 * tools rendered below — and their old URLs now simply open them.
 */
const MOVED: Record<string, string> = {
  shadow: "/tools/editor?tool=shadow",
  format: "/tools/resize",
};

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Forward before any query runs: a redirect needs no session and no wallet.
  const moved = MOVED[slug];
  if (moved) redirect(moved);

  const tool = toolBySlug(slug);
  if (!tool) notFound();

  // Public Tools V1: a public tool, asked for by a visitor (or an admin's
  // guest preview), renders the same panel priced by the same code — and none
  // of an account. Any other slug needs a session, as before.
  const pub = publicToolForPath(`/tools/${tool.slug}`);
  const audience = pub ? await publicToolAudience(pub.path) : null;
  if (pub && audience?.kind === "guest") {
    return (
      <ToolScope tool={pub} audience={audience}>
        {isPhotoTool(tool.slug) ? <GuestPhotoTool slug={tool.slug} /> : <GuestWorkbench slug={tool.slug} />}
      </ToolScope>
    );
  }
  const scoped = (node: React.ReactNode) => (pub && audience ? <ToolScope tool={pub} audience={audience}>{node}</ToolScope> : node);

  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");

  if (isPhotoTool(tool.slug)) return scoped(<PhotoToolPage slug={tool.slug} workspaceId={workspace.id} />);

  // "Powiąż z produktem" only exists while the Produkty module does. With it
  // DISABLED the list stays empty, which removes the affordance AND the query
  // — the workbench already hides the picker when there is nothing to pick,
  // and its "+ Dodaj produkt" link would otherwise lead to a 404.
  const [catalogue, wallet, avail, isAdmin] = await Promise.all([
    toolCatalogue(supabase),
    getWallet(supabase, workspace.id),
    getAvailabilityMap(supabase),
    viewerIsAdmin(supabase),
  ]);
  // The catalogue is built from the same static list `toolBySlug` just matched,
  // so this row exists — but a non-null assertion is what turns "should not
  // happen" into a blank error screen, so the miss degrades instead.
  const entry = catalogue.find((c) => c.slug === tool.slug)
    ?? { slug: tool.slug, kind: tool.kind, available: false, credits: 0, providerLabel: null, reason: "maintenance" as const };

  return scoped(
    <WorkbenchPage slug={tool.slug} t={t} entry={entry} balance={wallet?.balance ?? 0} />,
  );
}

/** The batch tool's screen: its header and the workbench. */
function WorkbenchPage({ slug, t, entry, balance }: {
  slug: ToolSlug;
  t: (k: string, v?: Record<string, string | number>) => string;
  entry: ToolAvailability;
  balance: number;
}) {
  return (
    <div>
      <Link href="/tools"
        className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> {t("nav.allTools")}
      </Link>
      <PageHeader
        // A tool that cannot run has no price to state: 0 credits would read
        // as "Za darmo" above a panel saying it is unavailable.
        overline={!entry.available ? undefined : entry.credits === 0 ? t("tools.free") : t("tools.creditsTotal", { n: entry.credits })}
        title={t(`tools.${slug}.name`)}
        sub={t(`tools.${slug}.body`)}
      />
      <ToolWorkbench
        tool={slug}
        available={entry.available}
        credits={entry.credits}
        providerLabel={entry.providerLabel}
        reason={entry.reason}
        balance={balance}
      />
    </div>
  );
}

/** A visitor's batch tool: availability and price from the catalogue, read
 *  by the server (guestReadClient, 0157); no wallet. */
async function GuestWorkbench({ slug }: { slug: ToolSlug }) {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const reader = guestReadClient();
  const catalogue = reader ? await toolCatalogue(reader) : [];
  const def = toolBySlug(slug)!;
  const entry = catalogue.find((c) => c.slug === slug)
    ?? { slug, kind: def.kind, available: false, credits: 0, providerLabel: null, reason: "maintenance" as const };
  return <WorkbenchPage slug={slug} t={t} entry={entry} balance={0} />;
}

/** A visitor's photo tool: the price, availability and preset NAMES, read by
 *  the server; no wallet, no history. */
async function GuestPhotoTool({ slug }: { slug: PhotoToolSlug }) {
  const { locale } = await getDictionary();
  const reader = guestReadClient();
  const [catalogue, presets] = reader
    ? await Promise.all([
        toolCatalogue(reader, { admin: false }),
        slug === "ai_background" ? readAiBackgroundPresets(reader) : Promise.resolve([]),
      ])
    : [[], []];
  const entry = catalogue.find((c) => c.slug === slug);
  return (
    <div className="workspace workspace-page gen-shell pt-1">
      <PhotoToolWorkspace
        tool={slug}
        workspaceId=""
        available={entry?.available ?? false}
        reason={entry?.reason ?? "maintenance"}
        environment={entry?.environment ?? null}
        credits={entry?.credits ?? 0}
        freeWhenTransparent={entry?.freeWhenTransparent ?? false}
        balance={0}
        presets={publicPresets(presets, locale)}
        initialItems={[]}
        initialCursor={null}
      />
    </div>
  );
}

/**
 * THE FOUR PHOTO TOOLS — Usuń tło, Zmień kolor tła, Dodaj tło AI, Dodaj cień.
 *
 * Each a screen of its own on the same shell as Retusz and Moda. The page
 * hands the panel only true facts: whether the tool can run for THIS viewer
 * (a sandbox key runs for an operator only), what one photo costs, the wallet,
 * the preset NAMES (never their prompts) and this workspace's own results.
 */
async function PhotoToolPage({ slug, workspaceId }: { slug: PhotoToolSlug; workspaceId: string }) {
  const supabase = await createClient();
  const { locale } = await getDictionary();
  const admin = await viewerIsAdmin(supabase);
  const [catalogue, wallet, presets, history] = await Promise.all([
    toolCatalogue(supabase, { admin }),
    getWallet(supabase, workspaceId),
    slug === "ai_background" ? readAiBackgroundPresets(supabase) : Promise.resolve([]),
    listPhotoResults(supabase, workspaceId, slug),
  ]);
  const entry = catalogue.find((c) => c.slug === slug);

  return (
    // Same shell contract as Retusz and the generator: workspace tokens and the
    // viewport-locked frame, so the cost island stays at the column's foot.
    <div className="workspace workspace-page gen-shell pt-1">
      <PhotoToolWorkspace
        tool={slug}
        workspaceId={workspaceId}
        available={entry?.available ?? false}
        reason={entry?.reason ?? "maintenance"}
        environment={entry?.environment ?? null}
        credits={entry?.credits ?? 0}
        freeWhenTransparent={entry?.freeWhenTransparent ?? false}
        balance={wallet?.balance ?? 0}
        presets={publicPresets(presets, locale)}
        initialItems={history.items}
        initialCursor={history.nextCursor}
      />
    </div>
  );
}
