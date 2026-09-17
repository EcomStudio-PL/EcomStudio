import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Builder } from "@/components/admin/cms/builder";
import { ensureLaunchSectionAction } from "@/app/actions/public-pages";
import { getPage, listBlocks, listSectionTemplates } from "@/lib/services/cms";

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

  const [blocks, templates] = await Promise.all([
    listBlocks(supabase, page.id),
    listSectionTemplates(supabase),
  ]);

  return (
    <Builder page={page} blocks={blocks} templates={templates}
      previewPath={`/podglad/${page.slug}`} />
  );
}
