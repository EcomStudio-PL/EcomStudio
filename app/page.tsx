import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Brand } from "@/components/layout/brand";
import { formatCredits, formatPrice } from "@/lib/utils";

export default async function LandingPage() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const supabase = await createClient();
  const { data: plans } = await supabase
    .from("subscription_plans").select("name, price_cents, currency, monthly_credits, featured, slug")
    .eq("active", true).order("sort_order").limit(4);

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
      <header className="sticky top-0 z-30 -mx-5 flex items-center justify-between gap-2 bg-bg/80 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-md sm:-mx-8 sm:px-8">
        <div className="sm:hidden"><Brand href="/" markOnly /></div>
        <div className="hidden sm:block"><Brand href="/" /></div>
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
          <a href="#features" className="transition-colors hover:text-ink">{t("landing.navFeatures")}</a>
          <a href="#how" className="transition-colors hover:text-ink">{t("landing.navHow")}</a>
          <a href="#pricing" className="transition-colors hover:text-ink">{t("landing.navPricing")}</a>
        </nav>
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href="/login" className="whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-medium text-muted transition-colors hover:text-ink">
            {t("landing.ctaLogin")}
          </Link>
          <Link href="/register" className="brand-gradient whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
            {t("landing.cta")}
          </Link>
        </div>
      </header>

      <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2">
        <div>
          <p className="frame-mark mb-6 inline-block px-2 font-display text-xs uppercase tracking-[0.2em] text-accent">EcomStudio</p>
          <h1 className="max-w-xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            {t("landing.headline")}
          </h1>
          <p className="mt-5 max-w-lg text-base text-muted sm:text-lg">{t("landing.sub")}</p>
          <p className="mt-3 text-sm font-medium text-accent2">{t("landing.pipeline")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="brand-gradient rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
              {t("landing.cta")}
            </Link>
            <a href="#how" className="rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold transition-colors hover:bg-raised">
              {t("landing.ctaHow")}
            </a>
          </div>
        </div>
        <div aria-hidden className="glass select-none rounded-2xl p-4 shadow-2xl">
          <div className="flex items-center gap-1.5 pb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent/70" />
          </div>
          <div className="flex gap-3">
            <div className="hidden w-24 shrink-0 space-y-2 rounded-xl bg-raised/70 p-2.5 sm:block">
              {[40, 60, 48, 56, 44].map((w, i) => (
                <div key={i} className={`h-2 rounded-full ${i === 0 ? "bg-accent/60" : "bg-line"}`} style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {["◆ 25", "12", "98%"].map((v, i) => (
                  <div key={i} className="rounded-xl bg-raised/70 p-2.5">
                    <div className="mb-1.5 h-1.5 w-3/5 rounded-full bg-line" />
                    <p className={`font-display text-sm font-semibold ${i === 0 ? "text-accent" : ""}`}>{v}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-raised/70 p-3">
                <div className="mb-2 h-1.5 w-1/3 rounded-full bg-line" />
                <div className="flex h-14 items-end gap-1">
                  {[35, 55, 40, 70, 60, 85, 75, 95, 80, 100].map((h, i) => (
                    <div key={i} className={`flex-1 rounded-sm ${i % 3 === 1 ? "bg-accent2/60" : "bg-accent/70"}`} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="aspect-square rounded-lg bg-gradient-to-br from-accent/25 via-raised to-accent2/20" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 py-12">
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.howTitle")}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="glass rounded-2xl p-5 transition-transform duration-150 hover:-translate-y-0.5">
              <span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-full font-display text-sm font-bold text-white">{n}</span>
              <p className="mt-3 text-sm font-semibold">{t(`landing.how${n}`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="scroll-mt-20 py-12">
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.featTitle")}</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong">
              <h3 className="font-display text-sm font-semibold">{t(`landing.feat${n}t`)}</h3>
              <p className="mt-1.5 text-sm text-muted">{t(`landing.feat${n}b`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-12">
        <h2 className="font-display text-xl font-semibold tracking-tight">{t("landing.forTitle")}</h2>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {["Allegro", "Amazon", t("landing.forShops"), "Social Ads", "Marketplace"].map((c) => (
            <span key={c} className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-muted">
              {c}
            </span>
          ))}
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 py-12">
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.navPricing")}</h2>
        <p className="mt-2 text-sm text-muted">{t("landing.pricingSub")}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(plans ?? []).map((p) => (
            <div key={p.slug} className={`glass relative flex flex-col rounded-2xl p-5 ${p.featured ? "ring-1 ring-accent2" : ""}`}>
              {p.featured && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-accent2 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  ★ {t("plan.recommended")}
                </span>
              )}
              <p className="text-sm font-semibold">{p.name}</p>
              <p className="mt-2 font-display text-2xl font-semibold tracking-tight">
                {p.price_cents === 0 ? "0 zł" : formatPrice(p.price_cents, p.currency)}
              </p>
              <p className="mt-1 text-xs text-muted">{t("plan.creditsMo", { n: formatCredits(p.monthly_credits) })}</p>
              <Link href="/register" className="mt-4 rounded-xl border border-line px-4 py-2 text-center text-sm font-semibold transition-colors hover:bg-raised">
                {t("landing.cta")}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 text-center">
        <h2 className="mx-auto max-w-xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t("landing.finalTitle")}</h2>
        <Link href="/register" className="brand-gradient mt-6 inline-flex rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
          {t("landing.cta")}
        </Link>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-8 text-xs text-muted">
        <span>© {new Date().getFullYear()} EcomStudio</span>
        <div className="flex gap-4">
          <a href="#features" className="hover:text-ink">{t("landing.navFeatures")}</a>
          <a href="#pricing" className="hover:text-ink">{t("landing.navPricing")}</a>
          <Link href="/login" className="hover:text-ink">{t("landing.ctaLogin")}</Link>
        </div>
      </footer>
    </main>
  );
}
