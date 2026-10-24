import Link from "next/link";
import { ArrowUpRight, Building2, ChevronRight, Mail, MessageCircle } from "lucide-react";
import type { CmsBlock, CmsBlockContent } from "@/lib/cms";
import { publicText } from "@/lib/about-page";
import {
  CONTACT_REQUIRED_TEXTS, TICKET_TOPICS, contactText, fillTokens, shownChannels, shownCompany, shownFaq,
  type ChannelKind, type ContactTextKey, type ShownChannel,
} from "@/lib/contact-page";
import { cn } from "@/lib/utils";
import { ContactForm, CopyAddress } from "./contact-form";
import type { RenderContext } from "./blocks";

/**
 * KONTAKT V2 — the contact page, drawn from one contact_page section.
 *
 * A server component: a channel without a valid link, a FAQ link to a
 * question /plany does not have, a switched-off element, the company tile
 * without real data — none of them reaches the HTML (lib/contact-page.ts).
 *
 * LAYOUT. Desktop: the form on the left (3/5), channels, FAQ links and the
 * company tile stacked on the right (2/5). Phone: header → channels → FAQ →
 * form → company — which is simply the DOM order; on a desktop the form is
 * lifted into the first column and spans the right column's rows (their
 * number is known here, so the classes are too). Max width 1100px.
 */

const LABEL = "font-display text-[11.5px] font-semibold uppercase tracking-[0.2em] text-accent";
const CARD = "rounded-[1.5rem] border border-line bg-surface shadow-[0_1px_2px_rgb(15_15_30/0.04),0_12px_32px_-18px_rgb(15_15_30/0.18)]";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent)/0.6)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/* ── brand marks (lucide 1.x ships none) ─────────────────────────────────── */

function BrandIcon({ kind }: { kind: ChannelKind }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", "aria-hidden": true, focusable: "false" } as const;
  switch (kind) {
    case "email":
      return <Mail size={19} aria-hidden />;
    case "instagram":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common} fill="currentColor">
          <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common} fill="currentColor">
          <path d="M16.6 3c.3 2.1 1.6 3.5 3.6 3.7v3a6.6 6.6 0 0 1-3.6-1.1v6.2a5.6 5.6 0 1 1-5.6-5.6c.3 0 .6 0 .9.1v3.1a2.6 2.6 0 1 0 1.7 2.4V3h3z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common} fill="currentColor">
          <path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5a2.7 2.7 0 0 0-1.9 1.9C2 8.9 2 12 2 12s0 3.1.4 4.8c.2.9 1 1.6 1.9 1.9 1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9c.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8zM10 15V9l5.2 3L10 15z" />
        </svg>
      );
  }
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function ChannelCard({ ch, copy, copied, messenger }: {
  ch: ShownChannel; copy: string; copied: string; messenger: string;
}) {
  const external = !ch.href.startsWith("mailto:");
  return (
    <li data-contact-channel={ch.kind}
      className={cn(CARD, "group relative flex items-start gap-4 p-4 transition-[border-color,box-shadow] duration-200 hover:border-[rgb(var(--accent)/0.3)] sm:p-5")}>
      <span aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/25">
        <BrandIcon kind={ch.kind} />
      </span>
      <div className="min-w-0 flex-1">
        {/* The card's main link covers the card (after:inset-0); the copy
            button and the Messenger link sit above it. */}
        <a href={ch.href}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={cn("font-display text-[15px] font-semibold text-ink after:absolute after:inset-0 after:rounded-[1.5rem] after:content-['']", FOCUS, "focus-visible:after:ring-2 focus-visible:after:ring-[rgb(var(--accent)/0.6)] focus-visible:ring-0")}>
          {ch.title}
        </a>
        {ch.description && <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{ch.description}</p>}
        {ch.address && (
          <div className="relative z-10 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="break-all text-[14px] font-semibold text-accent" data-contact-address>{ch.address}</span>
            <CopyAddress address={ch.address} label={copy} done={copied} />
          </div>
        )}
        {ch.messenger && (
          <a href={ch.messenger} target="_blank" rel="noopener noreferrer" data-contact-messenger
            className={cn("relative z-10 mt-2 inline-flex min-h-[32px] items-center gap-1.5 rounded-lg text-[13.5px] font-semibold text-accent underline-offset-4 hover:underline", FOCUS)}>
            <MessageCircle size={15} aria-hidden />{messenger}
          </a>
        )}
      </div>
      {external && (
        <ArrowUpRight size={17} aria-hidden
          className="mt-0.5 shrink-0 text-faint transition-[color,transform] duration-200 group-hover:text-accent motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
      )}
    </li>
  );
}

