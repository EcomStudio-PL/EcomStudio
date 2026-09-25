import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LiveBanner } from "@/lib/server/media-slots";
import type { SlotMap } from "@/lib/server/media-slots";
import { bannerSlotKey } from "@/lib/media-slots";
import { SlotMedia } from "@/components/media/slot-media";

/**
 * A BANNER, WHERE AN ADMIN SCHEDULED ONE.
 *
 * Nothing is rendered unless a banner is live: no empty frame, no reserved
 * strip, no "brak kampanii" placeholder. A surface with no banner looks
 * exactly as it did before banners existed, which is the same rule every slot
 * in this feature follows.
 *
 * The picture is a media slot like any other, so it is the same library, the
 * same crop controls and the same responsive overrides — a banner is not a
 * second media system with its own uploader.
 */
export function DashboardBanner({ banners, slots, locale, priority = false }: {
  banners: LiveBanner[];
  slots: SlotMap;
  locale: string;
  /** The banner leads the page (the Home's Start): its picture is the first
   *  thing painted, so it is fetched eagerly rather than lazily. */
  priority?: boolean;
}) {
  if (banners.length === 0) return null;
  // One at a time. A stack of promos is an advert break, not a dashboard.
  const banner = banners[0];
  const pick = (bag: Record<string, string>) => bag[locale] || bag.pl || "";
  const label = pick(banner.label);
  const body = pick(banner.body);
  const cta = pick(banner.ctaLabel);
  const slotKey = bannerSlotKey(banner.key);

  // A banner with neither words nor a picture has nothing to say.
  if (!label && !body && !slots.has(slotKey)) return null;

  const inner = (
    <>
      <SlotMedia slot={slotKey} slots={slots} ratio="3/1" sizes="100vw" priority={priority}
        className="rounded-xl" fallback={null} />
      {(label || body || cta) && (
        <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
          <div className="min-w-0 flex-1">
            {label && <p className="text-[14px] font-semibold tracking-tight">{label}</p>}
            {body && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{body}</p>}
          </div>
          {cta && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-accent">
              {cta}
              <ArrowRight size={14} aria-hidden />
            </span>
          )}
        </div>
      )}
    </>
  );

  const shell = "panel block overflow-hidden rounded-2xl";

  return banner.ctaUrl ? (
    <Link href={banner.ctaUrl} data-banner={banner.key}
      className={`${shell} transition-colors hover:border-[rgb(var(--accent)/0.45)]`}>
      {inner}
    </Link>
  ) : (
    <div className={shell} data-banner={banner.key}>{inner}</div>
  );
}
