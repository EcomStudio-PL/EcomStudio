import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Builder } from "@/components/admin/cms/builder";
import { ensureLaunchSectionAction } from "@/app/actions/public-pages";
import { getPage, listBlocks, listPages, listSectionTemplates } from "@/lib/services/cms";
import { prelaunchCampaignPanelAction } from "@/app/actions/prelaunch-admin";
import { PrelaunchCampaign } from "@/components/admin/prelaunch-campaign";

/**
 * THE BUILDER, for one page.
 *
 * Everything the editor needs is fetched here in two queries and handed over
 * as data — the client component never talks to the database directly, which
 * is what keeps RLS the only thing deciding who may edit what.
 */
export default async function AdminWwwPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const page = await getPage(supabase, slug);
  if (!page) notFound();

  // The launch page is one section; the first time it is opened that section
  // is created from the copy that already existed, so consolidating the old
  // editors never shows an admin an empty form where their text used to be.
  if (page.kind === "launch") await ensureLaunchSectionAction(page.id);

  const [blocks, templates, pages, campaign] = await Promise.all([
    listBlocks(supabase, page.id),
    listSectionTemplates(supabase),
    // Only what the CTA picker needs: a name, an address and whether it is
    // live yet. The builder never receives other pages' content.
    listPages(supabase),
    // The launch page's FIGURES (date, credits, approvals) are not copy: they
    // live in the private campaign row and are edited in their own panel,
    // above the builder that edits the words. Any other page has none.
    page.kind === "launch" ? prelaunchCampaignPanelAction() : Promise.resolve(null),
  ]);

  return (
    <>
      {campaign && <PrelaunchCampaign panel={campaign} />}
      <Builder page={page} blocks={blocks} templates={templates}
        pages={pages.map((p) => ({ slug: p.slug, title: p.title, status: p.status, kind: p.kind }))}
        previewPath={`/podglad/${page.slug}`} />
    </>
  );
}
