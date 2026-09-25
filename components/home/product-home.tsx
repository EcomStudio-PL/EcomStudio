import type { HomeModel } from "@/lib/home-sections";
import { HOME_ROUTES } from "@/lib/home-sections";
import { HOME_GALLERY, HOME_SLOT } from "@/lib/media-slots";
import type { LiveBanner, SlotMap } from "@/lib/server/media-slots";
import { DashboardBanner } from "@/components/dashboard/banner";
import { RailTile, EffectCard, SectionHead, TryPill, Badge } from "./product-cards";
import { StartBox } from "./start-box";
import { GrovshotBanner } from "./grovshot-banner";
import { PackshotGallery, UgcBanner, AdsGallery } from "./home-gallery";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * THE HOME / START — ONE BODY, EVERY ADDRESS.
 *
 * This is the canonical page body. It is rendered, unchanged, by:
 *
 *   /start         app/[slug]/page.tsx — the CMS page of kind `app`, public,
 *                  in its own chrome (components/home/product-surface.tsx)
 *   /home          app/(app)/home/page.tsx — the signed-in "Start" of the
 *                  bottom navigation, inside the application's own shell
 *   /              app/page.tsx — once Admin → Strony WWW flags the `app`
 *                  page as the homepage (cms_pages.is_homepage); /start then
 *                  forwards to "/" so the two never compete
 *
 * A visitor and a customer see the same sections in the same order. What
 * differs is what a press does — a customer opens the tool, a visitor gets
 * the existing sign-in dialog pointed at it (`Gate`) — and the header around
 * it, which is the application's own in whichever state applies. The real
 * gate is on the server: every tool route is protected by the middleware and
 * the (app) layout, and every endpoint that spends a credit or writes a file
 * answers 401 without a session.
 *
 * THE ORDER IS THE REFERENCE LAYOUT'S: rail → upload box, chips, samples →
 * Wybierz efekt → GrovShot → Packshoty → Wideo UGC → Reklamy i Social → the
 * video row. Every card comes from lib/home-sections.ts, which resolves it
 * through the registries; every gallery tile is a media slot.
 */
export function ProductHome({ signedIn, model, slots, t, banners = [], locale = "pl" }: {
  signedIn: boolean;
  /** lib/home-sections.ts `homeModel()` — the cards, resolved for this viewer. */
  model: HomeModel;
  /** Whatever an operator has dressed the page with. Empty is normal. */
  slots: SlotMap;
  t: T;
  /** Campaigns an admin scheduled for the Start ("dashboard" placement). The
   *  read is signed-in only (RLS), so a visitor never has any. */
  banners?: LiveBanner[];
  locale?: string;
}) {
  const { rail, chips, effects, video, ugc, startHref, packshotHref } = model;
  // "Za darmo" is true for a visitor — an account starts with free credits —
  // and not for a customer, whose generations cost credits. Same button,
  // honest words for each.
  const tryLabel = signedIn ? t("home2.tryIt") : t("home2.tryFree");
  const tryPill = (href: string | null) =>
    href ? <TryPill href={href} signedIn={signedIn} label={tryLabel} /> : undefined;
  const videoSoon = video.length > 0 && video.every((c) => c.badge !== null);
  // "Zobacz przykłady" leads to Packshoty — only worth a button once an
  // operator has put at least one example there.
  const hasExamples = Array.from({ length: HOME_GALLERY.packshotSquares + HOME_GALLERY.packshotWide },
    (_, i) => HOME_SLOT.packshot(i + 1)).some((k) => slots.has(k));

  return (
    <div className="space-y-9 sm:space-y-11">
      {/* 0 — A CAMPAIGN, when an admin scheduled one for the Start. Nothing is
          reserved for it otherwise. */}
      {banners.length > 0 && <DashboardBanner banners={banners} slots={slots} locale={locale} priority />}

      {/* 1 — THE RAIL. Pictures first: a seller should see what this place
          makes before being told anything about it. A carousel on a phone,
          three across on a tablet, six on a desktop — one DOM, so nothing is
          fetched twice. */}
      {rail.length > 0 && (
        <section aria-label={t("home2.railLabel")}>
          <div className="rail-x-sm sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
            {rail.map((c, i) => (
              <RailTile key={c.key} card={c} signedIn={signedIn} slots={slots} t={t}
                priority={banners.length === 0 && i < 2} />
            ))}
          </div>
        </section>
      )}

      {/* 2–4 — THE UPLOAD BOX, the quick chips and the samples. */}
      <StartBox signedIn={signedIn} chips={chips} href={startHref} t={t} />

      {/* 5 — WYBIERZ EFEKT. */}
      {effects.length > 0 && (
        <section aria-labelledby="home-effects">
          <SectionHead id="home-effects" title={t("home2.sec.effects")} sub={t("home2.sec.effectsSub")}
            action={tryPill(startHref)} />
          <div className="rail-x-sm sm:grid sm:grid-cols-4 sm:gap-2.5 lg:grid-cols-8">
            {effects.map((c) => (
              <EffectCard key={c.key} card={c} signedIn={signedIn} slots={slots} t={t}
                sizes="(max-width: 639px) 46vw, (max-width: 1023px) 24vw, 12vw" />
            ))}
          </div>
        </section>
      )}

      {/* 6 — GROVSHOT. */}
      <GrovshotBanner signedIn={signedIn} href={startHref}
        examplesHref={hasExamples ? HOME_ROUTES.examples : null} slots={slots} t={t} />

      {/* 7 — PACKSHOTY. `scroll-mt` so "Zobacz przykłady" lands with the
          heading clear of the sticky header. */}
      <section id="packshoty" aria-labelledby="home-packshots" className="scroll-mt-[calc(var(--header-h)+1rem)]">
        <SectionHead id="home-packshots" title={t("home2.sec.packshots")} sub={t("home2.sec.packshotsSub")}
          action={tryPill(packshotHref)} />
        <PackshotGallery slots={slots} />
      </section>

      {/* 8 — WIDEO UGC, while the switchboard lists the video module at all,
          badged with the module's own state. */}
      {ugc && <UgcBanner slots={slots} badge={ugc.badge} t={t} />}

      {/* 9 — REKLAMY I SOCIAL. The generator's advertising session is what
          makes these today, so that is where the button goes. */}
      <section aria-labelledby="home-ads">
        <SectionHead id="home-ads" title={t("home2.sec.ads")} sub={t("home2.sec.adsSub")}
          action={tryPill(startHref)} />
        <AdsGallery slots={slots} />
      </section>

      {/* 10 — THE VIDEO ROW: the video workflows the menu and /wideo list. No
          engine exists, so the cards are badged, the heading carries the badge
          and there is no "see all" into a door that is shut; the one line
          under it is the product's own careful sentence about why. */}
      {video.length > 0 && (
        <section aria-labelledby="home-video">
          <SectionHead id="home-video" title={t("home2.sec.video")} sub={t("home2.sec.videoSub")}
            action={videoSoon ? <Badge kind="soon" t={t} /> : undefined} />
          <div className="rail-x-sm sm:grid sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-6">
            {video.map((c) => (
              <EffectCard key={c.key} card={c} signedIn={signedIn} slots={slots} t={t}
                sizes="(max-width: 639px) 46vw, (max-width: 1023px) 32vw, 16vw" />
            ))}
          </div>
          {videoSoon && (
            <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-faint">{t("video.notReadyBody")}</p>
          )}
        </section>
      )}
    </div>
  );
}
