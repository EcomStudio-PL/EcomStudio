import Link from "next/link";
import { Check, Minus, Quote, Sparkles } from "lucide-react";
import type { CmsBlock, CmsBlockContent, CmsItem } from "@/lib/cms";
import { lt, safeUrl, videoEmbedUrl } from "@/lib/cms";
import { resolveStyle } from "@/lib/cms-style";
import { sanitizeRichText, sanitizeHtml } from "@/lib/cms-sanitize";
import { cmsIcon } from "@/lib/cms-icons";
import { formatCredits, formatPrice } from "@/lib/utils";
import { EMPTY_LIVE_DATA, type CmsLiveData } from "@/lib/server/cms-data";
import { metaFor, type MediaIndex } from "@/lib/server/cms-media";
import { Reveal, BeforeAfter, LazyVideo } from "./widgets";
import { CmsImage } from "./cms-image";
import { CustomBlock } from "./custom-block";
import { CmsForm } from "./cms-form";

/**
 * THE PUBLIC RENDERER.
 *
 * This is the file a visitor's browser is actually paying for, so it is
 * deliberately the SMALL half of the CMS. None of the builder is reachable
 * from here: no drag-and-drop, no code editor, no device frame, no admin
 * dependency. A section is a switch statement and some markup.
 *
 * Three rules hold for every branch below.
 *
 *   STRUCTURED DATA GOES THROUGH REACT, which escapes it. The only two places
 *   markup is printed are `rich_text` and `custom_code`, and both pass through
 *   the allowlist in lib/cms-sanitize.ts first.
 *
 *   ONE BROKEN SECTION IS NOT A BROKEN PAGE. Each section renders inside its
 *   own try/catch: on the public site a section that throws is skipped and the
 *   other twenty-nine still render; in the admin preview the same failure is
 *   shown, because the person looking at it is the person who can fix it.
 *
 *   NOTHING HERE KNOWS ABOUT THE DASHBOARD. These components are imported by
 *   the public routes only. The signed-in app and the admin panel have their
 *   own layouts and are not reachable from any style or script in a section.
 */

export type CmsT = (key: string, vars?: Record<string, string | number>) => string;

export type RenderContext = {
  locale: string;
  t: CmsT;
  /** Image dimensions and derivatives, resolved once per page. */
  media: MediaIndex;
  /** Tool registry, model list and plan table, for the live sections. */
  data: CmsLiveData;
  /** Admin preview: show broken sections instead of hiding them. */
  admin?: boolean;
  /** Whether the auth CTAs should be offered at all (pre-launch they are not). */
  showAuth?: boolean;
};

export function BlockRenderer({ blocks, ctx }: { blocks: CmsBlock[]; ctx: RenderContext }) {
  return (
    <>
      {blocks
        .filter((b) => b.visible)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((block, i) => (
          <CmsSection key={block.id ?? i} block={block} ctx={ctx} first={i === 0} />
        ))}
    </>
  );
}

/**
 * The context a page builds once and hands to the renderer. Kept as a factory
 * so every caller gets the same defaults and nobody has to remember that an
 * empty media index is a Map and not an object.
 */
export function renderContext(input: {
  locale: string;
  t: CmsT;
  media?: MediaIndex;
  data?: CmsLiveData;
  admin?: boolean;
  showAuth?: boolean;
}): RenderContext {
  return {
    locale: input.locale,
    t: input.t,
    media: input.media ?? new Map(),
    data: input.data ?? EMPTY_LIVE_DATA,
    admin: input.admin,
    showAuth: input.showAuth,
  };
}

/* ────────────────────────────────────────────────────────────────────────
   THE SECTION FRAME
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Every section is wrapped identically: one element carrying its own id (the
 * scope custom CSS is rewritten under), its style variables, its responsive
 * visibility and its analytics name.
 *
 * `spacer` and `divider` are the two types with no inner column — a spacer IS
 * its padding, and a rule that stops short of the gutters looks like a
 * mistake.
 */