export function renderContactPage(block: CmsBlock, ctx: RenderContext, first: boolean): React.ReactNode {
  const c: CmsBlockContent = block.content ?? {};
  const { locale, t } = ctx;
  const id = `contact-${block.id ?? block.sort_order}`;
  const time = contactText(c, "reply.time", locale);
  /** A text of the section; a required one falls back to the dictionary. */
  const text = (key: ContactTextKey): string =>
    contactText(c, key, locale) || (CONTACT_REQUIRED_TEXTS.has(key) ? t(`cms.contact.text.${key}`) : "");
  const badge = publicText(c.badge, locale);
  const title = publicText(c.title, locale);
  const subtitle = fillTokens(publicText(c.subtitle, locale), { czas: time });
  const Heading = first ? "h1" : "h2";

  const channels = shownChannels(c, ctx.site ?? {}, locale);
  const faq = shownFaq(c, locale);
  const company = shownCompany(c, locale);
  const channelsTitle = text("channels.title");
  const faqTitle = text("faq.title");
  const companyTitle = text("firm.title");
  const formTitle = text("form.title");
  const right = [channels.length > 0, faq.length > 0, Boolean(company)].filter(Boolean).length;
  const span = right === 3 ? "lg:row-span-3" : right === 2 ? "lg:row-span-2" : "lg:row-span-1";
  const rows = right === 3 ? "lg:grid-rows-[auto_auto_1fr]" : right === 2 ? "lg:grid-rows-[auto_1fr]" : "";

  const signedIn = Boolean(ctx.signedIn);
  const successBody = fillTokens(text("success.body"), { czas: time });

  return (
    <div data-contact-page className="mx-auto w-full max-w-[1100px]">
      <header className="max-w-[44rem]">
        {badge && <p className={cn(LABEL, "mb-4")}>{badge}</p>}
        {title && (
          <Heading className="font-display text-[clamp(2rem,5vw,3.4rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink [text-wrap:balance]">
            {title}
          </Heading>
        )}
        {subtitle && (
          <p className="mt-4 max-w-[38rem] text-[clamp(1rem,1.6vw,1.15rem)] leading-relaxed text-muted [text-wrap:pretty]" data-contact-subtitle>
            {subtitle}
          </p>
        )}
      </header>

      <div className={cn("mt-[clamp(2rem,4vw,3rem)] grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-x-8 lg:gap-y-6", rows)}>
        {channels.length > 0 && (
          <section aria-labelledby={channelsTitle ? `${id}-ch` : undefined} aria-label={channelsTitle ? undefined : t("cms.contact.channelsAria")}
            className="lg:col-start-2" data-contact-part="channels">
            {channelsTitle && <h2 id={`${id}-ch`} className="mb-3 px-1 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-faint">{channelsTitle}</h2>}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {channels.map((ch) => (
                <ChannelCard key={ch.index} ch={ch} copy={text("email.copy")} copied={text("email.copied")} messenger={text("channel.messenger")} />
              ))}
            </ul>
          </section>
        )}

        {faq.length > 0 && (
          <nav aria-labelledby={faqTitle ? `${id}-faq` : undefined} aria-label={faqTitle ? undefined : t("cms.contact.faqAria")}
            className={cn(CARD, "p-5 sm:p-6 lg:col-start-2")} data-contact-part="faq">
            {faqTitle && <h2 id={`${id}-faq`} className="font-display text-[16px] font-semibold tracking-tight text-ink">{faqTitle}</h2>}
            <ul className={cn("divide-y divide-line", faqTitle && "mt-3")}>
              {faq.map((q) => (
                <li key={q.index}>
                  <Link href={q.href} data-contact-faq={q.href}
                    className={cn("group flex min-h-[44px] items-center justify-between gap-3 rounded-lg py-2.5 text-[14px] font-medium text-ink transition-colors hover:text-accent", FOCUS)}>
                    <span>{q.title}</span>
                    <ChevronRight size={16} aria-hidden className="shrink-0 text-faint transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-accent" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className={cn(CARD, "relative overflow-hidden p-5 sm:p-8 lg:col-start-1 lg:row-start-1", right === 0 ? "lg:col-span-2" : span)}
          data-contact-part="form">
          <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--accent)/0.75),transparent)]" />
          {formTitle && <h2 className="relative font-display text-[1.35rem] font-semibold tracking-tight text-ink sm:text-[1.55rem]">{formTitle}</h2>}
          <div className={cn("relative", formTitle && "mt-5")}>
            <ContactForm
              topics={TICKET_TOPICS.map((value) => ({ value, label: text(`topic.${value}`) }))}
              initialTopic={ctx.contact?.topic ?? "app"}
              initialEmail={ctx.contact?.email ?? ""}
              labels={{
                topic: text("form.topic"), name: text("form.name"), email: text("form.email"), message: text("form.message"),
                generation: text("form.generation"), files: text("form.files"), filesHint: text("form.filesHint"),
                nip: text("form.nip"), consent: text("form.consent"), privacy: text("form.privacy"),
                submit: text("form.submit"), sending: text("form.sending"),
                successTitle: text("success.title"), successBody,
                ticket: text("success.ticket"),
                back: signedIn ? text("success.backApp") : text("success.backHome"),
              }}
              backHref={signedIn ? "/dashboard" : "/"}
              privacyHref="/polityka-prywatnosci"
            />
          </div>
        </div>

        {company && (
          <section aria-labelledby={`${id}-co`} className={cn(CARD, "p-5 sm:p-6 lg:col-start-2")} data-contact-part="company">
            <h2 id={`${id}-co`} className="flex items-center gap-2 font-display text-[16px] font-semibold tracking-tight text-ink">
              <Building2 size={17} aria-hidden className="text-accent" />{companyTitle || t("cms.contact.text.firm.title")}
            </h2>
            <dl className="mt-3 space-y-2 text-[14px] leading-relaxed">
              <div><dt className="sr-only">{t("cms.contact.company.name")}</dt><dd className="font-semibold text-ink">{company.name}</dd></div>
              {company.address && (
                <div><dt className="sr-only">{t("cms.contact.company.address")}</dt><dd className="whitespace-pre-line text-muted">{company.address}</dd></div>
              )}
              {company.nip && (
                <div className="flex gap-2"><dt className="text-faint">{t("cms.contact.company.nip")}</dt><dd className="text-muted">{company.nip}</dd></div>
              )}
              {company.email && (
                <div><dt className="sr-only">{t("cms.contact.company.email")}</dt>
                  <dd><a href={`mailto:${company.email}`} className={cn("break-all font-semibold text-accent underline-offset-4 hover:underline", FOCUS)}>{company.email}</a></dd>
                </div>
              )}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
