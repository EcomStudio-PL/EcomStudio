import Link from "next/link";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { Brand } from "@/components/layout/brand";

export default async function Landing() {
  const { dict } = await getDictionary();
  const t = makeT(dict);
  const features = [
    { t: t("landing.f1t"), b: t("landing.f1b") },
    { t: t("landing.f2t"), b: t("landing.f2b") },
    { t: t("landing.f3t"), b: t("landing.f3b") },
  ];
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Brand />
        <Link href="/login" className="text-sm font-medium text-muted hover:text-ink">
          {t("landing.ctaLogin")}
        </Link>
      </header>
      <section className="flex flex-1 flex-col items-start justify-center py-16">
        <p className="frame-mark mb-6 px-2 font-display text-xs uppercase tracking-[0.2em] text-accent">
          EcomStudio
        </p>
        <h1 className="max-w-2xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          {t("landing.headline")}
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">{t("landing.sub")}</p>
        <div className="mt-8 flex gap-3">
          <Link href="/register" className="brand-gradient rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:text-emerald-950">
            {t("landing.cta")}
          </Link>
          <Link href="/login" className="rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold hover:bg-raised">
            {t("landing.ctaLogin")}
          </Link>
        </div>
        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.t} className="rounded-2xl border border-line bg-surface p-5">
              <h3 className="font-display text-sm font-semibold">{f.t}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.b}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className="py-8 text-xs text-muted">© {new Date().getFullYear()} EcomStudio</footer>
    </main>
  );
}
