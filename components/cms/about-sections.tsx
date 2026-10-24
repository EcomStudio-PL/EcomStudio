import Link from "next/link";
import {
  ArrowDown, ArrowRight, Building2, Camera, Check, ImageIcon, ShoppingBag, Sparkles, Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AuthLink } from "@/components/auth/auth-link";
import { Reveal } from "@/components/cms/widgets";
import { AboutFaq } from "@/components/cms/about-faq";
import { IceSlotImage } from "@/components/seller-home/ice-slot-image";
import { cmsIcon } from "@/lib/cms-icons";
import type { CmsBlock, CmsBlockContent } from "@/lib/cms";
import {
  ABOUT_SLOT, itemSlot, publicText, shownItems, shownPoints, type AboutSlotKey, type StartCta,
} from "@/lib/about-page";
import { stegaStrip } from "@/lib/ice/stega";
import type { ResolvedSlot, SlotMap } from "@/lib/server/media-slots";
import { cn } from "@/lib/utils";
import type { RenderContext } from "./blocks";

/**
 * THE "O NAS" PAGE — nine sections, drawn from their CMS content.
 *
 * Server components: what a visitor is not meant to see (a tile switched off,
 * a text still holding "[…]") is filtered before anything renders, so it
 * never reaches the HTML, the RSC payload or the JSON-LD
 * (lib/about-page.ts). Every word comes from the block's content — editable
 * in "Edytuj stronę" and in Strony WWW — and every picture from a media slot.
 *
 * Visual rules: a light page by default (tokens carry dark mode), magenta as
 * the one accent, rounded cards with hairline borders and soft shadows, wide
 * visuals allowed to leave the 1100px text column. Motion is an entrance
 * fade/rise (Reveal) and hover lifts — nothing loops, nothing hijacks the
 * scroll, and the global reduced-motion rule flattens all of it.
 */

const LABEL = "font-display text-[11.5px] font-semibold uppercase tracking-[0.2em] text-accent";
const H2 = "font-display text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-ink";
const BODY = "text-[15.5px] leading-[1.7] text-muted sm:text-[16.5px]";
const CARD = "rounded-[1.75rem] border border-line bg-surface shadow-[0_1px_2px_rgb(15_15_30/0.04),0_12px_32px_-18px_rgb(15_15_30/0.18)]";
const LIFT = "transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-[rgb(var(--accent)/0.28)] hover:shadow-[0_2px_6px_rgb(15_15_30/0.05),0_24px_48px_-24px_rgb(214_40_207/0.35)]";
const BTN_PRIMARY = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-6 py-3 text-[14.5px] font-semibold text-white shadow-sm brand-gradient transition-[opacity,transform] hover:opacity-95 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[rgb(var(--accent)/0.6)] focus-visible:ring-offset-surface";
const BTN_SECONDARY = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-6 py-3 text-[14.5px] font-semibold text-ink transition-colors hover:border-[rgb(var(--accent)/0.35)] hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[rgb(var(--accent)/0.6)] focus-visible:ring-offset-surface";

/** Paragraphs of a multi-line field (blank-line separated). */
function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function slotOf(slots: SlotMap | undefined, key: AboutSlotKey | null): ResolvedSlot | undefined {
  return key && slots ? slots.get(key) : undefined;
}

const two = (n: number) => String(n).padStart(2, "0");

/** Only a site path or an https address — the same rule as every CMS link. */
function linkOf(url: string | undefined): string | null {
  const v = (url ?? "").trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return /^https:\/\//i.test(v) ? v : null;
}

/**
 * "Wypróbuj / Zacznij za darmo". An address typed in the block wins; empty,
 * the button follows the platform's own state (lib/about-page.ts startCta) —
 * the sign-up dialog when sign-up is open, the waitlist before launch.
 */
