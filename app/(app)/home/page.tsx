import Link from "next/link";
import { ArrowRight, Package, PenLine, Sparkles, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listAssets } from "@/lib/services/generator";
import { Panel } from "@/components/ui/surface";
import { PanelHeader, SectionHeader } from "@/components/ui/section-header";
import { HeroArt } from "@/components/dashboard/hero-art";
import { TipBanner } from "@/components/dashboard/tip-banner";
import { CategoryGrid } from "@/components/home/category-grid";
import { creditLevel, CREDIT_METER_CLASS, CREDIT_REFERENCE } from "@/lib/credit-level";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * HOMEPAGE — replaces the old Pulpit, built top-to-bottom per the UX spec:
 * 1) headline + "Zacznij generować" (leads to the category grid) and
 *    "Kontynuuj: [last generator]", 2) a COMPACT stats strip, 3) the category
 *    grid, 4) one dismissible AI suggestion, 5) recent activity → Library.
 * Generation is the product; analytics stays a strip, not the hero.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [profile, workspace] = await Promise.all([
    getProfile(supabase, user.id),
    getCurrentWorkspace(supabase, user.id),
  ]);
  if (!workspace || !profile) return null;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [wallet, recentGens, weekCount, monthCount, { data: lastJob }] = await Promise.all([
    getWallet(supabase, workspace.id),
    listAssets(supabase, workspace.id, 8),
    supabase.from("generations").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id).gte("created_at", weekStart.toISOString()),
    supabase.from("generations").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id).gte("created_at", monthStart.toISOString()),
    supabase.from("generation_jobs").select("prompt_origin")
      .eq("workspace_id", workspace.id).order("created_at", { ascending: false })
      .limit(1).maybeSingle(),
  ]);

  const firstName = (profile.full_name ?? profile.email).split(" ")[0];
  const credits = wallet?.balance ?? 0;
  const level = creditLevel(credits);
  // "Kontynuuj" points at whichever generator mode the user last worked in.
  const lastCustom = lastJob?.prompt_origin === "custom";
  const continueHref = lastJob ? (lastCustom ? "/generator" : "/prompts") : null;
  const continueLabel = lastCustom ? t("mega.custom") : t("mega.engine");

  const genTiles = recentGens
    .flatMap((g) => g.generation_assets.map((a) => ({ id: a.id, path: a.storage_path, product: g.products?.name ?? null })))
    .slice(0, 6);
  const genUrls = new Map<string, string>();
  if (genTiles.length > 0) {
    const { data: signed } = await supabase.storage
      .from("generation-assets").createSignedUrls(genTiles.map(
        (g) => g.path), 3600);
    signed?.forEach((s) => { if (s.signedUrl && s.path) genUrls.set(s.path, s.signedUrl); });
  }

  // Category tiles preview the account's own work rather than stock art.
  const categoryPreviews = Array.from({ length: 6 }, (_, i) => {
    const tile = genTiles[i];
    return tile ? genUrls.get(tile.path) ?? null : null;
  });

  const stats: { label: string; value: string; meter?: number; meterClass?: string; href: string }[] = [
    {
      label: t("home.statCredits"), value: new Intl.NumberFormat(locale).format(credits),
      meter: Math.min(1, credits / CREDIT_REFERENCE), meterClass: CREDIT_METER_CLASS[level], href: "/credits",
    },
    { label: t("home.statWeek"), value: String(weekCount.count ?? 0), href: "/library" },
    { label: t("home.statMonth"), value: String(monthCount.count ?? 0), href: "/library" },
  ];

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* 1 — MAIN ACTION */}
      <Panel className="relative overflow-hidden rounded-2xl">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-72 w-[30rem]"
          style={{ background: "radial-gradient(24rem 14rem at 70% 40%, rgb(var(--accent) / 0.28), transparent 72%)" }}
        />
        <HeroArt className="pointer-events-none absolute -right-6 top-1/2 hidden h-[125%] w-auto -translate-y-1/2 lg:block" />
        {/* The hero states who you are and where to start, then gets out of
            the way: on a phone it occupies roughly a third of the first
            screen instead of all of it, so the categories are visible without
            scrolling. */}
        <div className="relative p-4 sm:p-6 lg:max-w-[56%] lg:py-7 xl:px-8 xl:py-8">
          <p className="overline">{t("dashboard.welcomeBack")}</p>
          <h1 className="mt-2 font-display font-semibold leading-[1.04] tracking-[-0.035em] text-[clamp(1.45rem,0.95rem+1.5vw,2.6rem)]">
            {t("dashboard.welcome", { name: firstName })}
          </h1>
          <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted sm:text-[14px]">{t("home.sub")}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5 sm:gap-2.5">
            <a href="#kategorie"
              className="cta inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold sm:flex-none">
              <Sparkles size={16} aria-hidden />
              {t("home.startCta")}
            </a>
            {continueHref && (
              <Link href={continueHref}
                className="plate inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised">
                <PenLine size={15} className="text-accent" aria-hidden />
                <span className="truncate">{t("home.continue", { name: continueLabel })}</span>
              </Link>
            )}
            <Link href="/products"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted transition-colors duration-200 hover:text-ink">
              <Package size={15} aria-hidden />
              {t("nav.products")}
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        </div>
      </Panel>

      {/* 2 — COMPACT STATS STRIP */}
      <div className="panel flex flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:gap-0 sm:divide-x sm:divide-line">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group flex min-w-0 flex-1 items-center gap-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
            <span aria-hidden className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              s.meter !== undefined
                ? "bg-[linear-gradient(145deg,rgb(var(--accent)/0.26),rgb(var(--accent)/0.07))] text-accent"
                : "bg-raised text-muted",
            )}>
              <Zap size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">{s.label}</span>
              <span className="metric block text-[17px] leading-tight text-ink group-hover:text-accent">{s.value}</span>
              {s.meter !== undefined && (
                <span className="mt-1 block h-[3px] w-full max-w-[9rem] overflow-hidden rounded-full bg-[rgb(var(--ink)/0.10)]">
                  <span className={cn("block h-full rounded-full", s.meterClass)} style={{ width: `${Math.max(3, s.meter * 100)}%` }} />
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>

      {/* 3 — CATEGORY GRID */}
      <section>
        <SectionHeader overline={t("mega.create")} title={t("home.categoriesTitle")} className="mb-3.5 mt-1" />
        <CategoryGrid t={t} previews={categoryPreviews} />
      </section>

      {/* 4 — ONE AI SUGGESTION, dismissible, never a modal */}
      <TipBanner
        id="open-prompts-v2"
        text={t("dashboard.tipBody")}
        ctaLabel={t("dashboard.tipCta")}
        ctaHref="/prompts"
      />

      {/* 5 — RECENT ACTIVITY */}
      {genTiles.length > 0 && (
        <Panel>
          <PanelHeader
            overline={t("nav.groups.assets")}
            title={t("home.recentTitle")}
            action={
              <Link href="/library" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:opacity-75">
                {t("common.viewAll")} <ArrowRight size={13} aria-hidden />
              </Link>
            }
          />
          <div className="grid grid-cols-3 gap-2 px-4 pb-4 sm:grid-cols-6 sm:px-5 sm:pb-5">
            {genTiles.map((g) => {
              const url = genUrls.get(g.path);
              return (
                <Link key={g.id} href="/library"
                  className="group relative aspect-square overflow-hidden rounded-xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
                  {url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={g.product ?? ""} loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
                  )}
                </Link>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
