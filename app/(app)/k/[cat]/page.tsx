import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, PenLine, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { listAssets } from "@/lib/services/generator";
import { CATEGORIES, findCategory } from "@/lib/categories";
import { conceptModelOptions } from "@/lib/server/concept-generation";
import { getWallet } from "@/lib/services/credits";
import { CategoryHeader } from "@/components/category/category-header";
import { WorkflowCards } from "@/components/category/workflow-cards";
import { MatchingWorkspace } from "@/components/category/matching-workspace";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";

// Per request only: the page reads the caller's workspace, and a prebuilt
// shell behind the authenticated layout bakes in a redirect to /login.
export const dynamic = "force-dynamic";

/**
 * CATEGORY LANDING — discovery, then workflow, then generation.
 *
 * The user does not land on a wall of form fields: they land on a page about
 * this kind of work, pick the workflow that matches the job, and only then
 * open a generator that is already configured for it.
 */
export default async function CategoryPage({ params }: { params: Promise<{ cat: string }> }) {
  const { cat } = await params;
  const category = findCategory(cat);
  if (!category) notFound();

  const supabase = await createClient();
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await getCurrentWorkspace(supabase, user.id);
  if (!workspace) return null;

  // Preview thumbnails come from the account's own work — never stock art.
  const recent = await listAssets(supabase, workspace.id, 12);
  const paths = recent.flatMap((g) => g.generation_assets.map((a) => a.storage_path)).slice(0, 12);
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("generation-assets").createSignedUrls(paths, 3600);
    signed?.forEach((s) => { if (s.signedUrl && s.path) urls.set(s.path, s.signedUrl); });
  }
  const thumbs = paths.map((p) => urls.get(p) ?? null);
  const previews = category.workflows.map((_, i) => thumbs[i] ?? null);

  // Per-shot price at the default model, so a preset card can say what it
  // will cost before the user opens the generator.
  const [models, wallet] = await Promise.all([
    conceptModelOptions(supabase),
    getWallet(supabase, workspace.id),
  ]);
  const costPerShot = models[0]?.costEcom ?? null;

  const steps = [
    { n: 1, title: t("catpage.how1"), sub: t("catpage.how1Sub") },
    { n: 2, title: t("catpage.how2"), sub: t("catpage.how2Sub") },
    { n: 3, title: t("catpage.how3"), sub: t("catpage.how3Sub") },
  ];

  // Matching docks the shared toolbar, so everything below it — including
  // the recent-work and sibling-category sections — needs room to clear it.
  const isMatching = category.key === "matching";

  return (
    <div className={isMatching ? "pb-[7.5rem] lg:pb-[8.5rem]" : undefined}>
      <CategoryHeader
        category={category}
        title={t(`cats.${category.key}`)}
        lead={t(`cats.${category.key}Lead`)}
        backLabel={t("catpage.allCategories")}
      >
        {!category.soon && (
          <>
            <Link href={`/k/${category.slug}/${category.workflows[0].key}`}
              className="cta inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold">
              <Sparkles size={16} aria-hidden />
              {t("catpage.openGenerator")}
            </Link>
            <Link href="/generator"
              className="plate inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-[rgb(var(--cat)/0.5)]">
              <PenLine size={15} aria-hidden />
              {t("catpage.customPrompt")}
            </Link>
          </>
        )}
      </CategoryHeader>

      {/* MATCHING gets its own two-panel workspace instead of the standard
          preset grid: the whole point of the category is inspiration next to
          product, so the page is built that way. */}
      {isMatching ? (
        <MatchingWorkspace
          accent={category.accent.rgb}
          credits={wallet?.balance ?? 0}
          models={models.map((m) => ({
            id: m.id, name: m.name, badge: m.badge, pricing: m.pricing,
            resolutions: m.resolutions, ratios: m.ratios, ecomSurcharge: m.ecomSurcharge,
          }))}
        />
      ) : (
        <>
          <section>
            <SectionHeader overline={t("catpage.overline")} title={t("catpage.chooseTitle")} sub={t("catpage.chooseSub")} className="mb-3.5" />
            <WorkflowCards category={category} t={t} previews={previews} costPerShot={costPerShot} />
          </section>

          {/* HOW IT WORKS — three steps, in the category's own accent. */}
          <section className="mt-6" style={{ ["--cat" as string]: category.accent.rgb }}>
            <SectionHeader title={t("catpage.howTitle")} className="mb-3" />
            <div className="grid gap-3 [&>*]:min-w-0 sm:grid-cols-3">
              {steps.map((s) => (
                <div key={s.n} className="panel rounded-2xl p-4">
                  <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgb(var(--cat)/0.16)] text-[13px] font-bold text-[rgb(var(--cat))]">
                    {s.n}
                  </span>
                  <p className="mt-3 text-sm font-semibold tracking-tight">{s.title}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{s.sub}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* RECENT WORK */}
      <section className="mt-6">
        <SectionHeader
          overline={t("nav.groups.assets")}
          title={t("catpage.recentTitle")}
          className="mb-3"
          action={
            <Link href="/library" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent transition-opacity duration-200 hover:opacity-75">
              {t("common.viewAll")} <ArrowRight size={13} aria-hidden />
            </Link>
          }
        />
        {thumbs.filter(Boolean).length === 0 ? (
          <p className="panel rounded-2xl p-6 text-center text-sm text-muted">{t("catpage.recentEmpty")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-12">
            {thumbs.filter(Boolean).slice(0, 12).map((url, i) => (
              <Link key={i} href="/library"
                className={cn("group relative aspect-square overflow-hidden rounded-xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url!} alt="" loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* SIBLING CATEGORIES — lateral movement without going back home. */}
      <section className="mt-7 border-t border-line pt-5">
        <p className="overline mb-3">{t("catpage.allCategories")}</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.filter((c) => c.slug !== category.slug).map((c) => (
            <Link key={c.slug} href={`/k/${c.slug}`}
              className="plate inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-ink"
              style={{ ["--cat" as string]: c.accent.rgb }}>
              <c.icon size={14} aria-hidden className="text-[rgb(var(--cat))]" />
              {t(`cats.${c.key}`)}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
