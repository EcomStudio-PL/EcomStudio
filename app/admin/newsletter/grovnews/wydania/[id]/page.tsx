import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/grovnews";
import {
  adminDailyCandidates, adminEditionCandidates, adminGetEdition, adminGetSettings,
} from "@/lib/services/grovnews-research";
import { composeDailyMail, renderDailyMailHtml } from "@/lib/server/grovnews/daily";
import { EditionEditor, type DailyReviewData } from "@/components/admin/grovnews/edition-editor";

export const dynamic = "force-dynamic";
/** Preparing the mail calls a model; sending hands it to the newsletter
 *  queue — server actions run in this segment, so it needs the room. */
export const maxDuration = 300;

/** One edition: its posts, its status, and its mail. The signed-in admin's
 *  own address is only the default for a test send. An edition that carries
 *  the day's ONE article (0125) also gets the article, its topics and the
 *  mail as it would go out — for review side by side. */
export default async function GrovNewsEdition({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [edition, candidates, { data: { user } }] = await Promise.all([
    adminGetEdition(supabase, id), adminEditionCandidates(supabase), supabase.auth.getUser(),
  ]);
  if (!edition) notFound();

  let daily: DailyReviewData | null = null;
  if (edition.articlePostId && edition.daily) {
    const [{ data: post }, settings] = await Promise.all([
      supabase.from("grovnews_posts").select("id, slug, title, status, content, published_at").eq("id", edition.articlePostId).maybeSingle(),
      adminGetSettings(supabase),
    ]);
    if (post) {
      daily = {
        record: edition.daily,
        article: { id: post.id, slug: post.slug, title: post.title, status: post.status, content: post.content, publishedAt: post.published_at },
        mailHtml: renderDailyMailHtml({ date: edition.date, articleSlug: post.slug, mail: composeDailyMail(edition.date, edition.daily) }),
        candidates: await adminDailyCandidates(supabase, settings.lookbackHours),
        maxTopics: settings.maxTopics,
      };
    }
  }

  return (
    <div className="min-w-0" data-grovnews-edition-editor>
      <EditionEditor edition={edition} candidates={candidates} adminEmail={user?.email ?? ""} daily={daily} />
    </div>
  );
}
