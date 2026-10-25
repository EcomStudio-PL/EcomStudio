import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CmsBlock, CmsBlockContent } from "@/lib/cms";
import { publicText } from "@/lib/about-page";
import { TOPIC_PARAM } from "@/lib/contact-page";
import { EMPTY_FAQ, faqJsonLd, faqSafeHref, type FaqTextKey } from "@/lib/faq";
import { jsonLdScript } from "@/lib/grovnews-blog";
import { cn } from "@/lib/utils";
import { BrandIcon } from "@/components/cms/contact-page";
import type { RenderContext } from "@/components/cms/blocks";
import { FaqBrowser, type FaqBrowserText } from "./faq-browser";

/**
 * /faq — THE FAQ PAGE (FAQ V1), one CMS section (`faq_page`).
 *
 * A server component: the questions are the FAQ base's, marked for /faq and
 * already filtered (lib/server/faq.ts) — nothing hidden or unfinished is in
 * this HTML, in the props of the browser part, or in the FAQPage data. The
 * section's own words are content.fields (editable in "Edytuj stronę"), each
 * falling back to the dictionary.
 *
 *   hero          label, H1, one line with a link ("Napisz do nas" → /kontakt)
 *   FaqBrowser    the live search, the category pills, the questions
 *   closing tile  "Nie znalazłeś odpowiedzi?" → /kontakt, plus Instagram /
 *                 Messenger only when the Kontakt page really has them
 */

export type FaqChannels = { instagram?: string; messenger?: string };

const LABEL = "font-display text-[11.5px] font-semibold uppercase tracking-[0.2em] text-accent";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent)/0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const BUTTON = cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-semibold transition-colors", FOCUS);

export function renderFaqPage(block: CmsBlock, ctx: RenderContext, first: boolean): React.ReactNode {
  const c: CmsBlockContent = block.content ?? {};
  const { locale, t } = ctx;
  const field = (k: FaqTextKey): string => publicText(c.fields?.[k], locale) || t(`cms.faq.text.${k}`);
  const data = ctx.faq?.faq ?? EMPTY_FAQ;
  const Heading = first ? "h1" : "h2";

  const badge = publicText(c.badge, locale);
  const title = publicText(c.title, locale) || t("cms.faq.text.title");
  const lead = publicText(c.subtitle, locale);
  const linkLabel = publicText(c.ctaLabel, locale);
  const linkHref = faqSafeHref(c.ctaUrl ?? "") ?? "/kontakt";
  const tail = publicText(c.description, locale);
  const endLabel = publicText(c.cta2Label, locale) || t("cms.faq.text.endCta");
  const endHref = faqSafeHref(c.cta2Url ?? "") ?? "/kontakt";
  const channels = ctx.faqChannels ?? {};

  const text: FaqBrowserText = {
    placeholder: field("find.placeholder"),
    searchLabel: t("cms.faq.searchLabel"),
    clear: t("cms.faq.clear"),
    empty: field("find.empty"),
    emptyHint: field("find.emptyHint"),
    emptyCta: field("find.emptyCta"),
    topics: field("topics.label"),
    results: t("cms.faq.results"),
    resultsNone: t("cms.faq.resultsNone"),
    voteQuestion: field("vote.question"),
    voteYes: field("vote.yes"),
    voteNo: field("vote.no"),
    voteThanks: field("vote.thanks"),
    voteSorry: field("vote.sorry"),
    voteContact: field("vote.contact"),
    voteError: t("cms.faq.voteError"),
    copy: field("link.copy"),
    copied: field("link.copied"),
    copyFailed: t("cms.faq.copyFailed"),
  };
  // "Nie" → the Kontakt form, on the topic the category belongs to.
  const contactTopics = Object.fromEntries(data.categories.map((cat) => [cat.slug, `/kontakt?temat=${TOPIC_PARAM[cat.topic]}`]));
  const ld = faqJsonLd(data.items);

  return (
    <div data-faq-page data-faq-shared="faq" className="mx-auto w-full max-w-[880px]">
      <header className="text-center">
        {badge && <p className={cn(LABEL, "mb-4")}>{badge}</p>}
        <Heading className="font-display text-[clamp(2rem,5vw,3.4rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink [text-wrap:balance]">
          {title}
        </Heading>
        {(lead || linkLabel || tail) && (
          <p className="mx-auto mt-4 max-w-[38rem] text-[clamp(1rem,1.6vw,1.15rem)] leading-relaxed text-muted [text-wrap:pretty]" data-faq-lead>
            {lead}{lead && linkLabel ? " " : ""}
            {linkLabel && (
              <Link href={linkHref} className={cn("rounded-sm font-semibold text-[rgb(var(--accent-strong))] underline decoration-[rgb(var(--accent)/0.35)] underline-offset-4 transition-colors hover:decoration-current dark:text-[rgb(var(--accent-glow))]", FOCUS)}>
                {linkLabel}
              </Link>
            )}
            {tail ? ` ${tail}` : ""}
          </p>
        )}
      </header>

      <FaqBrowser data={data} text={text} contactHref={endHref} contactTopics={contactTopics} />

      <section aria-labelledby={`faq-end-${block.id ?? "x"}`} data-faq-end
        className="mt-[clamp(3rem,6vw,4.5rem)] rounded-[1.75rem] border border-line bg-surface px-6 py-8 text-center shadow-[0_1px_2px_rgb(15_15_30/0.04),0_18px_44px_-24px_rgb(176_0_172/0.35)] sm:px-10 sm:py-10">
        <h2 id={`faq-end-${block.id ?? "x"}`} className="font-display text-[clamp(1.35rem,2.6vw,1.75rem)] font-semibold tracking-[-0.02em] text-ink">
          {field("end.title")}
        </h2>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href={endHref} data-faq-end-contact
            className={cn(BUTTON, "bg-[rgb(var(--accent-strong))] text-white shadow-[0_10px_24px_-12px_rgb(176_0_172/0.7)] hover:bg-[rgb(var(--accent))]")}>
            {endLabel}<ArrowRight size={16} aria-hidden />
          </Link>
          {channels.instagram && (
            <a href={channels.instagram} target="_blank" rel="noopener noreferrer" data-faq-end-channel="instagram"
              className={cn(BUTTON, "border border-line bg-bg text-ink hover:bg-raised")}>
              <BrandIcon kind="instagram" />{t("cms.faq.instagram")}
            </a>
          )}
          {channels.messenger && (
            <a href={channels.messenger} target="_blank" rel="noopener noreferrer" data-faq-end-channel="messenger"
              className={cn(BUTTON, "border border-line bg-bg text-ink hover:bg-raised")}>
              <BrandIcon kind="facebook" />{t("cms.faq.messenger")}
            </a>
          )}
        </div>
      </section>

      {ld && <script type="application/ld+json" data-faq-ld dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} />}
    </div>
  );
}
