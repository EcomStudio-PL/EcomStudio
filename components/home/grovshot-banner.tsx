import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { GROVSHOT_SHOTS } from "@/lib/home-sections";
import { HOME_SLOT } from "@/lib/media-slots";
import type { SlotMap } from "@/lib/server/media-slots";
import { SlotMedia } from "@/components/media/slot-media";
import { Gate } from "./gate";
import { cn } from "@/lib/utils";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * THE GROVSHOT BANNER — the page's visual breakpoint, and the thing the
 * product is named after: Generator Grovshot, at the registry's own route.
 *
 * Centred wordmark, a one-line promise (a phone photo → a finished campaign),
 * two buttons: make one now, or scroll to the examples a few rows down.
 *
 * THE ART IS THE OPERATOR'S. `home.grovshot.art` is a media slot (Admin →
 * Media → Sekcje → Strona główna); what is put there becomes the banner's
 * ground, under a scrim that keeps the copy readable whatever the picture.
 * Until then the ground is PAINTED — brand light on the page's own surface —
 * and, on a wide screen, the three example frames this banner has always
 * carried (GROVSHOT_SHOTS: the product's own shipped examples, the same files
 * the cards use) stand at its sides. Art in the slot replaces both.
 *
 * EACH BUTTON ONLY WHEN ITS DOOR IS OPEN. The first opens the page's primary
 * action (absent when neither the generator nor the hub is open); the second
 * is an anchor on this page, shown only once the Packshoty gallery holds at
 * least one example — "Zobacz przykłady" over twelve empty frames would be a
 * promise the page cannot keep.
 */
export function GrovshotBanner({ signedIn, href, examplesHref, slots, t }: {
  signedIn: boolean;
  /** The page's primary action (lib/home-sections.ts `startHref`), or null. */
  href: string | null;
  /** The in-page anchor of the examples, or null while there are none. */
  examplesHref: string | null;
  slots: SlotMap;
  t: T;
}) {
  const art = slots.has(HOME_SLOT.grovshotArt);
  return (
    <section aria-labelledby="home-grovshot" className="relative isolate overflow-hidden rounded-2xl border border-[rgb(var(--accent)/0.28)] bg-surface">
      {art ? (
        <>
          {/* Decoration: `inert`, so a clip's native controls never take
              focus from behind the copy. */}
          <span aria-hidden inert className="absolute inset-0 -z-10 [&>span]:h-full">
            <SlotMedia slot={HOME_SLOT.grovshotArt} slots={slots} ratio="3/1" sizes="100vw"
              className="h-full" fallback={null} />
          </span>
          {/* The scrim: the picture may be anything, the copy must stay legible. */}
          <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_62%_80%_at_50%_50%,rgb(var(--bg)/0.72),rgb(var(--bg)/0.25)_78%)]" />
        </>
      ) : (
        <span aria-hidden className="absolute inset-0 -z-10" style={{
          background:
            "radial-gradient(40rem 18rem at 50% 118%, rgb(var(--accent) / 0.30), transparent 70%),"
            + "radial-gradient(30rem 16rem at 8% -10%, rgb(var(--violet) / 0.26), transparent 70%),"
            + "radial-gradient(30rem 16rem at 92% -10%, rgb(var(--accent-glow) / 0.20), transparent 70%)",
        }} />
      )}

      <div className="grid items-center gap-6 px-5 py-9 sm:px-8 sm:py-11 lg:grid-cols-[1fr_auto_1fr] lg:gap-8 lg:px-10 lg:py-10">
        {/* Left frame — a wide screen only, and only while the slot is empty. */}
        <div className="hidden justify-start lg:flex" aria-hidden>
          {!art && <Frame src={GROVSHOT_SHOTS[0]} label={t("home2.shot1")} className="-rotate-[5deg]" />}
        </div>

        <div className="min-w-0 text-center">
          <h2 id="home-grovshot"
            className="bg-[linear-gradient(100deg,rgb(var(--accent-glow)),rgb(var(--accent))_48%,rgb(var(--violet)))] bg-clip-text font-display text-[clamp(2.3rem,1.4rem+4.2vw,4.6rem)] font-bold uppercase leading-[0.95] tracking-[-0.02em] text-transparent">
            {t("home2.grovshotMark")}
          </h2>
          <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[14px] font-semibold text-ink sm:text-[16px]">
            <span>{t("home2.grovshotFrom")}</span>
            <ArrowRight size={16} aria-hidden className="text-accent" />
            <span>{t("home2.grovshotTo")}</span>
          </p>
          {(href || examplesHref) && (
            <div className="mt-5 flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center">
              {href && (
                <Gate href={href} signedIn={signedIn}
                  className="cta inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-2 text-center text-sm font-semibold leading-tight">
                  {t("home2.bannerCta")}
                </Gate>
              )}
              {/* An anchor on this page, not a route: it needs no account. */}
              {examplesHref && (
                <a href={examplesHref}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[rgb(var(--accent)/0.55)] px-6 py-2 text-center text-sm font-semibold leading-tight text-ink transition-colors duration-200 hover:bg-[rgb(var(--accent)/0.1)]">
                  {t("home2.seeExamples")}
                </a>
              )}
            </div>
          )}
        </div>

        {/* Right frames. */}
        <div className="hidden justify-end gap-2.5 lg:flex" aria-hidden>
          {!art && (
            <>
              <Frame src={GROVSHOT_SHOTS[1]} label={t("home2.shot2")} className="translate-y-2 rotate-[3deg]" />
              <Frame src={GROVSHOT_SHOTS[2]} label={t("home2.shot3")} className="-translate-y-1 rotate-[6deg]" />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** One shipped example, tilted, with the finish it shows named under it. */
function Frame({ src, label, className }: { src: string; label: string; className?: string }) {
  return (
    <span className={cn("relative block w-[6.5rem] shrink-0 overflow-hidden rounded-xl shadow-[0_18px_36px_-18px_rgb(0_0_0/0.7)] ring-1 ring-[rgb(var(--glass-border)/0.28)] xl:w-[7.5rem]", className)}
      style={{ aspectRatio: "4/5" }}>
      <Image src={src} alt="" fill sizes="120px" loading="lazy" className="object-cover" />
      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-[rgb(var(--bg)/0.72)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink backdrop-blur-sm">
        {label}
      </span>
    </span>
  );
}
