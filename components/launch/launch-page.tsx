import Link from "next/link";
import { Camera, Lock, ShoppingBag } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { WaitlistForm } from "@/components/launch/waitlist-form";
import type { LaunchField } from "@/lib/server/launch-page";

/**
 * PREMIERA GROVBASE — the pre-launch front door.
 *
 * Four sections and nothing else: what it is, why it is worth an address,
 * how it works, and one more chance to leave that address. Every line comes
 * from `content`, which the admin edits and which falls back to the shipped
 * translation, so this file holds layout and no copy.
 *
 * It uses the product's own tokens (panel, cta, accent, line) rather than a
 * separate marketing palette, so dark and light are both correct by
 * construction and the page cannot drift from the app it is announcing.
 */
export function LaunchPage({ content, signedIn, loginLabel, privacyNote, privacyLinkLabel, privacyLabel, termsLabel }: {
  content: Record<LaunchField, string>;
  signedIn: boolean;
  loginLabel: string;
  /** The lead-in of the consent line; the link text follows it. */
  privacyNote: string;
  privacyLinkLabel: string;
  privacyLabel: string;
  termsLabel: string;
}) {
  const c = content;
  const values = [
    { icon: Camera, title: c["value.t1"], body: c["value.b1"] },
    { icon: Lock, title: c["value.t2"], body: c["value.b2"] },
    { icon: ShoppingBag, title: c["value.t3"], body: c["value.b3"] },
  ];
  const steps = [c["how.s1"], c["how.s2"], c["how.s3"]];

  return (
    <main data-launch-page className="relative min-h-[100svh] overflow-x-clip">
      {/* One quiet wash behind the fold — the brand present, not shouting. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[42rem]"
        style={{
          background:
            "radial-gradient(46rem 22rem at 50% -18%, rgb(var(--accent) / 0.16), transparent 68%),"
            + "radial-gradient(32rem 18rem at 88% 2%, rgb(var(--violet) / 0.12), transparent 70%)",
        }} />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-5 sm:px-8">
        <header className="flex items-center justify-between gap-3 py-5 pt-[calc(1.25rem+env(safe-area-inset-top))]">
          <Brand href="/" wordmarkClassName="hidden xs:inline-flex sm:inline-flex" />
          <div className="flex items-center gap-1.5">
            <LocaleSwitcher />
            <ThemeToggle />
            <Link href={signedIn ? "/dashboard" : "/login"} data-launch-login
              className="whitespace-nowrap rounded-xl border border-line px-3.5 py-2 text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised">
              {loginLabel}
            </Link>
          </div>
        </header>

        {/* ── 1. HERO ───────────────────────────────────────────────────── */}
        <section className="grid items-center gap-10 pb-16 pt-6 sm:pb-24 sm:pt-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14">
          <div className="min-w-0">
            <p data-launch-badge
              className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--accent)/0.35)] bg-accent-soft/30 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-accent">
              {c["hero.badge"]}
            </p>
            <h1 data-launch-h1
              className="mt-5 text-balance font-display text-[2.1rem] font-semibold leading-[1.08] tracking-tight sm:text-[3rem] lg:text-[3.4rem]">
              {c["hero.h1"]}
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-[16.5px]">
              {c["hero.sub"]}
            </p>

            <div className="mt-8 max-w-xl">
              <WaitlistForm placeholder={c["hero.placeholder"]} cta={c["hero.cta"]} source="hero"
                consentLabel={c["hero.consent"]} id="waitlist-hero" />
              <p className="mt-2.5 text-[13px] text-muted">{c["hero.note"]}</p>
              <p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-ink">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                {c["hero.trust"]}
              </p>
              <p data-launch-privacy className="mt-3 text-[11.5px] text-faint">
                {privacyNote}{" "}
                <Link href="/polityka-prywatnosci" className="underline underline-offset-2 transition-colors hover:text-accent">
                  {privacyLinkLabel}
                </Link>.
              </p>
            </div>
          </div>

          <HeroVisual image={c["hero.image"]} />
        </section>

        {/* ── 2. VALUE ──────────────────────────────────────────────────── */}
        <section data-launch-value className="scroll-mt-20 border-t border-line py-16 sm:py-20">
          <h2 className="max-w-2xl text-balance font-display text-[1.6rem] font-semibold tracking-tight sm:text-[2.1rem]">
            {c["value.heading"]}
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {values.map((v) => (
              <div key={v.title} className="panel rounded-2xl p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft/50 text-accent">
                  <v.icon size={18} aria-hidden />
                </span>
                <p className="mt-4 text-[15px] font-semibold tracking-tight">{v.title}</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{v.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 3. HOW IT WORKS ───────────────────────────────────────────── */}
        <section data-launch-how className="scroll-mt-20 border-t border-line py-16 sm:py-20">
          <h2 className="max-w-2xl text-balance font-display text-[1.6rem] font-semibold tracking-tight sm:text-[2.1rem]">
            {c["how.heading"]}
          </h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-3 sm:gap-4">
            {steps.map((step, i) => (
              <li key={step} className="relative sm:pr-6">
                <span className="font-display text-[2rem] font-semibold leading-none text-accent/35 tabular-nums">
                  0{i + 1}
                </span>
                <p className="mt-3 text-[15px] font-semibold tracking-tight">{step}</p>
                {i < steps.length - 1 && (
                  <span aria-hidden
                    className="absolute right-0 top-4 hidden h-px w-4 bg-gradient-to-r from-[rgb(var(--accent)/0.5)] to-transparent sm:block" />
                )}
              </li>
            ))}
          </ol>
        </section>

        {/* ── 4. FINAL CTA ──────────────────────────────────────────────── */}
        <section data-launch-final className="pb-16 sm:pb-20">
          <div className="panel relative overflow-hidden rounded-3xl px-6 py-12 sm:px-12 sm:py-16">
            <span aria-hidden className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(28rem 14rem at 18% -10%, rgb(var(--accent) / 0.18), transparent 70%),"
                  + "radial-gradient(24rem 12rem at 92% 110%, rgb(var(--violet) / 0.14), transparent 70%)",
              }} />
            <div className="relative max-w-2xl">
              <h2 className="text-balance font-display text-[1.7rem] font-semibold tracking-tight sm:text-[2.3rem]">
                {c["final.heading"]}
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">{c["final.body"]}</p>
              <div className="mt-7 max-w-xl">
                <WaitlistForm placeholder={c["hero.placeholder"]} cta={c["final.cta"]} source="final"
                  consentLabel={c["hero.consent"]} id="waitlist-final" />
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-8 text-[12.5px] text-muted">
          <span className="flex items-center gap-2.5">
            <Brand href="/" height={22} />
            © {new Date().getFullYear()}
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/polityka-prywatnosci" className="transition-colors hover:text-ink">{privacyLabel}</Link>
            <Link href="/regulamin" className="transition-colors hover:text-ink">{termsLabel}</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}

