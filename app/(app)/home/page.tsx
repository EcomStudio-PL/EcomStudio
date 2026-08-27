import { redirect } from "next/navigation";
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
import { Media } from "@/components/mobile/media";
import { creditLevel, CREDIT_METER_CLASS, CREDIT_REFERENCE } from "@/lib/credit-level";
import { firstName } from "@/lib/plan-tone";
import { Greeting } from "@/components/home/greeting";
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
  if (!user) redirect("/login");
  const [profile, workspace] = await Promise.all([
    getProfile(supabase, user.id),
    getCurrentWorkspace(supabase, user.id),
  ]);
  if (!workspace || !profile) redirect("/login");

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

  // A real name if the profile has one; otherwise the email local part,
  // capitalised — never the raw handle the screenshots exposed.
  const who = firstName(profile.full_name, profile.email);
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

  // Three recent images shown on desktop hover over a category tile.
  const hoverStrip = genTiles
    .map((g) => genUrls.get(g.path))
    .filter((u): u is string => Boolean(u))
    .slice(0, 3);

  // Two labels per stat: the phone gets a short one that FITS at 320px, the
  // desktop keeps the full wording. Ellipsising "Generacje w tym tygodniu"
  // down to "Generacje w tym…" told the user nothing.
  const stats: { label: string; short: string; value: string; meter?: number; meterClass?: string; href: string }[] = [
    {
      label: t("home.statCredits"), short: t("home.statCreditsShort"),
      value: new Intl.NumberFormat(locale).format(credits),
      meter: Math.min(1, credits / CREDIT_REFERENCE), meterClass: CREDIT_METER_CLASS[level], href: "/credits",
    },
    { label: t("home.statWeek"), short: t("home.statWeekShort"), value: String(weekCount.count ?? 0), href: "/library" },
    { label: t("home.statMonth"), short: t("home.statMonthShort"), value: String(monthCount.count ?? 0), href: "/library" },
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
          <h1 className="mt-2 font-display font-semibold leading-[1.04] tracking-[-0.035em] text-[clamp(1.35rem,0.95rem+1.5vw,2.6rem)]">
            <Greeting name={who} fallback={t("dashboard.welcome", { name: who })} />
          </h1>
          <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted sm:text-[14px]">{t("home.sub")}</p>

          {/* One primary action, one secondary, one quiet tertiary — and the
              primary owns a full line on a phone so its label cannot wrap. */}
          <div className="mt-4 flex flex-col gap-2 sm:mt-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5">
            <a href="#kategorie"
              className="cta inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 text-sm font-semibold">
              <Sparkles size={16} aria-hidden />
              {t("home.startCta")}
            </a>
            {continueHref && (
              <Link href={continueHref}
                className="plate inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised">
                <PenLine size={15} className="shrink-0 text-accent" aria-hidden />
                {/* The phone shows the short form so the label never loses
                    its ending; the desktop names the mode it will resume. */}
                <span className="sm:hidden">{t("home.continueShort")}</span>
                <span className="hidden sm:inline">{t("home.continue", { name: continueLabel })}</span>
              </Link>
            )}
            <Link href="/products"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold text-muted transition-colors duration-200 hover:text-ink sm:h-11 sm:px-3 sm:text-sm">
              <Package size={15} aria-hidden />
              {t("nav.products")}
              <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        </div>
      </Panel>

      {/* 2 — COMPACT STATS STRIP */}
      {/* Three facts in three columns — the stacked version spent a third of
          the first screen restating numbers the header already shows. */}
      <div className="panel grid grid-cols-3 gap-1 rounded-2xl px-2 py-3 sm:gap-0 sm:divide-x sm:divide-line sm:px-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group flex min-w-0 flex-col px-1.5 sm:px-4 sm:first:pl-0 sm:last:pr-0">
            <span className="flex items-center gap-1.5">
              <Zap size={11} aria-hidden className={cn("shrink-0", s.meter !== undefined ? "text-accent" : "text-faint")} />
              <span className="min-w-0 text-[9.5px] font-semibold uppercase leading-tight tracking-[0.08em] text-faint">
                <span className="sm:hidden">{s.short}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </span>
            </span>
            <span className="metric mt-1 block truncate text-[19px] leading-none text-ink group-hover:text-accent">{s.value}</span>
            {s.meter !== undefined && (
              <span className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-[rgb(var(--ink)/0.10)]">
                <span className={cn("block h-full rounded-full", s.meterClass)} style={{ width: `${Math.max(3, s.meter * 100)}%` }} />
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* 3 — CATEGORY GRID */}
      <section>
        <SectionHeader overline={t("mega.create")} title={t("home.categoriesTitle")} className="mb-3.5 mt-1" />
        <CategoryGrid t={t} previews={categoryPreviews} hoverStrip={hoverStrip} />
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
          {/* Phone: a swipeable rail of squares — the tiles stay big enough to
              recognise instead of shrinking to six thumbnails per line.
              Tablet and up: the six-column grid. Both use the same framed
              media, so every tile is square before its picture loads. */}
          <div className="px-4 pb-4 sm:hidden">
            <div className="rail-x">
              {genTiles.map((g) => (
                <Link key={g.id} href="/library" className="group w-[6.75rem]">
                  <Media src={genUrls.get(g.path) ?? null} alt={g.product ?? ""} ratio="1/1"
                    className="w-full ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]" />
                </Link>
              ))}
            </div>
          </div>
          <div className="hidden grid-cols-6 gap-2 px-4 pb-4 sm:grid sm:px-5 sm:pb-5">
            {genTiles.map((g) => (
              <Link key={g.id} href="/library" className="group block">
                <Media src={genUrls.get(g.path) ?? null} alt={g.product ?? ""} ratio="1/1"
                  className="w-full ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]" />
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
