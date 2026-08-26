import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { SessionForm, type PromptProductOption, type SessionModelOption } from "@/components/prompts/session-form";
import type { RecentSession } from "@/components/prompts/recent-panel";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, findCategory } from "@/lib/categories";

export const dynamic = "force-dynamic";

/** GENERATOR UJĘĆ — the batch workspace: product data + photos in, a board of
 *  prepared shots out. Every generation parameter lives in the docked
 *  toolbar, so this page stays short. */
export default async function PromptsPage({ searchParams }: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat } = await searchParams;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;

  // Availability check goes through the definer RPC: ai_provider_credentials
  // is admin-only under RLS, so reading it directly told every customer the
  // engine was unavailable even when a key was configured.
  const [products, { data: sessions }, { data: plannerProviders }, { data: withKey }, wallet] = await Promise.all([
    listProducts(supabase, workspace.id, 20),
    supabase.from("prompt_sessions")
      .select("id, product_name, status, aspect_ratio, created_at, reference_paths")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }).limit(20),
    // The PLANNER is available when ANY planner-capable provider is active
    // with a stored key — not just Google (the planner may run on OpenAI).
    supabase.from("ai_providers").select("id").eq("active", true).in("slug", ["openai", "google"]),
    supabase.rpc("providers_with_credentials"),
    getWallet(supabase, workspace.id),
  ]);
  const keyed = new Set((withKey ?? []) as string[]);
  const engineAvailable = (plannerProviders ?? []).some((p) => keyed.has(p.id));
  const modelOptions: SessionModelOption[] = await conceptModelOptions(supabase);

  const productPaths = products.flatMap((p) => p.product_images.map((i) => i.storage_path));
  const sessionThumbs = (sessions ?? []).map((s) => s.reference_paths?.[0]).filter(Boolean) as string[];
  const urls = await signImageUrls(supabase, [...productPaths, ...sessionThumbs]);

  const productOptions: PromptProductOption[] = products.map((p) => ({
    id: p.id, name: p.name, category: (p as { category?: string | null }).category ?? null,
    description: (p as { description?: string | null }).description ?? null,
    extraInfo: (p as { extra_info?: string | null }).extra_info ?? null,
    images: p.product_images
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ path: i.storage_path, url: urls.get(i.storage_path) ?? "" })),
  }));

  const recent: RecentSession[] = (sessions ?? []).map((s) => ({
    id: s.id, productName: s.product_name, status: s.status, ratio: s.aspect_ratio,
    createdAt: s.created_at,
    thumbnail: s.reference_paths?.[0] ? urls.get(s.reference_paths[0]) ?? null : null,
  }));

  // Legacy `?cat=` links still land on the right workspace flavour.
  const category = findCategory(cat);
  const variant = category ? CATEGORY_VARIANT[category.key] ?? DEFAULT_VARIANT : DEFAULT_VARIANT;
  // makeT echoes the key when an entry is missing (Matching has no style
  // hint), and shipping "cats.matchingStyle" to the planner as the seller's
  // preferred style would be worse than sending nothing.
  const styleKey = category ? `cats.${category.key}Style` : "";
  const styleValue = styleKey ? t(styleKey) : "";
  const initialStyle = styleValue && styleValue !== styleKey ? styleValue : undefined;

  return (
    <div>
      <PageHeader overline={t("mega.create")} title={t("gen.title")} sub={t("psess.sub")} />
      <SessionForm
        initialStyle={initialStyle}
        variant={variant}
        products={productOptions}
        workspaceId={workspace.id}
        engineAvailable={engineAvailable}
        models={modelOptions}
        balance={wallet?.balance ?? 0}
        recent={recent}
      />
    </div>
  );
}
