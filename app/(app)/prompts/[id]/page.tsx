import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { signImageUrls } from "@/lib/services/images";
import { referenceRoleLabel } from "@/lib/ai/engine/master-prompt";
import type { SupportingReference } from "@/lib/ai/engine/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { SessionCards, SessionStatusBadge, type PromptCardData } from "@/components/prompts/session-cards";

export const dynamic = "force-dynamic";

/** One prompt session: the 5 generated concepts as cards, each with its
 *  chosen references + why, prompt, negative and the Studio handoff. */
export default async function PromptSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;

  const { data: session } = await supabase
    .from("prompt_sessions").select("*")
    .eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!session) notFound();

  const { data: prompts } = await supabase
    .from("generated_prompts").select("*")
    .eq("session_id", session.id)
    .order("priority", { ascending: true });

  const urls = await signImageUrls(supabase, session.reference_paths ?? []);
  const pathByNumber = new Map((session.reference_paths ?? []).map((p, i) => [i + 1, p]));

  const cards: PromptCardData[] = (prompts ?? []).map((p) => {
    const supporting = (p.supporting_references ?? []) as unknown as SupportingReference[];
    const refs = [
      ...(p.primary_reference ? [{ image: p.primary_reference, label: referenceRoleLabel("MAIN_GEOMETRY") }] : []),
      ...supporting.map((s) => ({ image: s.image, label: referenceRoleLabel(s.role) })),
    ];
    return {
      id: p.id,
      conceptName: p.concept_name,
      sceneType: p.scene_type,
      promptText: p.prompt_text,
      negativePrompt: p.negative_prompt,
      lockStrength: p.lock_strength,
      references: refs.map((r) => ({
        ...r,
        url: pathByNumber.get(r.image) ? urls.get(pathByNumber.get(r.image)!) ?? null : null,
      })),
    };
  });

  return (
    <div>
      <Link href="/prompts" prefetch className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> {t("prompts.title")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader title={session.product_name} sub={t("psess.detailSub")} />
        <div className="-mt-4 mb-4"><SessionStatusBadge status={session.status} /></div>
      </div>

      {session.status === "failed" && (
        <Card className="mb-4 p-5">
          <p className="text-sm text-red-500">{t(`studio.err.${session.error}`, {}) || t("common.error")}</p>
        </Card>
      )}

      {cards.length > 0
        ? <SessionCards prompts={cards} />
        : session.status !== "failed" && (
          <Card className="p-8 text-center"><p className="text-sm text-muted">{t("psess.processing")}</p></Card>
        )}
    </div>
  );
}
