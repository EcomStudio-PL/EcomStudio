import Image from "next/image";
import { ArrowRight, Sparkles } from "lucide-react";
import { GROVSHOT_SHOTS } from "@/lib/home-sections";
import { Gate } from "./gate";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * THE ONE BANNER ON THIS PAGE, and it advertises the thing the product is
 * actually named after: Generator Grovshot.
 *
 * The name is not decoration and is not invented here — `mega.createImage` is
 * what the mega-menu's primary CTA has said since the generator shipped, and
 * `/prompts` is the route the feature registry governs. If that name changes,
 * it changes in the dictionary and this banner follows.
 *
 * WHAT IT SHOWS: one product, three briefs. That is the claim the generator
 * makes — a seller hands over a photograph and gets a set of finished shots in
 * different styles, not one picture — and three frames side by side is the
 * only way to say it without a paragraph.
 *
 * It is NOT a second hero. The start box above is where the work begins; this
 * is a section like the others, with the same left-aligned heading, and it
 * stops short of the full-bleed glow the reference layout uses because this is
 * a product surface rather than a campaign page.
 */
export function GrovshotBanner({ signedIn, href, t }: {
  signedIn: boolean; href: string; t: T;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line">
      {/* THE GROUND IS PAINTED, NOT PHOTOGRAPHED.
          A wide backdrop image here would be a third download for a decorative
          layer that ends up at 28% opacity under a scrim anyway — and there is
          no photograph in this repo that is ABOUT anything, which is the only
          reason a picture belongs on this page at all. Brand light on the
          page's own surface costs nothing and keeps the copy's contrast fixed
          at every width instead of depending on where the light happened to
          fall in a photo. */}
      <span aria-hidden className="absolute inset-0" style={{
        background:
          "radial-gradient(38rem 20rem at 6% 112%, rgb(var(--accent) / 0.26), transparent 68%),"
          + "radial-gradient(34rem 18rem at 94% -14%, rgb(var(--violet) / 0.24), transparent 70%),"
          + "linear-gradient(100deg, rgb(var(--ink) / 0.04), transparent 55%)",
      }} />

      <div className="relative flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:p-9">
        <div className="min-w-0 lg:max-w-[34rem]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-accent">
            <Sparkles size={11} aria-hidden />
            {t("home2.bannerTag")}
          </span>
          <h2 className="mt-3 font-display text-[clamp(1.5rem,1.05rem+1.9vw,2.6rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-ink">
            {t("mega.createImage")}
          </h2>
          <p className="mt-2 max-w-lg text-[13.5px] leading-relaxed text-muted sm:text-[14.5px]">
            {t("home2.bannerLead")}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Gate href={href} signedIn={signedIn}
              className="cta inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold">
              {t("home2.bannerCta")}
              <ArrowRight size={15} aria-hidden />
            </Gate>
            <Gate href="/tools" signedIn={signedIn}
              className="plate inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-ink transition-colors duration-200 hover:border-[rgb(var(--accent)/0.45)] hover:bg-raised">
              {t("nav.allTools")}
            </Gate>
          </div>
        </div>

        {/* THREE RESULTS, ONE PRODUCT. Hidden below `sm`: at phone width the
            frames would be 70px wide, which shows nothing and costs three
            requests. The claim is carried by the copy there. */}
        <div className="hidden shrink-0 gap-2.5 sm:flex">
          {GROVSHOT_SHOTS.map((src, i) => (
            <span key={src}
              className="relative block w-[7.5rem] overflow-hidden rounded-xl ring-1 ring-[rgb(var(--glass-border)/0.22)] lg:w-[9rem]"
              style={{ aspectRatio: "4/5" }}>
              <Image src={src} alt="" fill sizes="(max-width: 1024px) 120px, 144px"
                className="object-cover" />
              <span aria-hidden
                className="absolute bottom-1.5 left-1.5 rounded-md bg-[rgb(var(--bg)/0.72)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink backdrop-blur-sm">
                {t(`home2.shot${i + 1}`)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
