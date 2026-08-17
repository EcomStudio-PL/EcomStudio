import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { decryptConceptPayload } from "@/lib/server/prompt-engine";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * ADMIN — one concept session, prompts INCLUDED.
 *
 * This page is the single place the hidden prompts become readable again:
 * the admin layout has already verified the role, the page runs on the
 * server, and the ciphertext is decrypted here with the server-only key.
 * Nothing on this route is reachable by a customer.
 */
export default async function AdminConceptSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);

  const { data: session } = await supabase
    .from("prompt_sessions")
    .select("id, product_name, status, aspect_ratio, reference_paths, analysis_model, analysis_provider, created_at")
    .eq("id", id).maybeSingle();
  if (!session) notFound();

  const { data: prompts } = await supabase
    .from("generated_prompts")
    .select("id, concept_name, customer_title, customer_description, scene_type, lock_strength, reference_indices, primary_reference, generation_count, prompt_encrypted, prompt_iv, prompt_tag, prompt_text")
    .eq("session_id", session.id)
    .order("priority", { ascending: true });

  const urls = await signImageUrls(supabase, session.reference_paths ?? []);
  const paths = session.reference_paths ?? [];

  return (
    <div>
      <Link href="/admin/concepts" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> {t("admin.concepts.title")}
      </Link>
      <PageHeader
        title={session.product_name}
        sub={`${t("admin.concepts.session")} · ${session.aspect_ratio} · ${session.analysis_provider ?? "—"} / ${session.analysis_model ?? "—"}`}
      />

      <div className="space-y-4">
        {(prompts ?? []).map((p, i) => {
          const payload = decryptConceptPayload(p);
          // Legacy rows may still carry plaintext from before the lockdown.
          const promptText = payload?.prompt ?? (p.prompt_text || null);
          const negativeText = payload?.negative || null;
          return (
            <Panel key={p.id} className="rounded-2xl p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg brand-gradient text-[11px] font-bold text-white">{i + 1}</span>
                <h3 className="text-sm font-semibold">{p.customer_title || p.concept_name}</h3>
                {p.scene_type && <Badge tone="indigo">{p.scene_type}</Badge>}
                <Badge>{p.lock_strength}</Badge>
                {payload?.meta.tv != null && <Badge tone="green">tpl v{payload.meta.tv}</Badge>}
                {payload?.meta.cat && <Badge>{payload.meta.cat}</Badge>}
                {payload?.meta.goal && <Badge>{payload.meta.goal}</Badge>}
                <span className="ml-auto text-xs tabular-nums text-faint">
                  {t("admin.concepts.generated")}: {p.generation_count ?? 0}
                </span>
              </div>
              {p.customer_description && (
                <p className="mb-3 text-[12.5px] text-muted">{p.customer_description}</p>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{t("admin.concepts.refsUsed")}</span>
                {(p.reference_indices ?? []).map((n) => (
                  <span key={n} className={`relative h-10 w-10 overflow-hidden rounded-md ring-1 ring-inset ${n === p.primary_reference ? "ring-[rgb(var(--accent))]" : "ring-black/10"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {paths[n - 1] && urls.get(paths[n - 1]) && (
                      <img src={urls.get(paths[n - 1])!} alt="" className="h-full w-full object-cover" />
                    )}
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[8px] font-bold text-white">{n}</span>
                  </span>
                ))}
              </div>

              {promptText ? (
                <>
                  <p className="overline mb-1.5">{t("admin.concepts.viewPrompt")}</p>
                  <pre className="thin-scroll max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl bg-sunken p-3 text-xs leading-relaxed text-muted">{promptText}</pre>
                  {negativeText && (
                    <>
                      <p className="overline mb-1.5 mt-3">{t("admin.concepts.negative")}</p>
                      <pre className="thin-scroll max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-sunken p-3 text-xs leading-relaxed text-muted">{negativeText}</pre>
                    </>
                  )}
                </>
              ) : (
                <p className="text-xs text-faint">{t("admin.concepts.noPrompt")}</p>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