/**
 * The hero visual. An admin-uploaded screenshot when there is one; otherwise
 * the promise itself, drawn from the product's own surfaces: a raw photo, the
 * engine, the finished shot. No invented UI, no stock imagery.
 */
function HeroVisual({ image }: { image: string }) {
  if (image) {
    return (
      <div data-launch-visual className="panel overflow-hidden rounded-3xl p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="h-auto w-full rounded-2xl object-cover" />
      </div>
    );
  }
  return (
    <div data-launch-visual className="panel relative overflow-hidden rounded-3xl p-5 sm:p-7">
      <div className="grid grid-cols-[1fr_auto_1.35fr] items-center gap-3 sm:gap-4">
        {/* Left: the reference photo the seller already has — plain, flat, unlit. */}
        <span aria-hidden className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-line bg-sunken">
          <span className="absolute inset-x-[22%] bottom-[24%] top-[30%] rounded-lg bg-[rgb(var(--ink)/0.10)]" />
          <span className="absolute inset-x-0 bottom-0 h-[24%] bg-[rgb(var(--ink)/0.05)]" />
        </span>
        <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft/60 text-accent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </span>
        {/* Right: the same product, lit and staged — the promise of the product. */}
        <span aria-hidden className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-gradient-to-br from-[rgb(var(--accent)/0.30)] via-[rgb(var(--violet)/0.22)] to-transparent ring-1 ring-[rgb(var(--accent)/0.30)]">
          <span className="absolute inset-x-[24%] bottom-[26%] top-[28%] rounded-lg bg-[rgb(var(--surface)/0.55)] shadow-[0_18px_40px_-14px_rgb(var(--accent)/0.85)]" />
          <span className="absolute inset-x-[18%] bottom-[20%] h-2 rounded-full bg-[rgb(var(--accent)/0.35)] blur-[6px]" />
        </span>
      </div>
      <div aria-hidden className="mt-5 grid grid-cols-4 gap-2">
        {[0.26, 0.19, 0.13, 0.08].map((tint, i) => (
          <span key={i}
            className="aspect-square rounded-xl border border-line"
            style={{ background: `linear-gradient(150deg, rgb(var(--accent) / ${tint}), rgb(var(--sunken) / 0.9))` }} />
        ))}
      </div>
    </div>
  );
}
