import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Wand2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { SessionForm, type PromptProductOption, type SessionModelOption } from "@/components/prompts/session-form";
import { CategoryHeader } from "@/components/category/category-header";
import { findCategory } from "@/lib/categories";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * WORKFLOW WORKSPACE — the generator, opened with this workflow's own
 * defaults: its framing, its shot count and its style directive. Sibling
 * workflows are a row of chips at the top, so switching preset is one click
 * and never a trip back to the category page.
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

  const [products, { data: sessions }, { data: plannerProviders }, { data: withKey }, wallet, { data: sub }] = await Promise.all([
    listProducts(supabase, workspace.id, 20),
    supabase.from("prompt_sessions")
      .select("id, product_name, status, aspect_ratio, created_at, reference_paths")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }).limit(8),
    supabase.from("ai_providers").select("id").eq("active", true).in("slug", ["openai", "google"]),
    supabase.rpc("providers_with_credentials"),
    getWallet(supabase, workspace.id),
    supabase.from("subscriptions").select("subscription_plans(name)")
      .eq("workspace_id", workspace.id).eq("status", "active").maybeSingle(),
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

  const statusTone = { ready: "green", failed: "red" } as const;
  const recent = (
    <div className="min-w-0 space-y-3">
      <h3 className="px-1 font-display text-sm font-semibold text-muted">{t("psess.recent")}</h3>
      {(sessions ?? []).length === 0 && (
        <Card className="p-6 text-center">
          <Wand2 size={20} className="mx-auto text-faint" />
          <p className="mt-2 text-sm text-muted">{t("psess.empty")}</p>
        </Card>
      )}
      {(sessions ?? []).map((s) => (
        <Link key={s.id} href={`/prompts/${s.id}`} prefetch
          className="panel panel-interactive flex items-center gap-3 rounded-2xl px-4 py-3">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line bg-raised">
            {s.reference_paths?.[0] && urls.get(s.reference_paths[0]) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls.get(s.reference_paths[0])!} alt="" className="h-full w-full object-cover" loading="lazy" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{s.product_name}</p>
            <p className="text-xs text-faint">{new Date(s.created_at).toLocaleDateString()} · {s.aspect_ratio}</p>
          </div>
          <span className="shrink-0">
            <Badge tone={statusTone[s.status as keyof typeof statusTone] ?? "amber"}>
              {t(`psess.status_${s.status}`, {}) || s.status}
            </Badge>
          </span>
          <ArrowRight size={14} className="shrink-0 text-faint" />
        </Link>
      ))}
    </div>
  );

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
      <div className="mb-5 flex flex-wrap gap-1.5" style={{ ["--cat" as string]: category.accent.rgb }}>
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
        initialStyle={t(`wf.${category.key}.${workflow.key}.style`)}
        initialRatio={workflow.ratio}
        initialShots={workflow.shots}
        products={productOptions}
        workspaceId={workspace.id}
        engineAvailable={engineAvailable}
        models={modelOptions}
        balance={wallet?.balance ?? 0}
        plan={sub?.subscription_plans?.name ?? "Free"}
        aside={recent}
      />
    </div>
  );
}
