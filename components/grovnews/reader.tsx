import Link from "next/link";
import {
  ArrowLeft, ArrowRight, BellRing, CalendarDays, Check, ChevronRight, Clock, ExternalLink, Layers, Newspaper, Star,
} from "lucide-react";
import { parseContent, type Block, type Inline } from "@/lib/grovnews";
import { editionDateLabel, warsawDate } from "@/lib/grovnews-research";
import type { Article, CategoryRow, CurrentEdition, FeedPost } from "@/lib/services/grovnews";
import { cn } from "@/lib/utils";

/**
 * GROVNEWS — THE READER. Server components only: nothing here runs in the
 * browser, and the article body is React-rendered text (lib/grovnews.ts
 * `parseContent`), never HTML, so no stored content can execute anything.
 *
 * Whether any of this renders is decided BEFORE it is reached — the pages ask
 * the database for an active entitlement and render <GrovNewsLocked> instead,
 * without fetching a single post. RLS would return nothing anyway.
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

export function formatNewsDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Warsaw" });
}

/** The cover, or a quiet brand ground where there is none — never a hole. */
function Cover({ url, className, eager = false }: { url: string | null; className?: string; eager?: boolean }) {
  return (
    <span className={cn("relative block overflow-hidden bg-sunken", className)}>
      {url ? (
        // External and bucket URLs alike; next/image would need every host
        // whitelisted in next.config, which this module does not touch.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading={eager ? "eager" : "lazy"} decoding="async"
          className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center" style={{
          background: "radial-gradient(120% 90% at 80% 10%, rgb(var(--accent) / 0.30), transparent 60%),"
            + "radial-gradient(90% 80% at 10% 100%, rgb(var(--violet) / 0.26), transparent 65%), rgb(var(--sunken))",
        }}>
          <Newspaper size={28} className="text-[rgb(var(--ink)/0.35)]" />
        </span>
      )}
    </span>
  );
}

function CategoryChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full truncate rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-accent">
      {name}
    </span>
  );
}

function Meta({ publishedAt, minutes, locale, t }: { publishedAt: string | null; minutes: number; locale: string; t: T }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
      {publishedAt && <time dateTime={publishedAt}>{formatNewsDate(publishedAt, locale)}</time>}
      {publishedAt && <span aria-hidden>·</span>}
      <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden />{t("grovnews.readTime", { n: minutes })}</span>
    </span>
  );
}

/* ── the category filter ───────────────────────────────────────────────────── */

/** Chips from the ACTIVE categories in the database (never a list in code).
 *  Plain links (`?category=<slug>`): the server filters, the browser needs no
 *  script, and the row scrolls sideways inside itself on a phone. */