function CmsSection({ block, ctx, first }: { block: CmsBlock; ctx: RenderContext; first: boolean }) {
  const id = block.id ?? `s${block.sort_order}`;
  const { className, style } = resolveStyle(block.style);
  const anchor = cleanAnchor(block.anchor);

  let body: React.ReactNode = null;
  try {
    body = renderBlock(block, ctx, first);
  } catch {
    // A section that throws must not take the page with it. In production it
    // simply is not there; in the preview it says so.
    if (!ctx.admin) return null;
    body = (
      <div className="cms-broken" data-cms-broken>
        <p className="font-semibold">{ctx.t("cms.sectionError")}</p>
        <p className="mt-1">{ctx.t("cms.sectionErrorBody")}</p>
      </div>
    );
  }
  if (body === null) return null;

  const bare = block.type === "spacer" || block.type === "divider";

  return (
    <section
      data-cms-section={id}
      data-cms-type={block.type}
      {...(block.analytics_id ? { "data-analytics": block.analytics_id } : {})}
      {...(anchor ? { id: anchor } : {})}
      className={className}
      style={style}
    >
      {bare ? body : <div className="cms-in">{body}</div>}
    </section>
  );
}

/** An anchor ends up in a URL and in a CSS selector; only the safe shape
 *  survives, and an unsafe one becomes no anchor rather than a broken one. */
