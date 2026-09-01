import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listGalleryItems } from "@/lib/server/gallery";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import type { GenModel } from "@/components/genv3/types";
import { CategoryHeader } from "@/components/category/category-header";
import { CATEGORY_VARIANT, DEFAULT_VARIANT, findCategory } from "@/lib/categories";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * WORKFLOW WORKSPACE — the managed generator opened with this workflow's own
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
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) redirect("/home");
  const [{ data: plannerProviders }, { data: withKey }, wallet, modelOptions, gallery] = await Promise.all([
    supabase.from("ai_providers").select("id").eq("active", true).in("slug", ["openai", "google"]),
    supabase.rpc("providers_with_credentials"),
    getWallet(supabase, workspace.id),
    conceptModelOptions(supabase),
    listGalleryItems(supabase, workspace.id, { limit: 24 }),
  ]);
  const keyed = new Set((withKey ?? []) as string[]);
  const engineAvailable = (plannerProviders ?? []).some((p) => keyed.has(p.id));

  const models: GenModel[] = modelOptions.map((m) => ({
    id: m.id, name: m.name, badge: m.badge, badgeTone: m.badgeTone,
    description: m.description, pricing: m.pricing,
    resolutions: m.resolutions, ratios: m.ratios,
    maxOutputs: 1, supportsRefs: true, surcharge: m.ecomSurcharge,
  }));


  // An empty or missing style entry must stay empty: makeT echoes the key on
  // a miss, and that key would otherwise become the seller's "preferred
  // style" in the planner brief.
  const styleKey = `wf.${category.key}.${workflow.key}.style`;
  const styleValue = t(styleKey);
  const styleHint = styleValue && styleValue !== styleKey ? styleValue : undefined;

  return (
    // Same calm workspace scope as /prompts — the compact category header
    // stays (it is navigation between presets, not a marketing header).
    <div className="workspace workspace-page gen-shell">
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

      <GeneratorWorkspace
        mode="managed"
        models={models}
        credits={wallet?.balance ?? 0}
        workspaceId={workspace.id}
        engineAvailable={engineAvailable}
        initialItems={gallery.items}
        initialCursor={gallery.nextCursor}
        initialStyle={styleHint}
        initialRatio={workflow.ratio}
        initialShots={workflow.shots}
        variant={CATEGORY_VARIANT[category.key] ?? DEFAULT_VARIANT}
      />
    </div>
  );
}
