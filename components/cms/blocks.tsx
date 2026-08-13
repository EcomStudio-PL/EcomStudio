import Link from "next/link";
import type { CmsBlock, CmsBlockContent } from "@/lib/cms";
import { lt, safeUrl, videoEmbedUrl } from "@/lib/cms";
import { Reveal, BeforeAfter, LazyVideo } from "./widgets";

/** Renders CMS blocks into the premium public site. Structured content
 *  only — all text goes through React escaping, media through URL checks. */
export function BlockRenderer({ blocks, locale, labels }: {
  blocks: CmsBlock[]; locale: string;
  labels: { before: string; after: string; video: string };
}) {
  return (
    <>
      {blocks.filter((b) => b.visible).sort((a, b) => a.sort_order - b.sort_order).map((b, i) => (
        <Block key={i} block={b} locale={locale} labels={labels} />
      ))}
    </>
  );
}

function Media({ url, alt }: { url?: string; alt: string }) {
  const safe = safeUrl(url);
  if (!safe) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={safe} alt={alt} loading="lazy" className="h-full w-full rounded-2xl object-cover" />;
}

function Block({ block, locale, labels }: {
  block: CmsBlock; locale: string; labels: { before: string; after: string; video: string };
}) {
  const c: CmsBlockContent = block.content ?? {};
  const T = (k: keyof CmsBlockContent) => lt(c[k] as never, locale);
  const items = c.items ?? [];

  switch (block.type) {
    case "hero":
      return (
        <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2">
          <div>
            {T("badge") && (
              <p className="mb-6 inline-block font-display text-xs uppercase tracking-[0.2em] text-accent">{T("badge")}</p>
            )}
            <h1 className="max-w-xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{T("title")}</h1>
            {T("subtitle") && <p className="mt-5 max-w-lg text-base text-muted sm:text-lg">{T("subtitle")}</p>}
            <div className="mt-8 flex flex-wrap gap-3">
              {T("ctaLabel") && c.ctaUrl && (
                <Link href={c.ctaUrl} className="brand-gradient rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
                  {T("ctaLabel")}
                </Link>
              )}
              {T("cta2Label") && c.cta2Url && (
                <a href={c.cta2Url} className="rounded-xl border border-line bg-surface px-5 py-3 text-sm font-semibold transition-colors hover:bg-raised">
                  {T("cta2Label")}
                </a>
              )}
            </div>
          </div>
          <Reveal>
            {c.mediaUrl && videoEmbedUrl(c.mediaUrl) ? (
              <LazyVideo embed={videoEmbedUrl(c.mediaUrl)} posterUrl={safeUrl(c.posterUrl)} label={labels.video} />
            ) : c.mediaUrl ? (
              <div className="aspect-video overflow-hidden rounded-2xl border border-line shadow-2xl">
                <Media url={c.mediaUrl} alt={T("title")} />
              </div>
            ) : (
              <HeroMockup />
            )}
          </Reveal>
        </section>
      );

    case "showcase":
      return (
        <section id="showcase" className="scroll-mt-20 py-12">
          <Reveal>
            <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2>
            {T("description") && <p className="mt-2 max-w-xl text-sm text-muted">{T("description")}</p>}
          </Reveal>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {items.map((it, i) => (
              <Reveal key={i} delay={i * 60}>
                <div className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent/15 via-raised to-accent2/10 transition-transform duration-200 hover:-translate-y-1">
                  {it.mediaUrl ? <Media url={it.mediaUrl} alt={lt(it.title, locale)} /> : (
                    <div aria-hidden className="absolute inset-x-6 bottom-8 top-10 rounded-xl bg-gradient-to-b from-line/40 to-transparent" />
                  )}
                  <span className="absolute bottom-2.5 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">
                    {lt(it.title, locale)}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      );

    case "before_after":
      return (
        <section className="py-12">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2>
            {T("description") && <p className="mt-2 max-w-xl text-sm text-muted">{T("description")}</p>}
          </Reveal>
          <Reveal className="mt-8">
            <BeforeAfter beforeUrl={safeUrl(c.mediaUrl)} afterUrl={safeUrl(c.media2Url)}
              beforeLabel={labels.before} afterLabel={labels.after} />
          </Reveal>
        </section>
      );

    case "video":
      return (
        <section className="py-12">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2>
            {T("subtitle") && <p className="mt-2 max-w-xl text-sm text-muted">{T("subtitle")}</p>}
          </Reveal>
          <Reveal className="mt-8">
            <LazyVideo embed={c.mediaUrl ? videoEmbedUrl(c.mediaUrl) : null} posterUrl={safeUrl(c.posterUrl)} label={labels.video} />
          </Reveal>
          {items.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {items.slice(0, 3).map((it, i) => (
                <LazyVideo key={i} embed={it.url ? videoEmbedUrl(it.url) : null} posterUrl={safeUrl(it.mediaUrl)} label={labels.video} />
              ))}
            </div>
          )}
        </section>
      );

    case "product_lock":
      return (
        <section className="py-12">
          <Reveal>
            <div className="panel rounded-2xl p-8 sm:p-10">
              {T("badge") && (
                <p className="mb-5 inline-block font-display text-xs uppercase tracking-[0.2em] text-accent">{T("badge")}</p>
              )}
              <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2>
              {T("description") && <p className="mt-2 max-w-xl text-sm text-muted">{T("description")}</p>}
              <div className="mt-6 flex flex-wrap gap-2.5">
                {items.map((it, i) => (
                  <span key={i} className="rounded-full border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
                    ✓ {lt(it.title, locale)}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </section>
      );

    case "workflow":
      return (
        <section id="how" className="scroll-mt-20 py-12">
          <Reveal><h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2></Reveal>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {items.map((it, i) => (
              <Reveal key={i} delay={i * 100}>
                <div className="panel panel-interactive h-full rounded-2xl p-6">
                  <span className="font-display text-3xl font-bold text-accent/40">0{i + 1}</span>
                  <p className="mt-2 font-display text-base font-semibold">{lt(it.title, locale)}</p>
                  {it.description && <p className="mt-1.5 text-sm text-muted">{lt(it.description, locale)}</p>}
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      );

    case "use_cases":
      return (
        <section className="py-12">
          <Reveal><h2 className="font-display text-xl font-semibold tracking-tight">{T("title")}</h2></Reveal>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {items.map((it, i) => (
              <span key={i} className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-accent/40 hover:text-ink">
                {lt(it.title, locale)}
              </span>
            ))}
          </div>
        </section>
      );

    case "features":
      return (
        <section id="features" className="scroll-mt-20 py-12">
          <Reveal><h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2></Reveal>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <Reveal key={i} delay={(i % 3) * 80}>
                <div className="h-full rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-accent/30">
                  {it.mediaUrl && <div className="mb-3 aspect-video overflow-hidden rounded-xl"><Media url={it.mediaUrl} alt={lt(it.title, locale)} /></div>}
                  <h3 className="font-display text-sm font-semibold">{lt(it.title, locale)}</h3>
                  {it.description && <p className="mt-1.5 text-sm text-muted">{lt(it.description, locale)}</p>}
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      );

    case "stats":
      return (
        <section className="py-12">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {items.map((it, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="panel rounded-2xl p-5 text-center">
                  <p className="font-display text-3xl font-semibold text-accent">{it.value}</p>
                  <p className="mt-1 text-xs text-muted">{lt(it.title, locale)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      );

    case "text_image": {
      const right = c.alignment !== "left";
      return (
        <section className="grid items-center gap-8 py-12 lg:grid-cols-2">
          <Reveal className={right ? "" : "lg:order-2"}>
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2>
            {T("description") && <p className="mt-3 text-sm text-muted sm:text-base">{T("description")}</p>}
            {T("ctaLabel") && c.ctaUrl && (
              <Link href={c.ctaUrl} className="brand-gradient mt-6 inline-flex rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90">
                {T("ctaLabel")}
              </Link>
            )}
          </Reveal>
          <Reveal className={right ? "lg:order-2" : ""}>
            <div className="aspect-video overflow-hidden rounded-2xl border border-line">
              <Media url={c.mediaUrl} alt={T("title")} />
            </div>
          </Reveal>
        </section>
      );
    }

    case "faq":
      return (
        <section id="faq" className="scroll-mt-20 py-12">
          <Reveal><h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2></Reveal>
          <div className="mt-6 space-y-3">
            {items.map((it, i) => (
              <details key={i} className="group rounded-2xl border border-line bg-surface p-5">
                <summary className="cursor-pointer list-none text-sm font-semibold">{lt(it.title, locale)}</summary>
                {it.description && <p className="mt-2 text-sm text-muted">{lt(it.description, locale)}</p>}
              </details>
            ))}
          </div>
        </section>
      );

    case "logo_cloud":
      return (
        <section className="py-10">
          <div className="flex flex-wrap items-center justify-center gap-8 opacity-70">
            {items.map((it, i) => (
              <div key={i} className="h-8">
                {it.mediaUrl ? <Media url={it.mediaUrl} alt={lt(it.title, locale)} /> : (
                  <span className="text-sm font-semibold text-faint">{lt(it.title, locale)}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      );

    case "cta":
      return (
        <section className="py-16 text-center">
          <Reveal>
            <h2 className="mx-auto max-w-xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">{T("title")}</h2>
            {T("ctaLabel") && c.ctaUrl && (
              <Link href={c.ctaUrl} className="brand-gradient mt-6 inline-flex rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90">
                {T("ctaLabel")}
              </Link>
            )}
          </Reveal>
        </section>
      );

    default:
      return null;
  }
}

/** Stylized dashboard mockup used when the hero has no media configured. */
function HeroMockup() {
  return (
    <div aria-hidden className="panel select-none rounded-2xl p-4 shadow-2xl">
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
  );
}