export function GrovNewsCategoryFilter({ categories, active, t }: {
  categories: readonly Pick<CategoryRow, "slug" | "name">[]; active: string | null; t: T;
}) {
  if (categories.length === 0) return null;
  const chip = (selected: boolean) => cn(
    "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors",
    selected ? "is-selected" : "border-line text-muted hover:bg-raised hover:text-ink",
  );
  return (
    <nav aria-label={t("grovnews.filter.label")} className="mb-4 min-w-0" data-grovnews-filter>
      <ul className="thin-scroll flex min-w-0 gap-1.5 overflow-x-auto pb-1.5">
        <li className="shrink-0">
          <Link href="/grovnews" aria-current={active === null ? "page" : undefined} className={chip(active === null)}>
            {t("grovnews.filter.all")}
          </Link>
        </li>
        {categories.map((c) => (
          <li key={c.slug} className="shrink-0">
            <Link href={`/grovnews?category=${encodeURIComponent(c.slug)}`} data-grovnews-category={c.slug}
              aria-current={active === c.slug ? "page" : undefined} className={chip(active === c.slug)}>
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ── the feed ──────────────────────────────────────────────────────────────── */

/** Nothing published yet: what this page will hold, not a big empty box. */
function FirstEditionPending({ t }: { t: T }) {
  const points = [
    { key: "edition", icon: CalendarDays },
    { key: "categories", icon: Layers },
    { key: "digest", icon: BellRing },
  ] as const;
  return (
    <div className="panel relative overflow-hidden rounded-2xl p-5 sm:p-6" data-grovnews-empty>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(24rem 7rem at 0% -20%, rgb(var(--accent) / 0.14), transparent 70%)" }} />
      <div className="relative flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Newspaper size={19} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-display text-[17px] font-semibold leading-snug tracking-tight text-ink">{t("grovnews.empty.title")}</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{t("grovnews.empty.body")}</p>
        </div>
      </div>
      <ul className="relative mt-4 grid gap-2 sm:grid-cols-3">
        {points.map(({ key, icon: Icon }) => (
          <li key={key} className="flex min-w-0 items-start gap-2 rounded-xl bg-[rgb(var(--ink)/0.04)] px-3 py-2.5 text-[12.5px] leading-snug text-muted">
            <Icon size={15} aria-hidden className="mt-0.5 shrink-0 text-accent" />
            <span className="min-w-0">{t(`grovnews.empty.points.${key}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GrovNewsFeed({ posts, locale, t, filtered = false }: {
  posts: FeedPost[]; locale: string; t: T;
  /** A category is selected — an empty list then means "none in this one". */
  filtered?: boolean;
}) {
  if (posts.length === 0) {
    if (!filtered) return <FirstEditionPending t={t} />;
    return (
      <div className="panel rounded-2xl px-5 py-8 text-center" data-grovnews-empty="category">
        <p className="text-[15px] font-semibold text-ink">{t("grovnews.empty.categoryTitle")}</p>
        <p className="mt-1 text-[13.5px] text-muted">{t("grovnews.empty.categoryBody")}</p>
        <Link href="/grovnews" className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-line px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-raised">
          {t("grovnews.filter.all")}
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3" data-grovnews-feed>
      {posts.map((p, i) => (
        <li key={p.id} className="min-w-0">
          <Link href={`/grovnews/${p.slug}`} data-grovnews-card={p.slug}
            className="group panel flex h-full min-w-0 flex-col overflow-hidden rounded-2xl transition-colors duration-200 hover:border-[rgb(var(--accent)/0.4)]">
            {p.coverUrl && <Cover url={p.coverUrl} className="aspect-[16/9]" eager={i < 3} />}
            <span className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:p-5">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {p.category && <CategoryChip name={p.category.name} />}
                {p.publishedAt && (
                  <time dateTime={p.publishedAt} className="text-[12px] text-faint">{formatNewsDate(p.publishedAt, locale)}</time>
                )}
              </span>
              <span className="break-words font-display text-[17px] font-semibold leading-snug tracking-tight text-ink group-hover:text-accent">
                {p.title}
              </span>
              {p.excerpt && <span className="line-clamp-3 break-words text-[13.5px] leading-relaxed text-muted">{p.excerpt}</span>}
              <span className="mt-auto flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-3 text-[12px] text-faint">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden />{t("grovnews.readTime", { n: p.readMinutes })}</span>
                  {p.sourcesCount > 0 && (
                    <><span aria-hidden>·</span><span data-grovnews-card-sources>{t("grovnews.card.sources", { n: p.sourcesCount })}</span></>
                  )}
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-accent">
                  {t("grovnews.card.read")}<ArrowRight size={13} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── the day's edition ─────────────────────────────────────────────────────── */

/**
 * The latest published edition, above the feed — the page's hero. The daily
 * edition carries ONE article (0125): its lead and a "read" button. An older
 * multi-post edition lists its posts in the editor's order. The intro is plain
 * text (React escapes it), never HTML. "Today" is decided on the Warsaw
 * calendar, the same key editions use; dates are numeric (DD.MM.YYYY), so
 * `locale` is taken only for symmetry with the feed.
 */
export function GrovNewsEditionBox({ edition, t }: { edition: CurrentEdition; locale: string; t: T }) {
  const today = edition.date === warsawDate();
  const single = edition.posts.length === 1 ? edition.posts[0] : null;
  return (
    <section aria-labelledby="grovnews-edition" data-grovnews-edition-box={edition.date}
      className="panel relative mb-5 min-w-0 overflow-hidden rounded-3xl p-5 sm:p-7">
      <span aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(34rem 12rem at 0% -10%, rgb(var(--accent) / 0.18), transparent 70%),"
          + "radial-gradient(26rem 12rem at 100% 110%, rgb(var(--violet) / 0.14), transparent 70%)" }} />
      <div className="relative min-w-0">
        <p className="overline inline-flex items-center gap-1.5">
          <CalendarDays size={13} aria-hidden />
          {today ? t("grovnews.edition.today") : t("grovnews.edition.from", { date: editionDateLabel(edition.date) })}
        </p>
        <h2 id="grovnews-edition" className="mt-2 break-words font-display text-[clamp(1.35rem,1.1rem+1.2vw,1.9rem)] font-bold leading-tight tracking-tight">
          {edition.title}
        </h2>
        {edition.intro && (
          <p className="mt-2 max-w-2xl whitespace-pre-line break-words text-[14.5px] leading-relaxed text-muted">{edition.intro}</p>
        )}
        {single ? (
          <div className="mt-4 min-w-0">
            {single.excerpt && single.excerpt !== edition.intro && (
              <p className="line-clamp-3 max-w-2xl break-words text-[14px] leading-relaxed text-muted">{single.excerpt}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link href={`/grovnews/${single.slug}`} data-grovnews-edition-post={single.slug}
                className="cta inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-semibold">
                {t("grovnews.edition.cta")}<ArrowRight size={15} aria-hidden />
              </Link>
              <span className="inline-flex items-center gap-1 text-[12.5px] text-faint">
                <Clock size={12} aria-hidden />{t("grovnews.readTime", { n: single.readMinutes })}
              </span>
            </div>
          </div>
        ) : (
          <ol className="mt-4 divide-y divide-line border-t border-line">
            {edition.posts.map((p) => (
              <li key={p.id} className="min-w-0">
                <Link href={`/grovnews/${p.slug}`} data-grovnews-edition-post={p.slug}
                  className="group flex min-w-0 items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      {p.featured && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-accent">
                          <Star size={11} aria-hidden />{t("grovnews.edition.featured")}
                        </span>
                      )}
                      <span className="min-w-0 break-words text-[14.5px] font-semibold leading-snug text-ink group-hover:text-accent">{p.title}</span>
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-faint">
                      <Clock size={12} aria-hidden />{t("grovnews.readTime", { n: p.readMinutes })}
                    </span>
                  </span>
                  <ChevronRight size={16} aria-hidden className="shrink-0 text-faint group-hover:text-accent" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/* ── one article ───────────────────────────────────────────────────────────── */

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => p.kind === "bold"
        ? <strong key={i} className="font-semibold text-ink">{p.text}</strong>
        : p.kind === "link"
          ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow"
              className="font-medium text-accent underline decoration-[rgb(var(--accent)/0.4)] underline-offset-2 hover:decoration-accent">{p.text}</a>
          : <span key={i}>{p.text}</span>)}
    </>
  );
}

/** "## 3. Title" → 3: the daily article's numbered topic headings (built by
 *  lib/server/grovnews/daily.ts `topicSection`). The mail's "read more" links
 *  point at `#t3`, so the number — not the title — makes the anchor stable. */
export function topicAnchor(inline: readonly Inline[]): string | null {
  const first = inline[0];
  const m = first && first.kind !== "link" ? /^\s*(\d{1,2})\.\s/.exec(first.text) : null;
  return m ? `t${Number(m[1])}` : null;
}

export function ContentBlocks({ blocks }: { blocks: Block[] }) {
  const used = new Set<string>();
  return (
    <div className="space-y-4 text-[15.5px] leading-[1.75] text-[rgb(var(--ink)/0.88)]" data-grovnews-content>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h2": {
            const anchor = topicAnchor(b.inline);
            const id = anchor && !used.has(anchor) ? anchor : undefined;
            if (id) used.add(id);
            return (
              <h2 key={i} id={id} className="scroll-mt-24 break-words pt-3 font-display text-[21px] font-semibold leading-snug tracking-tight text-ink">
                <InlineText parts={b.inline} />
              </h2>
            );
          }
          case "h3": return <h3 key={i} className="break-words pt-2 text-[17px] font-semibold leading-snug text-ink"><InlineText parts={b.inline} /></h3>;
          // Quotes carry the backend's short "Oryginał" excerpt and its
          // "Tłumaczenie PL": a quiet card, readable, never a wall of italics.
          case "quote": return (
            <blockquote key={i} data-grovnews-quote
              className="break-words rounded-r-xl border-l-[3px] border-[rgb(var(--accent)/0.6)] bg-[rgb(var(--ink)/0.04)] px-4 py-3 text-[14.5px] leading-relaxed text-muted">
              <InlineText parts={b.inline} />
            </blockquote>
          );
          case "list": return (
            <ul key={i} className="list-disc space-y-1.5 break-words pl-5 marker:text-accent">
              {b.items.map((item, j) => <li key={j}><InlineText parts={item} /></li>)}
            </ul>
          );
          default: return <p key={i} className="break-words"><InlineText parts={b.inline} /></p>;
        }
      })}
    </div>
  );
}

export function GrovNewsArticle({ article, locale, t, backHref = "/grovnews" }: {
  article: Pick<Article, "title" | "excerpt" | "content" | "coverUrl" | "publishedAt" | "readMinutes" | "category" | "sources" | "tags">;
  locale: string; t: T; backHref?: string;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl" data-grovnews-article>
      <Link href={backHref} className="mb-5 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-ink">
        <ArrowLeft size={15} aria-hidden />{t("grovnews.back")}
      </Link>
      <header>
        {article.category && <CategoryChip name={article.category.name} />}
        <h1 className="mt-3 break-words font-display text-[clamp(1.6rem,1.2rem+1.8vw,2.4rem)] font-bold leading-[1.15] tracking-tight">
          {article.title}
        </h1>
        {article.excerpt && <p className="mt-3 text-[16.5px] leading-relaxed text-muted">{article.excerpt}</p>}
        <div className="mt-3"><Meta publishedAt={article.publishedAt} minutes={article.readMinutes} locale={locale} t={t} /></div>
      </header>
      {article.coverUrl && <Cover url={article.coverUrl} eager className="mt-6 aspect-[16/9] rounded-2xl" />}
      <div className="mt-7"><ContentBlocks blocks={parseContent(article.content)} /></div>
      {article.sources.length > 0 && (
        <section className="mt-10 border-t border-line pt-6" aria-labelledby="grovnews-sources" data-grovnews-sources>
          <h2 id="grovnews-sources" className="overline mb-3">{t("grovnews.sources")}</h2>
          <ul className="space-y-2">
            {article.sources.map((s) => (
              <li key={s.url} className="min-w-0">
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow"
                  className="inline-flex max-w-full items-start gap-1.5 text-[13.5px] text-accent hover:underline">
                  <ExternalLink size={13} aria-hidden className="mt-1 shrink-0" />
                  <span className="break-all">{s.title ?? s.url}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {article.tags.length > 0 && (
        <p className="mt-6 flex flex-wrap gap-1.5">
          {article.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-line px-2 py-0.5 text-[11.5px] text-muted">#{tag}</span>
          ))}
        </p>
      )}
    </article>
  );
}

/* ── no access ─────────────────────────────────────────────────────────────── */

const HERO_POINTS = ["marketplace", "ai", "law", "trade", "digest"] as const;

/** What a customer without access sees — and ALL they see: no title, no
 *  excerpt, no count of what is behind the door. With GrovNews Premium on
 *  sale, the price (formatted on the server from the admin-set,
 *  Stripe-confirmed amount) and the way in: the EXISTING checkout, which
 *  itself refuses a second subscription and resumes one in progress. A
 *  subscription whose payment failed gets the way to fix it instead of a
 *  second purchase. Sales off → an honest "soon". */
export function GrovNewsLocked({ t, offer = null, manage = false }: {
  t: T; offer?: { price: string } | null; manage?: boolean;
}) {
  return (
    <div className="py-2 sm:py-6" data-grovnews-locked>
      <section className="panel relative mx-auto w-full max-w-4xl overflow-hidden rounded-3xl p-5 sm:p-8 lg:p-10">
        <span aria-hidden className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(36rem 14rem at 0% -10%, rgb(var(--accent) / 0.20), transparent 70%),"
            + "radial-gradient(28rem 14rem at 100% 110%, rgb(var(--violet) / 0.16), transparent 70%)" }} />
        <div className="relative grid min-w-0 gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-center md:gap-8">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-accent">
              <Newspaper size={13} aria-hidden />{t("grovnews.overline")}
            </p>
            <h1 className="mt-4 font-display text-[clamp(2rem,1.55rem+2.2vw,3rem)] font-bold leading-none tracking-tight">{t("grovnews.title")}</h1>
            <p className="mt-3 max-w-md break-words font-display text-[clamp(1.05rem,0.95rem+0.5vw,1.3rem)] font-semibold leading-snug text-ink">
              {t("grovnews.hero.title")}
            </p>
            <ul className="mt-5 space-y-2.5" data-grovnews-hero-points>
              {HERO_POINTS.map((k) => (
                <li key={k} className="flex min-w-0 items-start gap-2.5 text-[14px] leading-snug text-ink">
                  <span aria-hidden className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--success)/0.16)] text-success">
                    <Check size={13} strokeWidth={2.6} />
                  </span>
                  <span className="min-w-0">{t(`grovnews.hero.points.${k}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 rounded-2xl border border-line bg-[rgb(var(--surface)/0.7)] p-5 sm:p-6">
            {manage ? (
              <div data-grovnews-manage>
                <p className="text-[14px] font-semibold text-ink">{t("grovnews.hero.pastDueTitle")}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("grovnews.billing.pastDue")}</p>
                <Link href="/settings?tab=subscriptions#grovnews" className="cta mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold">
                  {t("grovnews.status.manage")}
                </Link>
              </div>
            ) : offer ? (
              <div data-grovnews-offer>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">{t("grovnews.hero.plan")}</p>
                <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="metric font-display text-[clamp(1.9rem,1.6rem+1vw,2.4rem)] font-bold leading-none text-ink" data-grovnews-price>{offer.price}</span>
                  <span className="text-[13px] text-muted">{t("grovnews.hero.perMonth")}</span>
                </p>
                <Link href="/checkout?kind=grovnews" data-grovnews-buy
                  className="cta mt-5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-semibold">
                  {t("grovnews.hero.cta")}<ArrowRight size={15} aria-hidden />
                </Link>
                <p className="mt-3 text-[12px] leading-relaxed text-faint">{t("grovnews.cancelAnytime")}</p>
              </div>
            ) : (
              <div data-grovnews-soon>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-faint">{t("grovnews.hero.plan")}</p>
                <p className="mt-2 text-[14px] font-semibold text-ink">{t("grovnews.hero.soonTitle")}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t("grovnews.lockedSoon")}</p>
              </div>
            )}
            <Link href="/home" className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl px-4 text-[13px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
              {t("grovnews.lockedBack")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
