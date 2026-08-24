import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Box, ImageIcon, Images, Plus, Sparkles, Wand2, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";
import { getWallet } from "@/lib/services/credits";
import { listProducts } from "@/lib/services/products";
import { listAssets, listJobs } from "@/lib/services/generator";
import { signImageUrls } from "@/lib/services/images";
import { Stat } from "@/components/ui/stat";
import { Panel } from "@/components/ui/surface";
import { PanelHeader } from "@/components/ui/section-header";
import { Badge } from "@/components/ui/badge";
import { HeroArt } from "@/components/dashboard/hero-art";
import { TipBanner } from "@/components/dashboard/tip-banner";
import { creditLevel, CREDIT_METER_CLASS, CREDIT_REFERENCE } from "@/lib/credit-level";
import { formatDate } from "@/lib/utils";

export default async function DashboardPage() {
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
  const [wallet, products, jobs, recentGens, gens, { data: sub }] = await Promise.all([
    getWallet(supabase, workspace.id),
    listProducts(supabase, workspace.id, 5),
    listJobs(supabase, workspace.id, 5),
    listAssets(supabase, workspace.id, 8),
    supabase.from("generations").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    supabase.from("subscriptions").select("subscription_plans(name)")
      .eq("workspace_id", workspace.id).eq("status", "active").maybeSingle(),
  ]);
  const firstName = (profile.full_name ?? profile.email).split(" ")[0];
  const credits = wallet?.balance ?? 0;
  const planName = sub?.subscription_plans?.name ?? "Free";
  const level = creditLevel(credits);

  if (products.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-6 sm:py-10">
        <Panel className="relative overflow-hidden rounded-3xl p-7 text-center sm:p-9">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-28 h-64"
            style={{ background: "radial-gradient(30rem 14rem at 50% 0%, rgb(var(--accent) / 0.26), transparent 70%)" }}
          />
          <div className="relative">
            <p className="mx-auto mb-6 inline-block font-display text-[11px] uppercase tracking-[0.24em] text-accent">
              EcomStudio
            </p>
            <h1 className="display-lg">{t("dashboard.onbTitle")}</h1>
            <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-muted">{t("dashboard.onbSub")}</p>
            <ol className="mx-auto mt-7 max-w-xs space-y-2.5 text-left text-sm">
              {[1, 2, 3, 4].map((n) => (
                <li key={n} className="plate flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <span className="brand-gradient flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white">
                    {n}
                  </span>
                  <span className="min-w-0 flex-1">{t(`dashboard.onb${n}`)}</span>
                </li>
              ))}
            </ol>
            <Link href="/products/new"
              className="cta mt-8 inline-flex h-12 items-center gap-2 rounded-2xl px-6 text-[15px] font-semibold">
              <Sparkles size={17} aria-hidden />
              {t("dashboard.onbCta")}
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  const thumbPaths = products
    .map((p) => (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path)
    .filter((v): v is string => !!v);
  const urls = await signImageUrls(supabase, thumbPaths);

  // Real generated photos for the gallery strip — the same signed-URL path
  // the Library uses, just capped at six tiles.
  const genTiles = recentGens
    .flatMap((g) => g.generation_assets.map((a) => ({
      id: a.id, path: a.storage_path, product: g.products?.name ?? null, created: g.created_at,
    })))
    .slice(0, 6);
  const genUrls = new Map<string, string>();
  if (genTiles.length > 0) {
    const { data: signed } = await supabase.storage
      .from("generation-assets").createSignedUrls(genTiles.map((g) => g.path), 3600);
    signed?.forEach((s) => { if (s.signedUrl && s.path) genUrls.set(s.path, s.signedUrl); });
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* HERO — the greeting as a stage: neon studio scene on the right,
          the two actions that start work on the left. */}
      <Panel className="relative overflow-hidden rounded-2xl">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-72 w-[30rem]"
          style={{ background: "radial-gradient(24rem 14rem at 70% 40%, rgb(var(--accent) / 0.28), transparent 72%)" }}
        />
        <HeroArt className="pointer-events-none absolute -right-6 top-1/2 hidden h-[125%] w-auto -translate-y-1/2 lg:block" />
        <div className="relative p-5 sm:p-8 lg:max-w-[58%] lg:py-12 xl:px-12 xl:py-14">
          <p className="overline">{t("dashboard.welcomeBack")}</p>
          {/* The greeting is the loudest thing on the page, as in the
              reference: fluid from phone to 2K. */}
          <h1 className="mt-3 font-display font-semibold leading-[1.02] tracking-[-0.035em] text-[clamp(2rem,1.35rem+2.6vw,3.4rem)]">
            {t("dashboard.welcome", { name: firstName })}
          </h1>
          <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">{t("dashboard.sub")}</p>

          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Link href="/products/new"
              className="cta inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-[15px] font-semibold">
              <Plus size={18} aria-hidden />
              {t("dashboard.newProduct")}
            </Link>
            <Link href="/generator"
              className="plate inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold text-ink transition-colors hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised">
              <Wand2 size={17} className="text-accent" aria-hidden />
              {t("nav.generator")}
            </Link>
            <Link href="/prompts"
              className="plate inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold text-ink transition-colors hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised">
              <Sparkles size={17} className="text-violet" aria-hidden />
              {t("nav.promptsShort")}
              <ArrowRight size={14} aria-hidden className="text-faint" />
            </Link>
          </div>
        </div>
      </Panel>

      {/* METRICS — each metric owns a hue; credits carry the traffic light. */}
      <div className="stagger grid grid-cols-2 gap-3 [&>*]:min-w-0 lg:grid-cols-4 lg:gap-5">
        <Stat label={t("dashboard.statProducts")} value={products.length} icon={Box} tone="violet"
          hint={t("dashboard.statProductsSub")} href="/products" />
        <Stat label={t("dashboard.statGenerations")} value={gens.count ?? 0} icon={Images} tone="purple"
          hint={t("dashboard.statGenerationsSub")} href="/library" />
        <Stat label={t("dashboard.statCredits")} value={credits} icon={Zap} tone="accent"
          meter={Math.min(1, credits / CREDIT_REFERENCE)} meterClass={CREDIT_METER_CLASS[level]}
          hint={level === "empty" ? t("creditsPanel.buy") : level === "critical" ? t("creditsPanel.low") : t("dashboard.statCreditsSub")}
          href="/credits" />
        <Stat label={t("dashboard.statPlan")} value={planName} icon={Sparkles} tone="accent2"
          hint={t("dashboard.statPlanSub")} href="/plan" />
      </div>

      {/* WORK IN PROGRESS */}
      <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2 lg:gap-5">
        <Panel>
          <PanelHeader
            overline={t("nav.groups.work")}
            title={t("dashboard.recentProducts")}
            icon={Box}
            action={
              <Link href="/products" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:opacity-75">
                {t("common.viewAll")} <ArrowRight size={13} aria-hidden />
              </Link>
            }
          />
          <ul className="divide-y divide-line">
            {products.map((p) => {
              const thumb = (p.product_images.find((i) => i.is_primary) ?? p.product_images[0])?.storage_path;
              const url = thumb ? urls.get(thumb) : undefined;
              return (
                <li key={p.id}>
                  <Link href={`/products/${p.id}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-raised/60 sm:px-5">
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
                      {url
                        ? <Image src={url} alt="" fill sizes="44px" className="object-cover" />
                        : <span className="flex h-full items-center justify-center text-faint"><ImageIcon size={16} aria-hidden /></span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-[11px] text-faint">
                        {p.category ?? "—"}
                      </span>
                    </span>
                    <Badge tone={p.status === "ready" ? "green" : "neutral"} dot>
                      {t(`products.status.${p.status}`)}
                    </Badge>
                    <ArrowRight size={13} aria-hidden className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="flex flex-col">
          <PanelHeader
            overline={t("nav.groups.assets")}
            title={t("dashboard.recentJobs")}
            icon={Images}
            action={
              <Link href="/library" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:opacity-75">
                {t("common.viewAll")} <ArrowRight size={13} aria-hidden />
              </Link>
            }
          />
          {genTiles.length > 0 ? (
            /* The real photos, as a gallery — the point of the product. */
            <div className="grid grid-cols-3 gap-2 px-4 pb-4 sm:px-5 sm:pb-5">
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
                    <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                    {g.product && (
                      <span className="absolute inset-x-2 bottom-1.5 truncate text-[10px] font-semibold text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        {g.product}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ) : jobs.length > 0 ? (
            <ul className="divide-y divide-line">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(140deg,rgb(var(--accent)/0.22),rgb(var(--accent)/0.05))] text-accent">
                    <Sparkles size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{j.products?.name ?? "—"}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatDate(j.created_at, locale)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-5 py-12 text-center">
              <span aria-hidden className="glow-accent mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(140deg,rgb(var(--accent)/0.22),rgb(var(--accent)/0.05))] text-accent">
                <Sparkles size={19} />
              </span>
              <p className="text-sm font-semibold">{t("history.emptyTitle")}</p>
              <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted">{t("history.emptyBody")}</p>
              <Link href="/prompts"
                className="cta mt-5 inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold">
                <Sparkles size={14} aria-hidden />
                {t("nav.promptsShort")}
              </Link>
            </div>
          )}
        </Panel>
      </div>

      {/* WSKAZÓWKA — one dismissible nudge, never a modal (UX spec §9). */}
      <TipBanner
        id="open-prompts-v1"
        text={t("dashboard.tipBody")}
        ctaLabel={t("dashboard.tipCta")}
        ctaHref="/prompts"
      />
    </div>
  );
}
