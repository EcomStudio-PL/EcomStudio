"use client";
import { useI18n } from "@/lib/i18n/provider";
import { WATERMARK_POSITIONS } from "@/lib/images/tools";

/**
 * LIVE WATERMARK PREVIEW.
 *
 * Placement, scale, opacity, margin, rotation and spacing all read as
 * fractions of the image, so the browser can show exactly where the mark will
 * land without a single server call — the seller moves a slider and sees the
 * answer immediately, then pays nothing to apply it. The render is a preview,
 * not the deliverable: the final pixels come from sharp on the server.
 */
export function WatermarkPreview({ base, logo, settings }: {
  base: string;
  logo: string;
  settings: Record<string, unknown>;
}) {
  const { t } = useI18n();
  const position = String(settings.position ?? "bottom-right") as (typeof WATERMARK_POSITIONS)[number];
  const scale = Number(settings.scale ?? 18) / 100;
  const opacity = Number(settings.opacity ?? 60) / 100;
  const margin = Number(settings.margin ?? 4);
  const rotation = Number(settings.rotation ?? 0);
  const spacing = Number(settings.spacing ?? 24);

  const anchored = position !== "pattern";
  const vertical = position.startsWith("top") ? "flex-start" : position.startsWith("bottom") ? "flex-end" : "center";
  const horizontal = position.endsWith("left") ? "flex-start" : position.endsWith("right") ? "flex-end" : "center";

  return (
    <figure className="m-0">
      <div className="relative overflow-hidden rounded-xl bg-checker">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={base} alt="" className="block max-h-48 w-full object-contain" />
        {anchored ? (
          <div className="absolute inset-0 flex" style={{ alignItems: vertical, justifyContent: horizontal, padding: `${margin}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="" style={{ width: `${scale * 100}%`, opacity }} className="object-contain" />
          </div>
        ) : (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              opacity,
              backgroundImage: `url(${logo})`,
              backgroundRepeat: "repeat",
              backgroundSize: `${scale * 100 + spacing / 8}% auto`,
              transform: `rotate(${rotation}deg) scale(1.6)`,
            }}
          />
        )}
      </div>
      <figcaption className="mt-1.5 text-center text-[11px] text-faint">{t("tools.previewNote")}</figcaption>
    </figure>
  );
}
