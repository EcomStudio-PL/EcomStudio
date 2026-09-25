import type { ToolMotif } from "@/components/tools/tool-thumb";
import type { MenuBadge } from "@/lib/features";
import { HOME_GALLERY, HOME_SLOT } from "@/lib/media-slots";
import type { SlotMap } from "@/lib/server/media-slots";
import { SlotMedia } from "@/components/media/slot-media";
import { GalleryArt } from "./card-art";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * THE SHOWCASE GALLERIES — Packshoty, the Wideo UGC banner, Reklamy i Social.
 *
 * Made of nothing but media slots (lib/media-slots.ts, HOME_SLOT). The
 * operator fills them in Admin → Media → Sekcje → Strona główna; until then
 * each tile draws the neutral motif in its final shape, so the geometry of the
 * page is finished and nothing on it pretends to be a creative GrovBase made.
 * A tile holding a clip carries the play mark; there is no duration on a slot,
 * so none is invented.
 *
 * DENSE ON PURPOSE. The reference is a creative marketplace, not a card grid:
 * small gutters, no captions, rows that fill the width.
 */

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

/** Motifs cycled across a gallery so an empty one reads as a designed surface
 *  rather than one tile that failed to load, repeated. */
const PACKSHOT_MOTIFS: readonly ToolMotif[] = ["cutout", "shadow", "frame", "spark", "swatch", "wipe"];
const AD_MOTIFS: readonly ToolMotif[] = ["spark", "stamp", "swatch", "grid", "wipe", "frame", "cutout"];

/**
 * PACKSHOTY — six squares over six wide frames. Two columns on a phone, three
 * on a tablet, six across from `lg`.
 */
export function PackshotGallery({ slots }: { slots: SlotMap }) {
  const g = HOME_GALLERY;
  const grid = "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-6";
  return (
    <div className="space-y-2 sm:space-y-2.5">
      <div className={grid}>
        {range(1, g.packshotSquares).map((n, i) => (
          <GalleryArt key={n} slot={HOME_SLOT.packshot(n)} slots={slots} ratio="1/1"
            motif={PACKSHOT_MOTIFS[i % PACKSHOT_MOTIFS.length]}
            sizes="(max-width: 639px) 48vw, (max-width: 1023px) 32vw, 16vw" />
        ))}
      </div>
      <div className={grid}>
        {range(g.packshotSquares + 1, g.packshotWide).map((n, i) => (
          <GalleryArt key={n} slot={HOME_SLOT.packshot(n)} slots={slots} ratio="16/10"
            motif={PACKSHOT_MOTIFS[(i + 3) % PACKSHOT_MOTIFS.length]}
            sizes="(max-width: 639px) 48vw, (max-width: 1023px) 32vw, 16vw" />
        ))}
      </div>
    </div>
  );
}

/**
 * THE WIDEO UGC BANNER — a wide cyan band with the promise on the left and
 * three portrait clips on the right; on a phone the clips sit in a row under
 * the copy.
 *
 * It carries the video module's OWN state, from the switchboard: "Wkrótce"
 * today, since video has no engine, and no button — it shows what the module
 * will make, it does not offer to make it. The page drops the band entirely
 * when the module is off the menu.
 */
