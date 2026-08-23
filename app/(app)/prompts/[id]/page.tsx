import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { signImageUrls } from "@/lib/services/images";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ConceptBoard, SessionStatusBadge, type ConceptCardData } from "@/components/prompts/concept-board";

export const dynamic = "force-dynamic";

/**
 * One shot session: the prepared concepts as customer cards. The projection
 * built here is the ONLY data the browser receives about a concept — title,
 * description, scene type, reference thumbnails, price, status and the latest
 * generated photo. The prompt exists solely as ciphertext and is never
 * selected, let alone rendered.
 */
export default async function ConceptSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;

  const { data: session } = await supabase
    .from("prompt_sessions")
    .select("id, workspace_id, product_id, product_name, status, error, aspect_ratio, reference_paths, created_at, mode")
    .eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!session) notFound();

  const { data: prompts } = await supabase
    .from("generated_prompts")
    .select("id, concept_name, customer_title, customer_description, scene_type, primary_reference, reference_indices, generation_count, last_job_id, prompt_origin, model_id, prompt_text")
    .eq("session_id", session.id)
    .order("priority", { ascending: true });

  // Latest result per concept: the last job's generation assets + which
  // model actually served it (shown as "Wygenerowano: …" on the card).
  const jobIds = (prompts ?? []).map((p) => p.last_job_id).filter((v): v is string => !!v);
  const resultByJob = new Map<string, { path: string; status: string; modelId: string | null }>();
  if (jobIds.length > 0) {
    const { data: jobs } = await supabase
      .from("generation_jobs")
      .select("id, status, model_id, generations(generation_assets(storage_path))")
      .in("id", jobIds);
    for (const job of jobs ?? []) {
      const path = job.generations?.[0]?.generation_assets?.[0]?.storage_path;
      resultByJob.set(job.id, { path: path ?? "", status: job.status, modelId: job.model_id });
    }
  }
  const servedModelIds = [...resultByJob.values()].map((r) => r.modelId).filter((v): v is string => !!v);
  const servedNames = new Map<string, string>();
  if (servedModelIds.length > 0) {
    const { data: served } = await supabase
      .from("ai_models").select("id, name, display_name").in("id", servedModelIds);
    for (const m of served ?? []) servedNames.set(m.id, m.display_name || m.name);
  }

  const [refUrls, models, wallet] = await Promise.all([
    signImageUrls(supabase, session.reference_paths ?? []),
    conceptModelOptions(supabase),
    getWallet(supabase, workspace.id),
  ]);

  // Result thumbnails live in the generation-assets bucket.
  const resultPaths = [...resultByJob.values()].map((r) => r.path).filter(Boolean);
  const resultUrls = new Map<string, string>();
  if (resultPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrls(resultPaths, 3600);
    signed?.forEach((s) => { if (s.signedUrl && s.path) resultUrls.set(s.path, s.signedUrl); });
  }

  const paths = session.reference_paths ?? [];
  const cards: ConceptCardData[] = (prompts ?? []).map((p, i) => {
    const result = p.last_job_id ? resultByJob.get(p.last_job_id) : undefined;
    const origin = p.prompt_origin === "custom" ? "custom" as const : "ecomstudio" as const;
    return {
      id: p.id,
      index: i + 1,
      title: p.customer_title || p.concept_name,
      description: p.customer_description,
      sceneType: p.scene_type,
      references: (p.reference_indices ?? [])
        .map((n) => ({ image: n, url: paths[n - 1] ? refUrls.get(paths[n - 1]) ?? null : null, primary: n === p.primary_reference }))
        .filter((r) => r.url),
      generationCount: p.generation_count ?? 0,
      resultUrl: result?.path ? resultUrls.get(result.path) ?? null : null,
      resultPending: result ? result.status === "processing" || result.status === "queued" : false,
      origin,
      modelId: p.model_id,
      // The customer's own prompt is theirs to read and edit; an EcomStudio
      // prompt never rides along (it exists only as ciphertext).
      customPrompt: origin === "custom" ? p.prompt_text : null,
      generatedWith: result?.modelId ? servedNames.get(result.modelId) ?? null : null,
    };
  });

  return (
    <div>
      <Link href="/prompts" prefetch className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> {t("prompts.title")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader title={session.product_name} sub={t("concepts.detailSub")} />
        <div className="-mt-4 mb-4"><SessionStatusBadge status={session.status} /></div>
      </div>

      {session.status === "failed" && (
        <Card className="mb-4 p-5">
          <p className="text-sm text-red-500">{t(`studio.err.${session.error}`, {}) || t("common.error")}</p>
        </Card>
      )}

      {cards.length > 0
        ? (
          <ConceptBoard
            concepts={cards}
            models={models}
            balance={wallet?.balance ?? 0}
            engineReady={models.length > 0}
          />
        )
        : session.status !== "failed" && (
          <Card className="p-8 text-center"><p className="text-sm text-muted">{t("psess.processing")}</p></Card>
        )}
    </div>
  );
}
