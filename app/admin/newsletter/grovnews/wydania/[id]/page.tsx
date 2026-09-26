import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/grovnews";
import { adminEditionCandidates, adminGetEdition } from "@/lib/services/grovnews-research";
import { EditionEditor } from "@/components/admin/grovnews/edition-editor";

export const dynamic = "force-dynamic";
/** Preparing the mail calls a model; sending hands it to the newsletter
 *  queue — server actions run in this segment, so it needs the room. */
export const maxDuration = 300;

/** One edition: its posts, its status, and its mail. The signed-in admin's
 *  own address is only the default for a test send. */
export default async function GrovNewsEdition({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [edition, candidates, { data: { user } }] = await Promise.all([
    adminGetEdition(supabase, id), adminEditionCandidates(supabase), supabase.auth.getUser(),
  ]);
  if (!edition) notFound();
  return (
    <div className="min-w-0" data-grovnews-edition-editor>
      <EditionEditor edition={edition} candidates={candidates} adminEmail={user?.email ?? ""} />
    </div>
  );
}