function StartButton({ content, start, className, children }: {
  content: CmsBlockContent; start: StartCta | undefined; className: string; children: React.ReactNode;
}) {
  const typed = linkOf(content.ctaUrl);
  if (typed) return <Link href={typed} className={className} data-about-cta="custom">{children}</Link>;
  const s = start ?? { kind: "home", href: "/" };
  if (s.kind === "register") {
    return <AuthLink mode="register" className={className} data-about-cta="register">{children}</AuthLink>;
  }
  return <Link href={s.href} className={className} data-about-cta={s.kind}>{children}</Link>;
}

/** Reveal's shape without the fade — for what is on screen at load. */
function Static({ className, children }: { className?: string; delay?: number; children: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}

/* ── neutral canvases for empty slots ───────────────────────────────────── */

/**
 * WHAT AN EMPTY PICTURE LOOKS LIKE. A calm GrovBase surface — soft brand
 * tint, a fine dot grid, a few framed shapes — deliberately abstract, so it
 * can never be mistaken for a photo or a generated result. Decorative only.
 */
function Canvas({ icon: Icon = ImageIcon, frames = 3, className }: {
  icon?: LucideIcon; frames?: 0 | 1 | 3; className?: string;
}) {
  return (
    <div aria-hidden data-about-fallback className={cn("absolute inset-0 overflow-hidden", className)}
      style={{
        background:
          "radial-gradient(120% 90% at 85% 10%, rgb(var(--accent) / 0.16), transparent 55%)," +
          "radial-gradient(90% 80% at 10% 100%, rgb(var(--violet) / 0.14), transparent 60%)," +
          "rgb(var(--sunken))",
      }}>
      <div className="absolute inset-0 opacity-60"
        style={{ backgroundImage: "radial-gradient(rgb(var(--line-strong) / 0.55) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
      {frames === 3 && (
        <div className="absolute inset-0 flex items-center justify-center gap-[3%] px-[8%]">
          <span className="block aspect-[4/5] w-[22%] -rotate-3 rounded-2xl border border-white/70 bg-surface/70 shadow-[0_18px_40px_-24px_rgb(15_15_30/0.45)] backdrop-blur-[2px]" />
          <span className="grid aspect-[4/5] w-[28%] place-items-center rounded-2xl border border-white/80 bg-surface/80 shadow-[0_24px_50px_-26px_rgb(214_40_207/0.45)]">
            <Icon className="h-[22%] w-[22%] text-accent/70" strokeWidth={1.5} />
          </span>
          <span className="block aspect-[4/5] w-[22%] rotate-3 rounded-2xl border border-white/70 bg-surface/70 shadow-[0_18px_40px_-24px_rgb(15_15_30/0.45)] backdrop-blur-[2px]" />
        </div>
      )}
      {frames === 1 && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid aspect-square w-[34%] max-w-[9rem] place-items-center rounded-3xl border border-white/80 bg-surface/80 shadow-[0_24px_50px_-26px_rgb(214_40_207/0.45)]">
            <Icon className="h-[38%] w-[38%] text-accent/70" strokeWidth={1.5} />
          </span>
        </div>
      )}
    </div>
  );
}

/** The story's empty visual: the process itself, drawn — a phone photo, the
 *  effect, a finished file. Shapes and icons, no picture of anything. */
function ProcessCanvas() {
  const Step = ({ icon: Icon, tone }: { icon: LucideIcon; tone: "plain" | "accent" }) => (
    <span className={cn(
      "grid aspect-square w-[22%] place-items-center rounded-2xl border shadow-[0_18px_40px_-24px_rgb(15_15_30/0.4)]",
      tone === "accent" ? "border-transparent text-white brand-gradient" : "border-white/80 bg-surface/85 text-accent/80",
    )}>
      <Icon className="h-[36%] w-[36%]" strokeWidth={1.6} />
    </span>
  );
  return (
    <div aria-hidden data-about-fallback className="absolute inset-0">
      <Canvas frames={0} />
      <div className="absolute inset-0 flex items-center justify-center gap-[4%] px-[8%]">
        <Step icon={Camera} tone="plain" />
        <ArrowRight className="h-[7%] w-[7%] shrink-0 text-accent/50" />
        <Step icon={Wand2} tone="accent" />
        <ArrowRight className="h-[7%] w-[7%] shrink-0 text-accent/50" />
        <Step icon={ImageIcon} tone="plain" />
      </div>
    </div>
  );
}

/** A picture frame: the slot when it is filled, the canvas when it is not. */
function Frame({ slot, locale, alt, ratio, sizes, priority, fallback, className, slotKey, phoneRatio }: {
  slot: ResolvedSlot | undefined; locale: string; alt: string; ratio: string; sizes: string;
  priority?: boolean; fallback: React.ReactNode; className?: string; slotKey: string; phoneRatio?: string;
}) {
  return (
    <div data-config-key={slotKey} data-about-slot={slotKey} data-filled={slot ? "1" : "0"}
      className={cn("relative overflow-hidden aspect-[var(--about-ratio)] max-sm:aspect-[var(--about-ratio-m,var(--about-ratio))]", className)}
      style={{ "--about-ratio": ratio, ...(phoneRatio ? { "--about-ratio-m": phoneRatio } : {}) } as React.CSSProperties}>
      {/* The alt falls back to the section's heading — without the editor's
          invisible markers, which only belong in painted text. */}
      {slot ? <IceSlotImage slot={slot} locale={locale} alt={stegaStrip(alt)} label={stegaStrip(alt)} sizes={sizes} priority={priority} /> : fallback}
    </div>
  );
}

/* ── the sections ───────────────────────────────────────────────────────── */

export function renderAboutBlock(block: CmsBlock, ctx: RenderContext, first: boolean): React.ReactNode {
  const c: CmsBlockContent = block.content ?? {};
  const { locale } = ctx;
  const T = (k: keyof CmsBlockContent) => publicText(c[k] as never, locale);
  const slots = ctx.slots;
  // Whichever section a visitor reads first owns the page's <h1> and is
  // painted at once — the hero normally, the next section when the hero is
  // switched off. An entrance fade would hold the largest paint until
  // hydration.
  const Heading = first ? "h1" : "h2";
  const Enter = first ? Static : Reveal;

  switch (block.type) {
    /* 1 ── HERO ───────────────────────────────────────────────────────────── */
    case "about_hero": {
      const slot = slotOf(slots, ABOUT_SLOT.hero);
      return (
        <div data-about="hero">
          <Enter className="mx-auto max-w-[56rem] text-center">
            {T("badge") && (
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[rgb(var(--accent)/0.22)] bg-accent-soft/60 px-3.5 py-1.5">
                <span className={LABEL}>{T("badge")}</span>
              </p>
            )}
            <Heading className="font-display text-[clamp(2.05rem,5.4vw,4.1rem)] font-semibold leading-[1.04] tracking-[-0.032em] text-ink [text-wrap:balance]">
              {T("title")}
            </Heading>
            {T("subtitle") && (
              <p className="mx-auto mt-6 max-w-[42rem] text-[clamp(1rem,1.7vw,1.2rem)] leading-relaxed text-muted [text-wrap:pretty]">
                {T("subtitle")}
              </p>
            )}
          </Enter>
          <Enter delay={120} className="mt-[clamp(2.5rem,5vw,4rem)]">
            <Frame slot={slot} locale={locale} alt={T("title")} ratio="21 / 9" phoneRatio="4 / 3" slotKey={ABOUT_SLOT.hero}
              sizes="(max-width: 1023px) 100vw, 88rem" priority={first}
              className={cn(CARD, "rounded-[2rem]")}
              fallback={<Canvas icon={Sparkles} />} />
          </Enter>
        </div>
      );
    }

    /* 2 ── SKĄD SIĘ WZIĘLIŚMY ─────────────────────────────────────────────── */
    case "about_story": {
      const body = paragraphs(T("description"));
      const label = T("ctaLabel");
      return (
        <div data-about="story" className="grid items-center gap-[clamp(2rem,5vw,4.5rem)] lg:grid-cols-[1.05fr_1fr]">
          <Reveal className="lg:order-2">
            <Frame slot={slotOf(slots, ABOUT_SLOT.story)} locale={locale} alt={T("title")} ratio="4 / 3" slotKey={ABOUT_SLOT.story}
              sizes="(max-width: 1023px) 100vw, 40rem" className={CARD} fallback={<ProcessCanvas />} />
          </Reveal>
          <Enter className="lg:order-1">
            {T("badge") && <p className={cn(LABEL, "mb-4")}>{T("badge")}</p>}
            <Heading className={H2}>{T("title")}</Heading>
            <div className="mt-6 space-y-4">
              {body.map((p, i) => <p key={i} className={BODY}>{p}</p>)}
            </div>
            {label && (
              <div className="mt-8">
                <StartButton content={c} start={ctx.start} className={BTN_PRIMARY}>
                  {label}<ArrowRight size={16} aria-hidden />
                </StartButton>
              </div>
            )}
          </Enter>
        </div>
      );
    }

    /* 3 ── JAK POWSTAJE EFEKT ─────────────────────────────────────────────── */
    case "about_process": {
      const steps = shownItems(c.items, locale);
      return (
        <div data-about="process">
          <Enter className="mx-auto max-w-2xl text-center">
            {T("badge") && <p className={cn(LABEL, "mb-4")}>{T("badge")}</p>}
            <Heading className={H2}>{T("title")}</Heading>
          </Enter>
          {/* A row of three on a desktop, a column on a phone — 01 → 02 → 03
              either way. The arrow belongs to the step it points INTO, so the
              list stays a plain <ol> of three items for a screen reader. */}
          <ol className="mt-[clamp(2.25rem,4.5vw,3.5rem)] flex flex-col gap-10 lg:flex-row lg:gap-10">
            {steps.map((it, i) => {
              const Icon = cmsIcon(it.icon) ?? Sparkles;
              return (
                <li key={i} className="relative flex-1" data-about-step={i + 1}>
                  {i > 0 && (
                    <span aria-hidden className={cn(
                      "absolute left-1/2 top-0 z-[1] grid h-9 w-9 -translate-x-1/2 -translate-y-[calc(50%+1.25rem)] place-items-center rounded-full border border-line bg-surface text-accent shadow-sm",
                      "lg:left-0 lg:top-1/2 lg:-translate-x-[calc(50%+1.25rem)] lg:-translate-y-1/2",
                    )}>
                      <ArrowDown className="lg:hidden" size={16} />
                      <ArrowRight className="hidden lg:block" size={16} />
                    </span>
                  )}
                  <Reveal delay={i * 90} className="h-full">
                    <div className={cn(CARD, LIFT, "relative h-full p-7 sm:p-8")}>
                      <div className="flex items-center justify-between">
                        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
                          <Icon size={22} strokeWidth={1.8} aria-hidden />
                        </span>
                        <span className="font-display text-[2rem] font-semibold leading-none tracking-tight text-accent/25">{two(i + 1)}</span>
                      </div>
                      <h3 className="mt-6 font-display text-[1.15rem] font-semibold tracking-tight text-ink">{publicText(it.title, locale)}</h3>
                      {publicText(it.description, locale) && (
                        <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{publicText(it.description, locale)}</p>
                      )}
                    </div>
                  </Reveal>
                </li>
              );
            })}
          </ol>
        </div>
      );
    }

    /* 4 ── DLACZEGO ZDJĘCIE MA ZNACZENIE ──────────────────────────────────── */
    case "about_importance": {
      const body = paragraphs(T("description"));
      const label = T("ctaLabel");
      const href = linkOf(c.ctaUrl);
      const tile = (key: AboutSlotKey, ratio: string, icon: LucideIcon, sizes: string) => (
        <Frame slot={slotOf(slots, key)} locale={locale} alt={T("title")} ratio={ratio} slotKey={key} sizes={sizes}
          className="rounded-[1.5rem] border border-line bg-surface shadow-[0_18px_40px_-26px_rgb(15_15_30/0.35)]"
          fallback={<Canvas icon={icon} frames={1} />} />
      );
      return (
        <div data-about="importance" className="grid items-center gap-[clamp(2rem,5vw,4.5rem)] lg:grid-cols-[1fr_1fr]">
          <Reveal>
            <div className="grid grid-cols-[1.3fr_1fr] gap-3 sm:gap-4">
              <div className="row-span-2">{tile(ABOUT_SLOT.importanceMain, "4 / 5", ShoppingBag, "(max-width: 1023px) 58vw, 26rem")}</div>
              {tile(ABOUT_SLOT.importance1, "1 / 1", ImageIcon, "(max-width: 1023px) 40vw, 18rem")}
              {tile(ABOUT_SLOT.importance2, "1 / 1", Sparkles, "(max-width: 1023px) 40vw, 18rem")}
            </div>
          </Reveal>
          <Enter>
            {T("badge") && <p className={cn(LABEL, "mb-4")}>{T("badge")}</p>}
            <Heading className={H2}>{T("title")}</Heading>
            <div className="mt-6 space-y-4">
              {body.map((p, i) => <p key={i} className={BODY}>{p}</p>)}
            </div>
            {label && href && (
              <div className="mt-8">
                <Link href={href} className={BTN_SECONDARY} data-about-cta="examples">
                  {label}<ArrowRight size={16} aria-hidden />
                </Link>
              </div>
            )}
          </Enter>
        </div>
      );
    }

    /* 5 ── W CO WIERZYMY ──────────────────────────────────────────────────── */
    case "about_values": {
      const values = shownItems(c.items, locale);
      return (
        <div data-about="values">
          <Enter className="mx-auto max-w-2xl text-center">
            {T("badge") && <p className={cn(LABEL, "mb-4")}>{T("badge")}</p>}
            <Heading className={H2}>{T("title")}</Heading>
          </Enter>
          {/* Flex, wrapped and centred: three a row on a desktop, two on a
              tablet, one on a phone — and a short last row is centred rather
              than left with a hole where a switched-off tile used to be. */}
          <ul className="mt-[clamp(2.25rem,4.5vw,3.5rem)] flex flex-wrap justify-center gap-4 sm:gap-5" data-count={values.length}>
            {values.map((it, i) => {
              const Icon = cmsIcon(it.icon) ?? Check;
              const desc = publicText(it.description, locale);
              return (
                <li key={i} data-about-value={i + 1}
                  className="shrink-0 grow-0 basis-full sm:basis-[calc((100%_-_1.25rem)/2)] lg:basis-[calc((100%_-_2.5rem)/3)]">
                  <Reveal delay={(i % 3) * 80} className="h-full">
                    <div className={cn(CARD, LIFT, "relative h-full overflow-hidden p-7 sm:p-8")}>
                      <Icon aria-hidden className="pointer-events-none absolute -bottom-9 -right-9 h-28 w-28 text-accent/[0.06]" strokeWidth={1.25} />
                      <span className="font-display text-[13px] font-semibold tracking-[0.12em] text-accent">{two(i + 1)}</span>
                      <h3 className="mt-3 font-display text-[1.15rem] font-semibold leading-snug tracking-tight text-ink">{publicText(it.title, locale)}</h3>
                      {desc && <p className="relative mt-2.5 text-[14.5px] leading-relaxed text-muted">{desc}</p>}
                    </div>
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    /* 6 ── DLA KOGO ───────────────────────────────────────────────────────── */
    case "about_audience": {
      const cards = shownItems(c.items, locale);
      return (
        <div data-about="audience">
          <Enter className="mx-auto max-w-2xl text-center">
            {T("badge") && <p className={cn(LABEL, "mb-4")}>{T("badge")}</p>}
            <Heading className={H2}>{T("title")}</Heading>
          </Enter>
          <div className={cn("mt-[clamp(2.25rem,4.5vw,3.5rem)] grid gap-5 sm:gap-6",
            cards.length > 1 ? "md:grid-cols-2" : "mx-auto max-w-xl")}>
            {cards.map((it, i) => {
              const key = itemSlot(block.type, it);
              const Icon = cmsIcon(it.icon) ?? (i === 0 ? ShoppingBag : Building2);
              const points = shownPoints(it.points, locale);
              return (
                <Reveal key={i} delay={i * 100} className="h-full">
                  <article className={cn(CARD, LIFT, "flex h-full flex-col overflow-hidden")} data-about-card={i + 1}>
                    {key ? (
                      <Frame slot={slotOf(slots, key)} locale={locale} alt={publicText(it.title, locale)} ratio="16 / 10" slotKey={key}
                        sizes="(max-width: 767px) 100vw, 34rem" className="border-b border-line"
                        fallback={<Canvas icon={Icon} frames={1} />} />
                    ) : null}
                    <div className="flex flex-1 flex-col p-7 sm:p-8">
                      <h3 className="font-display text-[1.35rem] font-semibold tracking-tight text-ink">{publicText(it.title, locale)}</h3>
                      {publicText(it.description, locale) && (
                        <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{publicText(it.description, locale)}</p>
                      )}
                      {points.length > 0 && (
                        <ul className="mt-6 space-y-3">
                          {points.map((p, j) => {
                            const PIcon = cmsIcon(p.icon) ?? Check;
                            return (
                              <li key={j} className="flex items-start gap-3 text-[14.5px] leading-snug text-ink">
                                <span aria-hidden className="mt-[1px] grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                                  <PIcon size={15} strokeWidth={2} />
                                </span>
                                <span className="pt-1">{publicText(p.title, locale)}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </div>
      );
    }

    /* 7 ── ZESPÓŁ ─────────────────────────────────────────────────────────── */
    case "about_team": {
      const people = shownItems(c.items, locale);
      return (
        <div data-about="team">
          <Enter className="mx-auto max-w-2xl text-center">
            {T("badge") && <p className={cn(LABEL, "mb-4")}>{T("badge")}</p>}
            <Heading className={H2}>{T("title")}</Heading>
          </Enter>
          <div className={cn("mx-auto mt-[clamp(2.25rem,4.5vw,3.5rem)] grid max-w-4xl gap-5 sm:gap-6",
            people.length > 1 ? "sm:grid-cols-2" : "max-w-md")}>
            {people.map((it, i) => {
              const key = itemSlot(block.type, it);
              const slot = slotOf(slots, key);
              const name = publicText(it.title, locale);
              const initial = (it.value ?? "").trim().slice(0, 2) || stegaStrip(name).slice(0, 1);
              const role = publicText(it.badge, locale);
              return (
                <Reveal key={i} delay={i * 100} className="h-full">
                  <article className={cn(CARD, LIFT, "flex h-full flex-col p-7 sm:p-9")} data-about-person={i + 1}>
                    <div className="flex items-center gap-4">
                      <div data-config-key={key ?? undefined} data-about-slot={key ?? undefined} data-filled={slot ? "1" : "0"}
                        className="relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-full ring-1 ring-[rgb(var(--accent)/0.18)]">
                        {slot ? (
                          <IceSlotImage slot={slot} locale={locale} alt={stegaStrip(name)} sizes="72px" />
                        ) : (
                          <span aria-hidden className="grid h-full w-full place-items-center font-display text-[1.6rem] font-semibold text-accent"
                            style={{ background: "linear-gradient(135deg, rgb(var(--accent-soft)), rgb(var(--violet) / 0.16))" }}>
                            {initial}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-display text-[1.25rem] font-semibold tracking-tight text-ink">{name}</h3>
                        {role && <p className="mt-0.5 text-[13.5px] font-medium text-accent">{role}</p>}
                      </div>
                    </div>
                    {publicText(it.description, locale) && (
                      <p className="mt-6 text-[15px] leading-relaxed text-muted">{publicText(it.description, locale)}</p>
                    )}
                  </article>
                </Reveal>
              );
            })}
          </div>
        </div>
      );
    }

    /* 8 ── FAQ ────────────────────────────────────────────────────────────── */
    case "about_faq": {
      const qa = shownItems(c.items, locale)
        .map((it) => ({ q: publicText(it.title, locale), a: publicText(it.description, locale) }))
        .filter((x) => x.q && x.a);
      if (qa.length === 0) return null;
      // Structured data from exactly the questions painted below — the same
      // filtered list, with the editor's invisible markers stripped.
      const ld = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: qa.map((x) => ({
          "@type": "Question", name: stegaStrip(x.q),
          acceptedAnswer: { "@type": "Answer", text: stegaStrip(x.a) },
        })),
      };
      return (
        <div data-about="faq" className="mx-auto max-w-[45rem]">
          <Enter className="text-center">
            {T("badge") && <p className={cn(LABEL, "mb-4")}>{T("badge")}</p>}
            <Heading className={H2}>{T("title")}</Heading>
          </Enter>
          <Reveal delay={80} className="mt-[clamp(2rem,4vw,3rem)]">
            <AboutFaq items={qa} />
          </Reveal>
          <script type="application/ld+json" data-about-ld
            dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
        </div>
      );
    }

    /* 9 ── KOŃCOWE CTA ────────────────────────────────────────────────────── */
    case "about_cta": {
      const label = T("ctaLabel");
      const label2 = T("cta2Label");
      const href2 = linkOf(c.cta2Url);
      return (
        <Enter>
          <div data-about="cta"
            className="relative overflow-hidden rounded-[2rem] px-6 py-[clamp(3rem,7vw,5.5rem)] text-center text-white shadow-[0_30px_80px_-40px_rgb(176_0_172/0.65)] sm:px-12"
            style={{ background: "linear-gradient(135deg, #8E0C8A 0%, #B000AC 42%, #C21AB8 70%, #D628CF 100%)" }}>
            <div aria-hidden className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(60% 80% at 100% 0%, rgb(249 80 225 / 0.45), transparent 60%), radial-gradient(50% 70% at 0% 100%, rgb(255 255 255 / 0.10), transparent 60%)" }} />
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.18]"
              style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.55) 1px, transparent 1px)", backgroundSize: "24px 24px", maskImage: "linear-gradient(to bottom, black, transparent 85%)" }} />
            <div className="relative mx-auto max-w-2xl">
              <Heading className="font-display text-[clamp(1.85rem,4.4vw,3.1rem)] font-semibold leading-[1.06] tracking-[-0.028em] [text-wrap:balance]">
                {T("title")}
              </Heading>
              {T("subtitle") && <p className="mx-auto mt-4 max-w-xl text-[clamp(1rem,1.6vw,1.15rem)] leading-relaxed text-white/90">{T("subtitle")}</p>}
              {(label || (label2 && href2)) && (
                <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                  {label && (
                    <StartButton content={c} start={ctx.start}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-7 py-3 text-[15px] font-semibold text-[#9E0E99] shadow-[0_10px_30px_-12px_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#B000AC]">
                      {label}<ArrowRight size={16} aria-hidden />
                    </StartButton>
                  )}
                  {label2 && href2 && (
                    <Link href={href2} data-about-cta="contact"
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/55 px-7 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#B000AC]">
                      {label2}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </Enter>
      );
    }

    default:
      return null;
  }
}

