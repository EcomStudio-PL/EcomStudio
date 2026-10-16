"use client";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { GuideArt, GuideImage } from "@/lib/tool-guides";
import { GuideArtwork } from "./guide-art";

/**
 * EXAMPLE EFFECTS, IN PLACE OF AN EMPTY GALLERY.
 *
 * Shown only where the real gallery would say "nothing yet" (the decision is
 * starterVisible in lib/tool-guides.ts) and gone the moment the first real
 * result arrives. It is labelled as an example twice — a badge and a line —
 * and it has NO actions: no download, no favourite, no edit, nothing a real
 * result has, so it can never be mistaken for one. The picture keeps its own
 * shape (contained, never stretched or cropped); with no picture configured
 * it shows the drawn showcase instead.
 */
export function StarterGallery({ title, body, image, fallbackArt = "result", className }: {
  title: string;
  body: string;
  image: GuideImage | null;
  fallbackArt?: GuideArt;
  className?: string;
}) {
  const { t } = useI18n();
  const ratio = image?.width && image?.height ? `${image.width} / ${image.height}` : "16 / 10";
  return (
    <section data-starter-gallery aria-label={t("toolGuide.starterBadge")}
      className={cn("relative overflow-hidden rounded-2xl p-px", className)}
      style={{ background: "linear-gradient(140deg, rgb(var(--accent) / 0.55), rgb(var(--line-strong) / 0.6) 40%, rgb(var(--violet) / 0.45))" }}>
      <div className="relative overflow-hidden rounded-[15px] px-4 pb-4 pt-4 sm:px-5 sm:pb-5"
        style={{ background: "linear-gradient(180deg, rgb(var(--accent) / 0.06), transparent 40%), rgb(var(--surface) / 0.96)" }}>
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, rgb(var(--accent) / 0.22), transparent 70%)" }} />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent"
            data-starter-badge>
            <Sparkles size={12} aria-hidden />{t("toolGuide.starterBadge")}
          </span>
          <h2 className="mt-2.5 font-display text-[16px] font-semibold leading-snug sm:text-[17px]">{title}</h2>
          {body && <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted">{body}</p>}
        </div>
        <figure className="relative mt-3.5">
          {/* Width follows the capped height, so a tall picture gets a frame of
              its own shape rather than bands beside it. */}
          <div className="mx-auto overflow-hidden rounded-xl border border-line bg-raised/70"
            style={{ aspectRatio: ratio, maxHeight: "min(62vh, 560px)", width: `min(100%, calc(min(62vh, 560px) * ${ratio}))` }}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.url} srcSet={image.srcSet} sizes="(max-width: 1024px) 92vw, 60vw"
                alt={image.alt || title} loading="lazy" decoding="async"
                className="h-full w-full object-contain" draggable={false} />
            ) : (
              <GuideArtwork art={fallbackArt} className="h-full w-full" />
            )}
          </div>
          <figcaption className="mt-2 flex items-center gap-1.5 text-[11.5px] text-faint">
            <Sparkles size={11} aria-hidden className="text-accent" />{t("toolGuide.starterNote")}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
