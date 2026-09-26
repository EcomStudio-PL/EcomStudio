import Link from "next/link";
import { ChevronRight, Clock, ExternalLink, Newspaper } from "lucide-react";
import { AuthLink } from "@/components/auth/auth-link";
import { AnnouncementBar, SiteFooter, SiteHeader, type ShellProps } from "@/components/cms/site-shell";
import { ContentBlocks, formatNewsDate } from "@/components/grovnews/reader";
import { parseContent } from "@/lib/grovnews";
import { blogCategoryPath, blogPath, type BlogArticle, type BlogCard, type BlogCategory } from "@/lib/grovnews-blog";
import { cn } from "@/lib/utils";

/**
 * THE PUBLIC GROVNEWS BLOG — server components only. Nothing here ships
 * JavaScript except the sign-in link (the site-wide auth dialog), and nothing
 * here reads anything: every value arrives from lib/server/grovnews-blog.ts,
 * which only knows the public database functions. The article body is the
 * GrovNews content format rendered by React (reader.tsx `ContentBlocks`),
 * never HTML.
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The public site's own chrome around a /blog page. */
export function BlogFrame({ shell, children }: { shell: ShellProps; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <AnnouncementBar global={shell.global} locale={shell.locale} />
      <SiteHeader {...shell} />
      <main className="flex-1" data-blog>
        <div className="mx-auto w-full max-w-[72rem] px-[var(--page-x,1rem)] py-8 sm:py-12">{children}</div>
      </main>
      <SiteFooter {...shell} />
    </div>
  );
}

