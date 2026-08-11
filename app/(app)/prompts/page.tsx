import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listProducts } from "@/lib/services/products";
import { listSystemTemplates, listProductPrompts } from "@/lib/services/prompts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreatePromptsButton, CopyPromptButton } from "@/components/prompts/prompt-actions";

export default async function PromptsPage({ searchParams }: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product: productParam } = await searchParams;
  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;
  const [products, templates] = await Promise.all([
    listProducts(supabase, workspace.id),
    listSystemTemplates(supabase),
  ]);
  const selectedId = productParam ?? products[0]?.id;
  const prompts = selectedId ? await listProductPrompts(supabase, selectedId) : [];

  return (
    <div>
      <PageHeader title={t("prompts.title")} sub={t("prompts.sub")} />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title={t("prompts.pickProduct")} />
            <ul className="max-h-72 overflow-y-auto p-2">
              {products.map((p) => (
                <li key={p.id}>
                  <Link href={`/prompts?product=${p.id}`}
                    className={`block truncate rounded-lg px-3 py-2 text-sm ${p.id === selectedId ? "bg-raised font-medium" : "text-muted hover:bg-raised"}`}>
                    {p.name}
                  </Link>
                </li>
              ))}
              {products.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">{t("products.emptyTitle")}</li>
              )}
            </ul>
          </Card>
          <Card className="p-5">
            <Badge tone="amber">{t("common.comingSoon")}</Badge>
            <p className="mt-2 text-sm text-muted">{t("prompts.aiSoon")}</p>
          </Card>
        </div>
        <div className="space-y-5">
          {selectedId && (
            <Card>
              <CardHeader title={t("prompts.forProduct")} sub={t("prompts.fromTemplatesHint")}
                action={<CreatePromptsButton productId={selectedId} />} />
              {prompts.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted">{t("prompts.empty")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {prompts.map((p) => (
                    <li key={p.id} className="px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold">{p.concept_name}</h4>
                          <Badge>{p.format}</Badge>
                        </div>
                        <CopyPromptButton text={p.prompt_text} />
                      </div>
                      <p className="mt-2 text-sm text-muted">{p.prompt_text}</p>
                      {p.reference_rationale && (
                        <p className="mt-2 text-xs text-muted/80">
                          <span className="font-medium">{t("prompts.rationale")}:</span> {p.reference_rationale}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card>
            <CardHeader title={t("prompts.systemTemplates")} />
            <ul className="divide-y divide-line">
              {templates.map((tpl) => (
                <li key={tpl.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="text-sm font-medium">{tpl.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge>{tpl.format}</Badge>
                    {tpl.style && <Badge tone="blue">{tpl.style}</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      {products.length === 0 && (
        <div className="mt-5">
          <EmptyState title={t("products.emptyTitle")} body={t("products.emptyBody")} />
        </div>
      )}
    </div>
  );
}
