"use client";
import { AlertCircle, Check, Globe } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * WHAT THE PAGE LOOKS LIKE WHERE PEOPLE ACTUALLY SEE IT FIRST.
 *
 * A meta description is a field in a form right up until somebody pastes the
 * link into a chat and it comes out blank. Two previews, drawn from the same
 * values the page will really publish — the search result and the share card
 * — plus a short list of the things that are missing.
 *
 * THE CHECKLIST IS SIX ITEMS, NOT SIXTY. It is deliberately not a scoring
 * plugin: a green light next to "keyword density 1.4%" is advice pretending
 * to be a fact. These six are things that are either present or absent, and
 * every one of them changes what a visitor sees before they click.
 *
 * The truncation is Google's, roughly: about 60 characters of title and 155
 * of description survive on a desktop result. Showing the cut rather than
 * counting up to it is the point — you see the sentence that will be lost.
 */

export type SeoCheck = {
  key: string;
  ok: boolean;
};

export function SeoPreview({ url, title, description, ogTitle, ogDescription, ogImage, checks }: {
  /** The address as it will read in a result: grovbase.com/promo/2x-kredyty */
  url: string;
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  checks: SeoCheck[];
}) {
  const { t } = useI18n();
  const cut = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

  const missing = checks.filter((c) => !c.ok);

  return (
    <div className="space-y-4" data-seo-preview>
      {/* ── GOOGLE ──────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
          {t("cms.seo.previewGoogle")}
        </p>
        <div className="rounded-xl border border-line bg-surface p-3.5">
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <Globe size={12} aria-hidden />
            <span className="truncate">{url}</span>
          </p>
          <p className="mt-1 text-[16px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]"
            data-seo-google-title>
            {cut(title, 60) || t("cms.seo.previewNoTitle")}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted" data-seo-google-desc>
            {cut(description, 155) || t("cms.seo.previewNoDesc")}
          </p>
        </div>
      </div>

      {/* ── SHARE CARD ──────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
          {t("cms.seo.previewSocial")}
        </p>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {ogImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ogImage} alt="" data-seo-og-image
              className="aspect-[1.91/1] w-full bg-sunken object-cover" />
          ) : (
            <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-sunken text-[12px] text-faint">
              {t("cms.seo.previewNoImage")}
            </div>
          )}
          <div className="p-3">
            <p className="text-[11px] uppercase tracking-wide text-faint">{url.split("/")[0]}</p>
            <p className="mt-0.5 truncate text-[13.5px] font-semibold">
              {ogTitle || title || t("cms.seo.previewNoTitle")}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted">
              {ogDescription || description}
            </p>
          </div>
        </div>
      </div>

      {/* ── THE LIST ────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
          <span>{t("cms.seo.checklist")}</span>
          <span className="tabular-nums">
            {checks.length - missing.length}/{checks.length}
          </span>
        </p>
        <ul className="space-y-1.5" data-seo-checklist>
          {checks.map((c) => (
            <li key={c.key} data-seo-check={c.key} data-ok={c.ok || undefined}
              className={cn("flex items-start gap-2 text-[12.5px]",
                c.ok ? "text-muted" : "text-ink")}>
              <span aria-hidden className={cn("mt-0.5 shrink-0",
                c.ok ? "text-[rgb(var(--success))]" : "text-[rgb(var(--caution))]")}>
                {c.ok ? <Check size={14} /> : <AlertCircle size={14} />}
              </span>
              <span>{t(`cms.seo.check.${c.key}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