export function UgcBanner({ slots, badge, t }: { slots: SlotMap; badge: MenuBadge; t: T }) {
  const badgeLabel = badge === "soon" ? t("features.badgeSoon")
    : badge === "maintenance" ? t("features.badgeMaintenance")
    : badge === "disabled" ? t("features.badgeDisabled") : null;
  const art = slots.has(HOME_SLOT.ugcArt);
  return (
    <section aria-labelledby="home-ugc" className="relative isolate overflow-hidden rounded-2xl">
      {/* The ground: the operator's art under a left-hand scrim, or the painted
          cyan band. Deep on the left, where the copy sits, so white text keeps
          its contrast in both themes. */}
      {/* The ground: the operator's art under a scrim, or the painted cyan
          band. Either way the DEEP end sits behind the copy — at the top on a
          phone, where the clips stack under the words, and on the left from
          `sm` up — so white text keeps AA contrast in both themes and at every
          width. The art layer is decoration: `inert`, so a clip's native
          controls can never take focus from behind the copy. */}
      {art ? (
        <>
          <span aria-hidden inert className="absolute inset-0 -z-10 [&>span]:h-full">
            <SlotMedia slot={HOME_SLOT.ugcArt} slots={slots} ratio="3/1" sizes="100vw"
              className="h-full" fallback={null} />
          </span>
          <span aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(var(--cyan-deep)/0.92),rgb(var(--cyan-deep)/0.7)_55%,rgb(var(--cyan-deep)/0.25))] sm:bg-[linear-gradient(90deg,rgb(var(--cyan-deep)/0.92),rgb(var(--cyan-deep)/0.72)_45%,transparent)]" />
        </>
      ) : (
        <span aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(var(--cyan-deep))_0%,rgb(var(--cyan-deep))_50%,rgb(var(--cyan))_100%)] sm:bg-[linear-gradient(100deg,rgb(var(--cyan-deep))_0%,rgb(var(--cyan-deep))_45%,rgb(var(--cyan))_100%)]">
          <span className="absolute inset-0" style={{
            background: "radial-gradient(34rem 14rem at 85% 120%, rgb(255 255 255 / 0.20), transparent 70%)",
          }} />
        </span>
      )}

      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-7 lg:px-10">
        <div className="min-w-0 text-white">
          {badgeLabel && (
            <span className="mb-2 inline-flex items-center rounded-full bg-[rgb(255_255_255/0.18)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]">
              {badgeLabel}
            </span>
          )}
          <h2 id="home-ugc" className="font-display text-[clamp(1.7rem,1.2rem+2.2vw,2.9rem)] font-bold uppercase leading-none tracking-[-0.01em]">
            {t("home2.ugcTitle")}
          </h2>
          <p className="mt-2 max-w-sm text-[13.5px] font-medium leading-snug text-[rgb(255_255_255/0.9)] sm:text-[15px]">
            {t("home2.ugcLead")}
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-2 sm:flex sm:gap-3">
          {range(1, HOME_GALLERY.ugcClips).map((n, i) => (
            <span key={n} className={i === 1 ? "sm:translate-y-2" : undefined}>
              <span className="block rounded-xl ring-2 ring-[rgb(255_255_255/0.55)] sm:w-[6.5rem] lg:w-[7.25rem]">
                <GalleryArt slot={HOME_SLOT.ugc(n)} slots={slots} ratio="4/5" motif="video"
                  sizes="(max-width: 639px) 30vw, 8rem" />
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * REKLAMY I SOCIAL — five tall creatives and, beside them, two wide cards
 * stacked to the same height. On a phone: two columns, the pair taking the
 * cell beside the fifth creative at that creative's shape.
 */
export function AdsGallery({ slots }: { slots: SlotMap }) {
  const g = HOME_GALLERY;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.35fr)]">
      {range(1, g.adsTall).map((n, i) => (
        <GalleryArt key={n} slot={HOME_SLOT.ad(n)} slots={slots} ratio="4/5"
          motif={AD_MOTIFS[i % AD_MOTIFS.length]}
          sizes="(max-width: 639px) 48vw, (max-width: 1023px) 32vw, 15vw" />
      ))}
      {/* THE PAIR TAKES THE ROW'S HEIGHT, IT NEVER SETS IT. Its two cards sit
          in an absolutely positioned grid, so they contribute nothing to the
          row's sizing: below `lg` the pair owns a creative's shape itself
          (4/5, same column width, same height), and from `lg` — where its
          column is wider — it stretches to whatever height the tall creatives
          give the row. In the flow, the cards' own 16/9 would push the row
          taller than the creatives beside them. */}
      <div className="relative aspect-[4/5] min-w-0 lg:aspect-auto">
        <div className="absolute inset-0 grid grid-rows-2 gap-2 sm:gap-2.5">
          {range(g.adsTall + 1, g.adsWide).map((n, i) => (
            <div key={n} className="min-h-0 min-w-0">
              <GalleryArt slot={HOME_SLOT.ad(n)} slots={slots} ratio="16/9" fill
                motif={AD_MOTIFS[(g.adsTall + i) % AD_MOTIFS.length]}
                sizes="(max-width: 639px) 48vw, (max-width: 1023px) 32vw, 20vw" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
