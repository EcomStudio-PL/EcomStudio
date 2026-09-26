import Link from "next/link";
import { ArrowLeft, ChevronRight, Clock, ExternalLink, Lock, Newspaper, Star } from "lucide-react";
import { parseContent, type Block, type Inline } from "@/lib/grovnews";
import { editionDateLabel, warsawDate } from "@/lib/grovnews-research";
import type { Article, CurrentEdition, FeedPost } from "@/lib/services/grovnews";
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

/* ── the feed ──────────────────────────────────────────────────────────────── */

export function GrovNewsFeed({ posts, locale, t }: { posts: FeedPost[]; locale: string; t: T }) {
  if (posts.length === 0) {
    return (
      <div className="panel rounded-2xl px-6 py-12 text-center" data-grovnews-empty>
        <Newspaper size={28} className="mx-auto text-faint" aria-hidden />
        <p className="mt-3 text-[15px] font-semibold">{t("grovnews.emptyTitle")}</p>
        <p className="mt-1 text-sm text-muted">{t("grovnews.emptyBody")}</p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3" data-grovnews-feed>
      {posts.map((p, i) => (
        <li key={p.id} className="min-w-0">
          <Link href={`/grovnews/${p.slug}`} data-grovnews-card={p.slug}
            className="group panel flex h-full flex-col overflow-hidden rounded-2xl transition-colors duration-200 hover:border-[rgb(var(--accent)/0.4)]">
            <Cover url={p.coverUrl} className="aspect-[16/9]" eager={i < 3} />
            <span className="flex flex-1 flex-col gap-2 p-4">
              {p.category && <span><CategoryChip name={p.category.name} /></span>}
              <span className="font-display text-[17px] font-semibold leading-snug tracking-tight text-ink group-hover:text-accent">
                {p.title}
              </span>
              {p.excerpt && <span className="line-clamp-3 text-[13.5px] leading-relaxed text-muted">{p.excerpt}</span>}
              <span className="mt-auto pt-1"><Meta publishedAt={p.publishedAt} minutes={p.readMinutes} locale={locale} t={t} /></span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── the day's edition ─────────────────────────────────────────────────────── */

/**
 * The latest published edition, above the feed: the intro and its posts in
 * the editor's order. The intro is plain text (React escapes it), never HTML.
 * "Today" is decided on the Warsaw calendar, the same key editions use;
 * dates are numeric (DD.MM.YYYY), so `locale` is taken only for symmetry
 * with the feed.
 */
export function GrovNewsEditionBox({ edition, t }: { edition: CurrentEdition; locale: string; t: T }) {
  const today = edition.date === warsawDate();
  return (
    <section aria-labelledby="grovnews-edition" data-grovnews-edition-box={edition.date}
      className="panel relative mb-5 min-w-0 overflow-hidden rounded-2xl p-4 sm:p-5">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(26rem 7rem at 0% -20%, rgb(var(--accent) / 0.16), transparent 70%)" }} />
      <div className="relative min-w-0">
        <p className="overline">{edition.title}</p>
        <h2 id="grovnews-edition" className="mt-1 font-display text-[19px] font-semibold leading-snug tracking-tight">
          {today ? t("grovnews.edition.today") : t("grovnews.edition.from", { date: editionDateLabel(edition.date) })}
        </h2>
        {edition.intro && (
          <p className="mt-2 whitespace-pre-line break-words text-[14px] leading-relaxed text-muted">{edition.intro}</p>
        )}
        <ol className="mt-3 divide-y divide-line border-t border-line">
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

export function ContentBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4 text-[15.5px] leading-[1.75] text-[rgb(var(--ink)/0.88)]" data-grovnews-content>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h2": return <h2 key={i} className="pt-3 font-display text-[21px] font-semibold leading-snug tracking-tight text-ink"><InlineText parts={b.inline} /></h2>;
          case "h3": return <h3 key={i} className="pt-2 text-[17px] font-semibold leading-snug text-ink"><InlineText parts={b.inline} /></h3>;
          case "quote": return <blockquote key={i} className="border-l-2 border-[rgb(var(--accent)/0.6)] pl-4 italic text-muted"><InlineText parts={b.inline} /></blockquote>;
          case "list": return (
            <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-accent">
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

/** What a customer without an active entitlement sees — and ALL they see:
 *  no title, no excerpt, no count of what is behind the door. With GrovNews
 *  Premium on sale, the price (formatted on the server from the admin-set,
 *  Stripe-confirmed amount) and the way in. */
export function GrovNewsLocked({ t, offer = null }: { t: T; offer?: { price: string } | null }) {
  const topics = ["allegro", "marketplace", "ai", "law", "logistics"] as const;
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-6" data-grovnews-locked>
      <div className="panel relative w-full max-w-lg overflow-hidden rounded-3xl p-7 text-center sm:p-9">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32"
          style={{ background: "radial-gradient(22rem 9rem at 50% -30%, rgb(var(--accent) / 0.22), transparent 70%)" }} />
        <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent ring-1 ring-[rgb(var(--accent)/0.35)]">
          <Lock size={24} aria-hidden />
        </span>
        <p className="relative mt-5 font-display text-[26px] font-bold tracking-tight">{t("grovnews.title")}</p>
        <p className="relative mt-1 text-[15px] font-medium text-ink">{t("grovnews.lockedTagline")}</p>
        <p className="relative mt-4 text-sm leading-relaxed text-muted">{t("grovnews.lockedBody")}</p>
        <ul className="relative mt-5 flex flex-wrap justify-center gap-1.5">
          {topics.map((k) => (
            <li key={k} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-muted">{t(`grovnews.topics.${k}`)}</li>
          ))}
        </ul>
        {offer ? (
          <div className="relative mt-6" data-grovnews-offer>
            <p className="font-display text-[15px] font-semibold text-ink">
              {t("grovnews.premiumPrice", { price: offer.price })}
            </p>
            <div className="mt-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
              <Link href="/checkout?kind=grovnews" className="cta inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold">
                {t("grovnews.activate")}
              </Link>
              <Link href="/home" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line px-5 text-sm font-semibold text-ink transition-colors hover:bg-raised">
                {t("grovnews.lockedBack")}
              </Link>
            </div>
            <p className="mt-3 text-[12px] text-faint">{t("grovnews.cancelAnytime")}</p>
          </div>
        ) : (
          <>
            <p className="relative mt-5 text-[12.5px] text-faint">{t("grovnews.lockedSoon")}</p>
            <Link href="/home" className="relative mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-line px-5 text-sm font-semibold text-ink transition-colors hover:bg-raised">
              {t("grovnews.lockedBack")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
