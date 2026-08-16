import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { getUsableModels, toClientModel } from "@/lib/ai/router";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { Studio, type StudioModel, type StudioProduct, type StudioSession } from "@/components/generator/studio";

export const dynamic = "force-dynamic";

export default async function GeneratorPage({ searchParams }: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt: promptParam } = await searchParams;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const [products, models, wallet] = await Promise.all([
    listProducts(supabase, workspace.id, 30),
    getUsableModels(supabase),
    getWallet(supabase, workspace.id),
  ]);

  // Prompt-engine handoff: ?prompt=<generated_prompt id> opens the Studio
  // fully prepared — prompt, negative, references, format, product. The user
  // re-uploads nothing and copies nothing.
  let session: StudioSession | null = null;
  if (promptParam && /^[0-9a-f-]{36}$/.test(promptParam)) {
    const { data: gp } = await supabase
      .from("generated_prompts").select("*")
      .eq("id", promptParam).eq("workspace_id", workspace.id).maybeSingle();
    // Concept rows carry no readable prompt (it is EcomStudio IP, stored
    // encrypted) — they generate in place on the concept page, never here.
    if (gp?.session_id && gp.prompt_text) {
      const { data: ps } = await supabase
        .from("prompt_sessions").select("*").eq("id", gp.session_id).maybeSingle();
      if (ps) {
        const paths = ps.reference_paths ?? [];
        const urls = await signImageUrls(supabase, paths);
        const selectedNumbers = new Set(
          (gp.reference_indices?.length ? gp.reference_indices : paths.map((_, i) => i + 1))
        );
        // Primary reference first — the first selected image acts as the main one.
        const ordered = [...paths.entries()].sort(([a], [b]) => {
          const pa = a + 1 === gp.primary_reference ? -1 : 0;
          const pb = b + 1 === gp.primary_reference ? -1 : 0;
          return pa - pb;
        });
        session = {
          promptId: gp.id,
          sessionId: ps.id,
          productId: ps.product_id,
          productName: ps.product_name,
          prompt: gp.prompt_text,
          negative: gp.negative_prompt ?? "",
          aspectRatio: gp.format || ps.aspect_ratio,
          refs: ordered.map(([i, path]) => ({
            path,
            url: urls.get(path) ?? "",
            selected: selectedNumbers.has(i + 1),
          })),
        };
      }
    }
  }

  const allPaths = products.flatMap((p) => p.product_images.map((i) => i.storage_path));
  const urls = await signImageUrls(supabase, allPaths);
  const studioProducts: StudioProduct[] = products.map((p) => ({
    id: p.id, name: p.name,
    description: (p as { description?: string | null }).description ?? null,
    category: (p as { category?: string | null }).category ?? null,
    extra_info: (p as { extra_info?: string | null }).extra_info ?? null,
    images: p.product_images
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ id: i.id, url: urls.get(i.storage_path) ?? "", path: i.storage_path, isPrimary: i.is_primary })),
  }));
  // Providers never reach the client — only display identity + pricing.
  const studioModels: StudioModel[] = models.map(toClientModel);

  return (
    <div>
      <PageHeader title={t("generator.title")} sub={t("studio.sub")} />
      <Studio
        products={studioProducts}
        models={studioModels}
        credits={wallet?.balance ?? 0}
        workspaceId={workspace.id}
        initialPrompt={session ? "" : promptParam?.slice(0, 4000) ?? ""}
        session={session}
      />
    </div>
  );
}
