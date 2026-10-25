"use client";
import Link from "next/link";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { dismissBannerAction } from "@/app/actions/notifications";
import { applyBell, useBell } from "@/lib/notifications/bell-store";
import { safeHref, type BellPayload } from "@/lib/notifications/catalog";
import { BrandMark } from "@/components/layout/brand";

/**
 * THE BAR UNDER THE HEADER for an admin message marked „Ważny”.
 *
 * In the page's flow, not fixed: it pushes the page down by one thin row
 * instead of covering the phone header, the dock or a tool's panel. Closing
 * it is that customer's decision for that message only, and it is NOT
 * reading — the message stays in „Ważne” (and in the badge) until opened.
 */
export function ImportantBanner({ initial }: { initial?: BellPayload }) {
  const { t } = useI18n();
  const bell = useBell(initial);
  const b = bell.banner;
  if (!b) return null;
  const id = b.id;
  return (
    <BannerView title={b.title} body={b.body} ctaLabel={b.meta.cta_label} ctaHref={b.meta.cta_href ?? b.href}
      closeLabel={t("notif.v2.closeBar")}
      onClose={() => applyBell((s) => ({ ...s, banner: null }), dismissBannerAction(id))} />
  );
}

/** The bar itself — also the admin's preview of a „Ważny” message. */
export function BannerView({ title, body, ctaLabel, ctaHref, closeLabel, onClose }: {
  title: string; body: string | null; ctaLabel: unknown; ctaHref: unknown; closeLabel: string; onClose?: () => void;
}) {
  const link = safeHref(ctaHref);
  const cta = typeof ctaLabel === "string" && ctaLabel && link ? ctaLabel : null;
  return (
    <div data-important-banner role="status"
      className="border-b border-[rgb(var(--accent)/0.25)] bg-[linear-gradient(90deg,rgb(var(--accent)/0.10),rgb(var(--violet)/0.06))]">
      <div className="mx-auto flex w-full min-w-0 max-w-[var(--content-max)] items-center gap-2.5 px-[var(--page-x)] py-2 sm:px-6 lg:px-8 xl:px-10">
        <span aria-hidden className="shrink-0"><BrandMark size={16} /></span>
        <p className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="font-semibold">{title}</span>
          {body && <span className="hidden text-muted sm:inline"> · {body}</span>}
        </p>
        {cta && link && (link.external ? (
          <a href={link.href} target="_blank" rel="noopener noreferrer"
            className="shrink-0 text-[12px] font-semibold text-accent hover:underline">{cta}</a>
        ) : (
          <Link href={link.href} className="shrink-0 text-[12px] font-semibold text-accent hover:underline">{cta}</Link>
        ))}
        <button type="button" onClick={onClose} aria-label={closeLabel} data-banner-close
          className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
          <X size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}
