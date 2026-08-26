import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { SessionForm, type PromptProductOption, type SessionModelOption } from "@/components/prompts/session-form";
import type { RecentSession } from "@/components/prompts/recent-panel";
import { CategoryHeader } from "@/components/category/category-header";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, findCategory } from "@/lib/categories";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * WORKFLOW WORKSPACE — the generator opened with this workflow's own
 * defaults: its framing, its shot count, its style directive and the extra
 * decisions its category actually needs. Sibling workflows sit in a chip row
 * at the top, so switching preset never means going back a page.
 */
export default async function WorkflowPage({ params }: {
  params: Promise<{ cat: string; wf: string }>;
}) {
  const { cat, wf } = await params;
  const category = findCategory(cat);
  if (!category) notFound();
  const workflow = category.workflows.find((w) => w.key === wf);
  if (!workflow || workflow.soon || category.soon) notFound();

  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;

  const [products, { data: sessions }, { data: plannerProviders }, { data: withKey }, wallet] = await Promise.all([
    listProducts(supabase, workspace.id, 20),
    supabase.from("prompt_sessions")
      .select("id, product_name, status, aspect_ratio, created_at, reference_paths")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }).limit(20),
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

  // An empty or missing style entry must stay empty: makeT echoes the key on
  // a miss, and that key would otherwise become the seller's "preferred
  // style" in the planner brief.
  const styleKey = `wf.${category.key}.${workflow.key}.style`;
  const styleValue = t(styleKey);
  const styleHint = styleValue && styleValue !== styleKey ? styleValue : undefined;

  return (
    <div>
      <CategoryHeader
        compact
        category={category}
        backHref={`/k/${category.slug}`}
        backLabel={t(`cats.${category.key}`)}
        title={t(`wf.${category.key}.${workflow.key}.name`)}
        lead={t(`wf.${category.key}.${workflow.key}.sub`)}
      />

      {/* SIBLING PRESETS — switch workflow without leaving the workspace. */}
      <div className="mb-4 flex flex-wrap gap-1.5" style={{ ["--cat" as string]: category.accent.rgb }}>
        {category.workflows.filter((w) => !w.soon).map((w) => {
          const active = w.key === workflow.key;
          return (
            <Link key={w.key} href={`/k/${category.slug}/${w.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold transition-colors duration-200",
                active
                  ? "bg-[rgb(var(--cat)/0.16)] text-ink ring-1 ring-[rgb(var(--cat)/0.45)]"
                  : "plate text-muted hover:text-ink",
              )}>
              <w.icon size={14} aria-hidden className={active ? "text-[rgb(var(--cat))]" : "text-faint"} />
              {t(`wf.${category.key}.${w.key}.name`)}
              <span className="text-[11px] font-bold tabular-nums text-faint">{w.ratio}</span>
            </Link>
          );
        })}
      </div>

      <SessionForm
        initialStyle={styleHint}
        initialRatio={workflow.ratio}
        initialShots={workflow.shots}
        variant={CATEGORY_VARIANT[category.key] ?? DEFAULT_VARIANT}
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