function Cover({ url, alt, className, eager = false }: { url: string | null; alt: string; className?: string; eager?: boolean }) {
  return (
    <span className={cn("relative block overflow-hidden bg-sunken", className)}>
      {url ? (
        // Bucket and external https covers alike; next/image would need every
        // host whitelisted in next.config (the GrovNews reader does the same).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async"
          {...(eager ? { fetchPriority: "high" as const } : {})}
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

function CategoryLink({ category }: { category: BlogCategory }) {
  return (
    <Link href={blogCategoryPath(category.slug)}
      className="relative z-10 inline-flex max-w-full truncate rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-accent hover:underline">
      {category.name}
    </Link>
  );
}

function Meta({ publishedAt, minutes, locale, t, byline = false }: {
  publishedAt: string; minutes: number; locale: string; t: T; byline?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-faint">
      {byline && <><span className="font-semibold text-muted">{t("grovnews.blog.byline")}</span><span aria-hidden>·</span></>}
      <time dateTime={publishedAt}>{formatNewsDate(publishedAt, locale)}</time>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden />{t("grovnews.readTime", { n: minutes })}</span>
    </span>
  );
}

/* ── the list ──────────────────────────────────────────────────────────────── */

/**
 * Cards. The whole card is one link (the title's, stretched), so the category
 * chip inside it stays a separate, working link to its own page.
 */
export function BlogCards({ cards, locale, t, headingLevel = 2 }: {
  cards: BlogCard[]; locale: string; t: T; headingLevel?: 2 | 3;
}) {
  if (cards.length === 0) {
    return (
      <div className="panel rounded-2xl px-6 py-12 text-center" data-blog-empty>
        <Newspaper size={28} className="mx-auto text-faint" aria-hidden />
        <p className="mt-3 text-[15px] font-semibold">{t("grovnews.blog.emptyTitle")}</p>
        <p className="mt-1 text-sm text-muted">{t("grovnews.blog.emptyBody")}</p>
      </div>
    );
  }
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-blog-cards>
      {cards.map((c, i) => (
        <li key={c.slug} lang={c.language} data-blog-card={c.slug}
          className="group panel relative flex min-w-0 flex-col overflow-hidden rounded-2xl transition-colors duration-200 hover:border-[rgb(var(--accent)/0.4)]">
          <Cover url={c.coverUrl} alt="" className="aspect-[16/9]" eager={i < 3} />
          <div className="flex flex-1 flex-col gap-2 p-4">
            {c.category && <span><CategoryLink category={c.category} /></span>}
            <H className="font-display text-[17px] font-semibold leading-snug tracking-tight text-ink">
              <Link href={blogPath(c.slug)}
                className="after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent">
                {c.title}
              </Link>
            </H>
            {c.excerpt && <p className="line-clamp-3 text-[13.5px] leading-relaxed text-muted">{c.excerpt}</p>}
            <span className="mt-auto pt-1"><Meta publishedAt={c.publishedAt} minutes={c.readMinutes} locale={locale} t={t} /></span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The categories present in a list, as links — derived from the articles,
 *  so it never offers a category page that would be empty. */
export function BlogCategoryNav({ cards, active, t }: { cards: BlogCard[]; active: string | null; t: T }) {
  const seen = new Map<string, BlogCategory>();
  for (const c of cards) if (c.category && !seen.has(c.category.slug)) seen.set(c.category.slug, c.category);
  if (seen.size < 2 && !active) return null;
  const pill = (on: boolean) => cn(
    "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-[12.5px] font-semibold transition-colors",
    on ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft text-accent" : "border-line text-muted hover:bg-raised hover:text-ink",
  );
  return (
    <nav aria-label={t("grovnews.blog.categories")} className="thin-scroll -mx-1 mb-6 flex gap-1.5 overflow-x-auto px-1 pb-1">
      <Link href="/blog" aria-current={active === null ? "page" : undefined} className={pill(active === null)}>
        {t("grovnews.blog.allArticles")}
      </Link>
      {[...seen.values()].map((c) => (
        <Link key={c.slug} href={blogCategoryPath(c.slug)} aria-current={active === c.slug ? "page" : undefined}
          className={pill(active === c.slug)}>
          {c.name}
        </Link>
      ))}
    </nav>
  );
}

/* ── breadcrumbs, call to action ───────────────────────────────────────────── */

export function Breadcrumbs({ items, t }: { items: { label: string; href?: string }[]; t: T }) {
  return (
    <nav aria-label={t("grovnews.blog.breadcrumbs")} className="mb-5 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-[12.5px] text-faint">
        {items.map((item, i) => (
          <li key={`${i}-${item.label}`} className="inline-flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={13} aria-hidden className="shrink-0" />}
            {item.href
              ? <Link href={item.href} className="rounded hover:text-ink hover:underline">{item.label}</Link>
              : <span aria-current="page" className="line-clamp-1 min-w-0 break-all text-muted">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * "Otwórz GrovNews": a signed-in reader goes to /grovnews, which shows the
 * posts to a subscriber and the locked screen (with the Stage 3 purchase) to
 * everyone else. A visitor gets the site's existing sign-in dialog, which
 * returns them to /grovnews. No access question is asked on this page.
 */
export function BlogCta({ signedIn, showAuth, t }: { signedIn: boolean; showAuth: boolean; t: T }) {
  const button = "cta inline-flex min-h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold";
  return (
    <aside aria-labelledby="blog-cta" data-blog-cta
      className="panel relative mt-10 overflow-hidden rounded-2xl p-5 sm:flex sm:items-center sm:gap-6 sm:p-7">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(26rem 7rem at 0% -20%, rgb(var(--accent) / 0.18), transparent 70%)" }} />
      <div className="relative min-w-0 flex-1">
        <p className="overline">{t("grovnews.title")}</p>
        <h2 id="blog-cta" className="mt-1 font-display text-[19px] font-semibold leading-snug tracking-tight sm:text-[21px]">
          {t("grovnews.blog.ctaTitle")}
        </h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{t("grovnews.blog.ctaBody")}</p>
      </div>
      <div className="relative mt-4 shrink-0 sm:mt-0">
        {signedIn || !showAuth
          ? <Link href="/grovnews" className={button}>{t("grovnews.blog.ctaButton")}</Link>
          : <AuthLink mode="login" next="/grovnews" className={button}>{t("grovnews.blog.ctaButton")}</AuthLink>}
      </div>
    </aside>
  );
}

/* ── one article ───────────────────────────────────────────────────────────── */

/** One article. `cta` is the page's call to action (the admin preview passes
 *  none: the view itself does not know who is reading). */
export function BlogArticleView({ article, related, locale, t, cta = null }: {
  article: BlogArticle; related: BlogCard[]; locale: string; t: T; cta?: React.ReactNode;
}) {
  return (
    <>
      <Breadcrumbs t={t} items={[
        { label: t("grovnews.blog.home"), href: "/" },
        { label: t("grovnews.blog.title"), href: "/blog" },
        ...(article.category ? [{ label: article.category.name, href: blogCategoryPath(article.category.slug) }] : []),
        { label: article.title },
      ]} />
      <article lang={article.language} className="mx-auto w-full max-w-3xl" data-blog-article={article.slug}>
        <header>
          {article.category && <CategoryLink category={article.category} />}
          <h1 className="mt-3 break-words font-display text-[clamp(1.6rem,1.2rem+1.8vw,2.4rem)] font-bold leading-[1.15] tracking-tight">
            {article.title}
          </h1>
          {article.excerpt && <p className="mt-3 text-[16.5px] leading-relaxed text-muted">{article.excerpt}</p>}
          <div className="mt-3"><Meta publishedAt={article.publishedAt} minutes={article.readMinutes} locale={locale} t={t} byline /></div>
        </header>
        {article.coverUrl && (
          <Cover url={article.coverUrl} alt={article.coverAlt ?? ""} eager className="mt-6 aspect-[16/9] rounded-2xl" />
        )}
        <div className="mt-7"><ContentBlocks blocks={parseContent(article.content)} /></div>

        {article.faq.length > 0 && (
          <section className="mt-10 border-t border-line pt-6" aria-labelledby="blog-faq" data-blog-faq>
            <h2 id="blog-faq" className="font-display text-[21px] font-semibold tracking-tight">{t("grovnews.blog.faq")}</h2>
            <div className="mt-3 divide-y divide-line">
              {article.faq.map((f, i) => (
                <div key={i} className="py-3.5">
                  <h3 className="text-[16px] font-semibold leading-snug text-ink">{f.q}</h3>
                  <p className="mt-1.5 whitespace-pre-line break-words text-[15px] leading-relaxed text-[rgb(var(--ink)/0.85)]">{f.a}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {article.sources.length > 0 && (
          <section className="mt-10 border-t border-line pt-6" aria-labelledby="blog-sources" data-blog-sources>
            <h2 id="blog-sources" className="overline mb-3">{t("grovnews.sources")}</h2>
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
          <ul className="mt-6 flex flex-wrap gap-1.5" aria-label={t("grovnews.blog.tags")}>
            {article.tags.map((tag) => (
              <li key={tag} className="rounded-full border border-line px-2 py-0.5 text-[11.5px] text-muted">#{tag}</li>
            ))}
          </ul>
        )}
      </article>

      {cta && <div className="mx-auto w-full max-w-3xl">{cta}</div>}

      {related.length > 0 && (
        <section className="mt-12" aria-labelledby="blog-related" data-blog-related>
          <h2 id="blog-related" className="mb-4 font-display text-[21px] font-semibold tracking-tight">{t("grovnews.blog.related")}</h2>
          <BlogCards cards={related} locale={locale} t={t} headingLevel={3} />
        </section>
      )}
    </>
  );
}