function cleanAnchor(value: string | null | undefined): string | null {
  const a = (value ?? "").trim().replace(/^#/, "");
  return /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(a) ? a : null;
}

/* ────────────────────────────────────────────────────────────────────────
   THE SECTIONS
   ──────────────────────────────────────────────────────────────────────── */

function renderBlock(block: CmsBlock, ctx: RenderContext, first: boolean): React.ReactNode {
  const c: CmsBlockContent = block.content ?? {};
  const { locale, t } = ctx;
  const T = (k: keyof CmsBlockContent) => lt(c[k] as never, locale);
  const items = c.items ?? [];
  const img = (url: string | undefined) => metaFor(ctx.media, url);

  switch (block.type) {
    /* ── LAYOUT ─────────────────────────────────────────────────────────── */

    case "hero":
      return (
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="cms-center-x max-w-2xl">
            {T("badge") && (
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent-soft/60 px-3.5 py-1.5 font-display text-[11.5px] font-semibold uppercase tracking-[0.16em] text-accent">
                <Sparkles size={13} aria-hidden />{T("badge")}
              </p>
            )}
            <h1 className="font-display text-[clamp(2rem,5.5vw,3.75rem)] font-semibold leading-[1.05] tracking-tight">
              {T("title")}
            </h1>
            {T("subtitle") && (
              <p className="mt-5 max-w-xl text-[clamp(0.95rem,1.6vw,1.15rem)] leading-relaxed text-muted">
                {T("subtitle")}
              </p>
            )}
            <CtaRow content={c} locale={locale} className="mt-8" />
          </div>
          <Reveal>
            {c.mediaUrl && videoEmbedUrl(c.mediaUrl) ? (
              <LazyVideo embed={videoEmbedUrl(c.mediaUrl)} posterUrl={safeUrl(c.posterUrl)} label={t("cms.video")} />
            ) : c.mediaUrl ? (
              <div className="overflow-hidden rounded-3xl border border-line shadow-2xl">
                {/* The hero image is the LCP element on nearly every page:
                    eager, high priority, and never lazy. */}
                <CmsImage url={c.mediaUrl} alt={T("alt") || T("title")} meta={img(c.mediaUrl)}
                  priority={first} aspect="16 / 10" sizes="(max-width: 1023px) 100vw, 50vw"
                  className="h-full w-full object-cover" />
              </div>
            ) : (
              <HeroMockup />
            )}
          </Reveal>
        </div>
      );

    case "cta":
      return (
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-[clamp(1.5rem,3.5vw,2.5rem)] font-semibold tracking-tight">{T("title")}</h2>
          {T("description") && <p className="mt-3 text-[15px] leading-relaxed text-muted">{T("description")}</p>}
          <CtaRow content={c} locale={locale} className="mt-7 justify-center" />
        </Reveal>
      );

    case "spacer":
      // The padding IS the section; there is nothing to draw.
      return <div aria-hidden style={{ height: 0 }} />;

    case "divider":
      return (
        <div className="cms-in">
          <hr className="border-0 border-t border-line" />
        </div>
      );

    /* ── TEXT ───────────────────────────────────────────────────────────── */

    case "text":
      return (
        <Reveal className="cms-center-x max-w-3xl">
          {T("title") && <SectionHeading>{T("title")}</SectionHeading>}
          {paragraphs(T("description")).map((p, i) => (
            <p key={i} className={`text-[15px] leading-relaxed text-muted sm:text-base ${i === 0 ? "mt-4" : "mt-3"}`}>{p}</p>
          ))}
        </Reveal>
      );

    case "rich_text":
    case "legal": {
      // Authored markup when there is any, the plain paragraphs the old
      // `legal` sections already hold when there is not. Both are sanitised.
      const html = sanitizeRichText(lt(c.html, locale));
      return (
        <div className="cms-center-x max-w-3xl">
          {T("title") && <SectionHeading>{T("title")}</SectionHeading>}
          {html ? (
            <div className="cms-rt mt-4" dangerouslySetInnerHTML={{ __html: anchorHeadings(html) }} />
          ) : (
            <div className="cms-rt mt-4">
              {paragraphs(T("description")).map((p, i) => <p key={i}>{p}</p>)}
            </div>
          )}
        </div>
      );
    }

    case "faq":
      return (
        <>
          <Reveal><SectionHeading>{T("title")}</SectionHeading></Reveal>
          <div className="mx-auto mt-8 max-w-3xl space-y-3">
            {items.map((it, i) => (
              <details key={i} className="group rounded-2xl border border-line bg-surface px-5 py-4 text-left transition-colors open:border-accent/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold">
                  {lt(it.title, locale)}
                  <span aria-hidden className="shrink-0 text-accent transition-transform group-open:rotate-45">+</span>
                </summary>
                {it.description && (
                  <p className="mt-3 text-sm leading-relaxed text-muted">{lt(it.description, locale)}</p>
                )}
              </details>
            ))}
          </div>
        </>
      );

    case "stats":
      return (
        <div className="cms-grid" style={{ "--cms-cols": String(items.length || 4) } as React.CSSProperties}>
          {items.map((it, i) => (
            <Reveal key={i} delay={i * 70}>
              <div className="rounded-2xl border border-line bg-surface p-6 text-center">
                <p className="font-display text-[clamp(1.75rem,4vw,2.75rem)] font-semibold leading-none text-accent">{it.value}</p>
                <p className="mt-2 text-[13px] text-muted">{lt(it.title, locale)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      );

    /* ── MEDIA ──────────────────────────────────────────────────────────── */

    case "media": {
      const video = c.mediaUrl ? videoEmbedUrl(c.mediaUrl) : null;
      if (!video && !safeUrl(c.mediaUrl)) return null;
      return (
        <Reveal>
          <figure className="mx-auto max-w-5xl">
            {video ? (
              <LazyVideo embed={video} posterUrl={safeUrl(c.posterUrl)} label={t("cms.video")} />
            ) : (
              <div className="overflow-hidden rounded-3xl border border-line">
                <CmsImage url={c.mediaUrl} alt={T("alt")} meta={img(c.mediaUrl)}
                  aspect="16 / 9" sizes="(max-width: 1023px) 100vw, 1024px"
                  className="h-full w-full object-cover" />
              </div>
            )}
            {(T("title") || T("description")) && (
              <figcaption className="mt-4 text-center">
                {T("title") && <p className="font-display text-base font-semibold">{T("title")}</p>}
                {T("description") && <p className="mt-1.5 text-sm text-muted">{T("description")}</p>}
              </figcaption>
            )}
          </figure>
        </Reveal>
      );
    }

    case "video":
      return (
        <>
          {T("title") && <Reveal><SectionHeading>{T("title")}</SectionHeading></Reveal>}
          {T("subtitle") && <p className="mt-2 max-w-2xl text-sm text-muted">{T("subtitle")}</p>}
          <Reveal className="mt-8">
            <LazyVideo embed={c.mediaUrl ? videoEmbedUrl(c.mediaUrl) : null}
              posterUrl={safeUrl(c.posterUrl)} label={t("cms.video")} />
          </Reveal>
          {items.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {items.slice(0, 3).map((it, i) => (
                <LazyVideo key={i} embed={it.url ? videoEmbedUrl(it.url) : null}
                  posterUrl={safeUrl(it.mediaUrl)} label={t("cms.video")} />
              ))}
            </div>
          )}
        </>
      );

    case "gallery":
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <div className="cms-grid mt-8">
            {items.map((it, i) => (
              <Reveal key={i} delay={(i % 4) * 60}>
                <figure className="group overflow-hidden rounded-2xl border border-line bg-raised">
                  <CmsImage url={it.mediaUrl} alt={lt(it.alt, locale) || lt(it.title, locale)}
                    meta={img(it.mediaUrl)} aspect="4 / 5" sizes="(max-width: 639px) 100vw, 25vw"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  {lt(it.title, locale) && (
                    <figcaption className="px-3 py-2.5 text-[12.5px] font-medium">{lt(it.title, locale)}</figcaption>
                  )}
                </figure>
              </Reveal>
            ))}
          </div>
        </>
      );

    case "showcase":
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <div className="cms-grid mt-8" style={{ "--cms-cols": "6" } as React.CSSProperties}>
            {items.map((it, i) => (
              <Reveal key={i} delay={i * 50}>
                <div className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent/15 via-raised to-accent2/10">
                  {it.mediaUrl ? (
                    <CmsImage url={it.mediaUrl} alt={lt(it.alt, locale) || lt(it.title, locale)}
                      meta={img(it.mediaUrl)} aspect="4 / 5" sizes="(max-width: 639px) 50vw, 17vw"
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
                  ) : (
                    <div aria-hidden className="absolute inset-x-6 bottom-8 top-10 rounded-xl bg-gradient-to-b from-line/40 to-transparent" />
                  )}
                  {lt(it.title, locale) && (
                    <span className="absolute bottom-2.5 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">
                      {lt(it.title, locale)}
                    </span>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </>
      );

    case "before_after":
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <Reveal className="mt-8">
            <BeforeAfter beforeUrl={safeUrl(c.mediaUrl)} afterUrl={safeUrl(c.media2Url)}
              beforeLabel={t("landing.before")} afterLabel={t("landing.after")} />
          </Reveal>
        </>
      );

    case "logo_cloud":
      return (
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 opacity-70">
          {items.map((it, i) => (
            <div key={i} className="flex h-8 items-center">
              {it.mediaUrl ? (
                <CmsImage url={it.mediaUrl} alt={lt(it.title, locale)} meta={img(it.mediaUrl)}
                  className="max-h-8 w-auto object-contain" />
              ) : (
                <span className="text-sm font-semibold text-faint">{lt(it.title, locale)}</span>
              )}
            </div>
          ))}
        </div>
      );

    /* ── GRIDS ──────────────────────────────────────────────────────────── */

    case "features":
    case "benefits":
    case "cards":
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <div className="cms-grid mt-8">
            {items.map((it, i) => (
              <Reveal key={i} delay={(i % 3) * 70}>
                <Card item={it} locale={locale} media={ctx.media} plain={block.type === "features"} />
              </Reveal>
            ))}
          </div>
        </>
      );

    case "workflow":
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <ol className="cms-grid mt-8">
            {items.map((it, i) => (
              <Reveal key={i} delay={i * 90}>
                <li className="h-full list-none rounded-2xl border border-line bg-surface p-6">
                  <span aria-hidden className="font-display text-3xl font-bold text-accent/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-2 font-display text-base font-semibold">{lt(it.title, locale)}</p>
                  {it.description && <p className="mt-1.5 text-sm leading-relaxed text-muted">{lt(it.description, locale)}</p>}
                </li>
              </Reveal>
            ))}
          </ol>
        </>
      );

    case "use_cases":
      return (
        <>
          {T("title") && <Reveal><SectionHeading>{T("title")}</SectionHeading></Reveal>}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {items.map((it, i) => (
              <span key={i} className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink">
                {lt(it.title, locale)}
              </span>
            ))}
          </div>
        </>
      );

    case "testimonials":
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <div className="cms-grid mt-8">
            {items.map((it, i) => (
              <Reveal key={i} delay={(i % 3) * 70}>
                <figure className="flex h-full flex-col rounded-2xl border border-line bg-surface p-6">
                  <Quote aria-hidden size={20} className="text-accent/50" />
                  <blockquote className="mt-3 flex-1 text-[15px] leading-relaxed text-muted">
                    {lt(it.description, locale)}
                  </blockquote>
                  <figcaption className="mt-5 flex items-center gap-3">
                    {it.mediaUrl && (
                      <CmsImage url={it.mediaUrl} alt="" meta={img(it.mediaUrl)}
                        className="h-9 w-9 rounded-full object-cover" />
                    )}
                    <span>
                      <span className="block text-[13.5px] font-semibold">{lt(it.title, locale)}</span>
                      {it.value && <span className="block text-[12px] text-faint">{it.value}</span>}
                    </span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </>
      );

    case "comparison":
      // title = what is being compared, description = us, value = them.
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <Reveal className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-3 pr-4 font-medium text-muted">{t("cms.compareFeature")}</th>
                  <th scope="col" className="py-3 pr-4 font-semibold text-accent">{lt(c.ctaLabel, locale) || "GrovBase"}</th>
                  <th scope="col" className="py-3 font-medium text-muted">{lt(c.cta2Label, locale) || t("cms.compareOther")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-line/70">
                    <th scope="row" className="py-3 pr-4 font-normal">{lt(it.title, locale)}</th>
                    <td className="py-3 pr-4 font-medium">
                      <Mark on={lt(it.description, locale)} />
                    </td>
                    <td className="py-3 text-muted"><Mark on={it.value ?? ""} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>
        </>
      );

    case "product_lock":
      return (
        <Reveal>
          <div className="rounded-3xl border border-line bg-surface p-8 sm:p-10">
            {T("badge") && (
              <p className="mb-5 inline-block font-display text-xs uppercase tracking-[0.2em] text-accent">{T("badge")}</p>
            )}
            <SectionHeading>{T("title")}</SectionHeading>
            {T("description") && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{T("description")}</p>}
            <div className="mt-6 flex flex-wrap gap-2.5">
              {items.map((it, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
                  <Check size={14} aria-hidden />{lt(it.title, locale)}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      );

    case "text_image": {
      const right = c.alignment !== "left";
      return (
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal className={right ? "" : "lg:order-2"}>
            <SectionHeading>{T("title")}</SectionHeading>
            {T("description") && <p className="mt-3 text-[15px] leading-relaxed text-muted sm:text-base">{T("description")}</p>}
            <CtaRow content={c} locale={locale} className="mt-6" />
          </Reveal>
          <Reveal className={right ? "lg:order-2" : ""}>
            <div className="overflow-hidden rounded-3xl border border-line">
              <CmsImage url={c.mediaUrl} alt={T("alt") || T("title")} meta={img(c.mediaUrl)}
                aspect="16 / 10" sizes="(max-width: 1023px) 100vw, 50vw"
                className="h-full w-full object-cover" />
            </div>
          </Reveal>
        </div>
      );
    }

    /* ── LIVE PRODUCT DATA ──────────────────────────────────────────────── */

    case "tools_grid": {
      const wanted = new Set(c.filter ?? []);
      const tools = ctx.data.tools.filter((tool) => wanted.size === 0 || wanted.has(tool.group));
      if (tools.length === 0) return null;
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <div className="cms-grid mt-8">
            {tools.map((tool) => (
              <Link key={tool.key} href={tool.href}
                className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-accent/35">
                <span className="flex items-center gap-2">
                  <span className="text-[14.5px] font-semibold">{t(tool.nameKey)}</span>
                  {tool.status !== "ACTIVE" && (
                    <span className="rounded-full bg-raised px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
                      {t(tool.status === "COMING_SOON" ? "cms.soon" : "cms.maintenance")}
                    </span>
                  )}
                </span>
                <span className="mt-auto pt-4 text-[12.5px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                  {t("cms.open")} →
                </span>
              </Link>
            ))}
          </div>
        </>
      );
    }

    case "models": {
      const models = ctx.data.models;
      if (models.length === 0) return null;
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <div className="cms-grid mt-8">
            {models.map((m) => (
              <div key={m.id} className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[14.5px] font-semibold">{m.name}</span>
                  {m.badge && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-accent">
                      {m.badge}
                    </span>
                  )}
                </span>
                {m.description && <p className="mt-2 text-[13px] leading-relaxed text-muted">{m.description}</p>}
              </div>
            ))}
          </div>
        </>
      );
    }

    case "pricing_table":
    case "pricing": {
      const plans = ctx.data.plans;
      if (plans.length === 0) return null;
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <div className="cms-grid mt-8" style={{ "--cms-cols": String(Math.min(plans.length, 4)) } as React.CSSProperties}>
            {plans.map((p) => (
              <div key={p.slug}
                className={`relative flex h-full flex-col rounded-2xl border bg-surface p-6 text-left ${p.featured ? "border-accent2 shadow-lg" : "border-line"}`}>
                {p.featured && (
                  <span className="brand-gradient absolute -top-2.5 left-5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    ★ {t("plan.recommended")}
                  </span>
                )}
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="mt-2 font-display text-[1.9rem] font-semibold leading-none tracking-tight">
                  {p.priceCents === 0 ? "0 zł" : formatPrice(p.priceCents, p.currency)}
                </p>
                <p className="mt-1.5 text-xs text-muted">{t("plan.creditsMo", { n: formatCredits(p.monthlyCredits) })}</p>
                {p.description && <p className="mt-3 text-[13px] leading-relaxed text-muted">{p.description}</p>}
                {p.features.length > 0 && (
                  <ul className="mt-4 space-y-1.5 text-[13px] text-muted">
                    {p.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check size={14} aria-hidden className="mt-0.5 shrink-0 text-accent" />{f}
                      </li>
                    ))}
                  </ul>
                )}
                {c.ctaUrl && lt(c.ctaLabel, locale) && (
                  <Link href={c.ctaUrl}
                    className={`mt-6 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-opacity ${p.featured ? "brand-gradient text-white hover:opacity-90" : "border border-line hover:bg-raised"}`}>
                    {lt(c.ctaLabel, locale)}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </>
      );
    }

    /* ── FORMS AND CONTACT ──────────────────────────────────────────────── */

    case "contact":
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <Reveal className="mt-8">
            <dl className="mx-auto max-w-2xl divide-y divide-line rounded-2xl border border-line bg-surface">
              {items.map((it, i) => {
                const href = safeUrl(it.url) ?? mailOrTel(it.url);
                const value = lt(it.description, locale);
                return (
                  <div key={i} className="flex min-h-[44px] flex-col justify-center gap-0.5 px-5 py-3.5 text-left sm:flex-row sm:items-center sm:gap-6">
                    <dt className="text-sm text-muted sm:w-40 sm:shrink-0">{lt(it.title, locale)}</dt>
                    <dd className="min-w-0 break-words text-sm font-medium">
                      {href ? (
                        <a href={href} rel="noreferrer" className="text-accent underline-offset-4 transition-colors hover:underline">
                          {value || href}
                        </a>
                      ) : value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Reveal>
        </>
      );

    case "contact_form":
    case "newsletter":
      return (
        <>
          <Heading title={T("title")} body={T("description")} />
          <div className="mx-auto mt-8 max-w-xl text-left">
            <CmsForm
              kind={block.type === "newsletter" ? "newsletter" : "contact"}
              handler={c.formHandler}
              submitLabel={lt(c.ctaLabel, locale) || t(block.type === "newsletter" ? "cms.formSubscribe" : "cms.formSend")}
              consent={lt(c.subtitle, locale)}
              labels={{
                name: t("cms.formName"), email: t("cms.formEmail"), topic: t("cms.formTopic"),
                message: t("cms.formMessage"), sending: t("common.loading"),
                ok: t("cms.formOk"), error: t("cms.formError"), required: t("cms.formRequired"),
              }}
              topics={items.map((it) => ({ value: it.value ?? "", label: lt(it.title, locale) }))
                .filter((o) => o.value && o.label)}
            />
          </div>
        </>
      );

    /* ── CODE ───────────────────────────────────────────────────────────── */

    case "custom_code":
      return (
        <CustomBlock
          code={block.code}
          sectionId={block.id ?? `s${block.sort_order}`}
          admin={ctx.admin}
          label={{
            title: t("cms.sectionError"),
            body: t("cms.sectionErrorBody"),
            frame: T("title") || t("cms.sectionType.custom_code"),
          }}
        />
      );

    default:
      return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────
   SHARED PIECES
   ──────────────────────────────────────────────────────────────────────── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-[clamp(1.4rem,3.2vw,2.25rem)] font-semibold leading-tight tracking-tight">
      {children}
    </h2>
  );
}

function Heading({ title, body }: { title: string; body: string }) {
  if (!title && !body) return null;
  return (
    <Reveal className="cms-center-x max-w-2xl">
      {title && <SectionHeading>{title}</SectionHeading>}
      {body && <p className="mt-3 text-[15px] leading-relaxed text-muted">{body}</p>}
    </Reveal>
  );
}

/** The one/two-button row every call to action uses, so a CTA looks the same
 *  in a hero, a text+image and a closing section. */
function CtaRow({ content, locale, className }: {
  content: CmsBlockContent; locale: string; className?: string;
}) {
  const label = lt(content.ctaLabel, locale);
  const label2 = lt(content.cta2Label, locale);
  const href = internalOrHttps(content.ctaUrl);
  const href2 = internalOrHttps(content.cta2Url);
  if (!(label && href) && !(label2 && href2)) return null;
  return (
    <div className={`flex flex-wrap gap-3 ${className ?? ""}`}>
      {label && href && (
        <Link href={href} className="brand-gradient rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
          {label}
        </Link>
      )}
      {label2 && href2 && (
        <Link href={href2} className="rounded-xl border border-line bg-surface px-6 py-3 text-sm font-semibold transition-colors hover:bg-raised">
          {label2}
        </Link>
      )}
    </div>
  );
}

function Card({ item, locale, media, plain }: {
  item: CmsItem; locale: string; media: MediaIndex; plain: boolean;
}) {
  const Icon = cmsIcon(item.icon);
  const href = internalOrHttps(item.url);
  const inner = (
    <>
      {item.mediaUrl && (
        <div className="mb-4 overflow-hidden rounded-xl">
          <CmsImage url={item.mediaUrl} alt={lt(item.alt, locale) || lt(item.title, locale)}
            meta={metaFor(media, item.mediaUrl)} aspect="16 / 10" sizes="(max-width: 639px) 100vw, 33vw"
            className="h-full w-full object-cover" />
        </div>
      )}
      {!item.mediaUrl && !plain && (
        <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {Icon ? <Icon size={19} /> : <Check size={19} />}
        </span>
      )}
      <span className="mt-4 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[14.5px] font-semibold">{lt(item.title, locale)}</h3>
        {lt(item.badge, locale) && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-accent">
            {lt(item.badge, locale)}
          </span>
        )}
      </span>
      {item.description && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{lt(item.description, locale)}</p>
      )}
    </>
  );
  const className = "flex h-full flex-col rounded-2xl border border-line bg-surface p-5 text-left transition-colors hover:border-accent/30";
  return href ? <Link href={href} className={className}>{inner}</Link> : <div className={className}>{inner}</div>;
}

/** A comparison cell: a tick, a dash, or the words the admin typed. */
function Mark({ on }: { on: string }) {
  const value = on.trim().toLowerCase();
  if (value === "tak" || value === "yes" || value === "ja" || value === "+") {
    return <Check size={16} aria-hidden className="text-accent" />;
  }
  if (value === "nie" || value === "no" || value === "nein" || value === "-" || value === "") {
    return <Minus size={16} aria-hidden className="text-faint" />;
  }
  return <>{on}</>;
}

/** A blank line is the only formatting a plain textarea offers, so it is what
 *  decides where one paragraph ends — otherwise long copy is one grey blob. */
function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/** A CTA may point inside the app (/register, #cennik) or at an https URL.
 *  Anything else — including http and javascript: — is not a link. */
function internalOrHttps(url: string | undefined): string | null {
  const value = (url ?? "").trim();
  if (!value) return null;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  return safeUrl(value);
}

/** Contact rows are allowed the two schemes a contact row is for. */
function mailOrTel(url: string | undefined): string | null {
  const value = (url ?? "").trim();
  return /^(mailto:[^\s]+@[^\s]+|tel:\+?[0-9\s-]+)$/i.test(value) ? value : null;
}

/**
 * Give every heading in a legal document an id, so the table of contents can
 * link to it. The ids come from a counter rather than from the heading text:
 * a slug built from Polish headings collides more often than it looks, and a
 * ToC that jumps to the wrong clause is worse than one that shows nothing.
 */
export function anchorHeadings(html: string): string {
  let n = 0;
  return html.replace(/<h2(\s[^>]*)?>/gi, (match, attrs: string | undefined) => {
    n += 1;
    if (attrs && /\sid=/.test(attrs)) return match;
    return `<h2${attrs ?? ""} id="sek-${n}">`;
  });
}

/** The headings of a sanitised document, in order — the table of contents. */
export function headingsOf(html: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const re = /<h2[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = m[2].replace(/<[^>]*>/g, "").trim();
    if (text) out.push({ id: m[1], text });
  }
  return out;
}

/** Sanitised rich text for a block, ready for both the renderer and the ToC. */
export function legalHtml(block: CmsBlock, locale: string): string {
  return anchorHeadings(sanitizeRichText(lt(block.content?.html, locale)));
}

/** Re-exported so callers that only need the allowlist do not reach past this
 *  module into the sanitiser. */
export { sanitizeHtml };

/** Stylised dashboard mock-up used when a hero has no media configured. */
function HeroMockup() {
  return (
    <div aria-hidden className="select-none rounded-3xl border border-line bg-surface p-4 shadow-2xl">
      <div className="flex items-center gap-1.5 pb-3">
        <span className="h-2.5 w-2.5 rounded-full bg-faint/50" />
        <span className="h-2.5 w-2.5 rounded-full bg-faint/35" />
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
  );
}
