import Link from "next/link";
import { ArrowRight, Wand2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listProducts } from "@/lib/services/products";
import { signImageUrls } from "@/lib/services/images";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionForm, type PromptProductOption } from "@/components/prompts/session-form";

export const dynamic = "force-dynamic";

/** PROMPTY — the product image intelligence entry point: paste product data,
 *  add photos, get 5 professional prompt concepts. */
export default async function PromptsPage() {
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
  const [products, { data: sessions }, { data: analysisProvider }, { data: withKey }] = await Promise.all([
    listProducts(supabase, workspace.id, 20),
    supabase.from("prompt_sessions")
      .select("id, product_name, status, aspect_ratio, created_at, reference_paths")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }).limit(12),
    supabase.from("ai_providers").select("id").eq("slug", "google").eq("active", true).maybeSingle(),
    supabase.rpc("providers_with_credentials"),
  ]);
  const engineAvailable =
    !!analysisProvider && ((withKey ?? []) as string[]).includes(analysisProvider.id);

  const productPaths = products.flatMap((p) => p.product_images.map((i) => i.storage_path));
  const sessionThumbs = (sessions ?? []).map((s) => s.reference_paths?.[0]).filter(Boolean) as string[];
  const urls = await signImageUrls(supabase, [...productPaths, ...sessionThumbs]);

  const productOptions: PromptProductOption[] = products.map((p) => ({
    id: p.id, name: p.name, category: (p as { category?: string | null }).category ?? null,
    images: p.product_images
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ path: i.storage_path, url: urls.get(i.storage_path) ?? "" })),
  }));

  const statusTone = { ready: "green", failed: "red" } as const;

  return (
    <div>
      <PageHeader overline={t("nav.groups.create")} title={t("prompts.title")} sub={t("psess.sub")} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <SessionForm products={productOptions} workspaceId={workspace.id} engineAvailable={engineAvailable} />

        <div className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:h-fit">
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
      </div>
    </div>
  );
}
