import Image from "next/image";
import { ArrowRight, Upload } from "lucide-react";
import type { HomeCard } from "@/lib/home-sections";
import { SAMPLE_PRODUCTS } from "@/lib/home-sections";
import { Gate } from "./gate";
import { DropDoor } from "./drop-door";
import { Chip } from "./product-cards";
import { cn } from "@/lib/utils";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * THE START BOX — the one thing on this page that is bigger than everything
 * else, because it is the one thing a seller came to do.
 *
 * IT IS A DOOR, AND IT OPENS THE GENERATOR. It is deliberately NOT a file
 * input. The upload belongs to Generator Grovshot's own session — that is
 * where reference photos are tied to a product, priced and sent to a model —
 * and there is no handoff into it from outside, so a file taken here would
 * have to be picked again on the next screen. One press (or one drop, see
 * DropDoor) opens the generator, where the upload lives; a visitor gets the
 * existing sign-in dialog pointed at it.
 *
 * THE HEADING IS THE PAGE'S <h1>. The page opens on the rail, which is
 * pictures; the sentence in this box is what the page is FOR, so it is the
 * one heading a screen reader and a search engine should find first.
 *
 * THE WHOLE BOX IS ONE TARGET without wrapping a heading inside a link: the
 * pill is the one focusable link, and a press anywhere else on the box does
 * what the pill does (DropDoor). `.cta` clips its own overflow, so a
 * stretched pseudo-element could not do this. A FILE DROPPED on the box opens
 * the same door instead of the browser opening the file — see DropDoor.
 *
 * THIS IS A SERVER COMPONENT. A chip carries `icon`, a Lucide COMPONENT, and a
 * function cannot cross into a client component as a prop ("Functions cannot
 * be passed directly to Client Components … function Mail"). The interactive
 * parts — Gate, DropDoor — are the client components, around the anchors.
 */
export function StartBox({ signedIn, chips, href, t }: {
  signedIn: boolean;
  chips: readonly HomeCard[];
  /** Where the primary action goes (lib/home-sections.ts `startHref`): the
   *  generator, or the tool hub when the generator is closed. Null when
   *  neither is open — the box is then drawn, and does not pretend to open. */
  href: string | null;
  t: T;
}) {
  return (
    <section className="relative isolate" aria-labelledby="home-start-title">
      {/* THE GLOW. Brand light pooled behind the box and fading into the page
          — the reference layout's purple-pink halo. Inside the section's own
          box, so it can never widen the page. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-4 bottom-0 -z-10" style={{
        background:
          "radial-gradient(ellipse 56% 58% at 50% 32%, rgb(var(--accent) / 0.28), transparent 72%),"
          + "radial-gradient(ellipse 34% 46% at 28% 24%, rgb(var(--violet) / 0.20), transparent 70%),"
          + "radial-gradient(ellipse 30% 40% at 74% 38%, rgb(var(--accent-glow) / 0.16), transparent 70%)",
      }} />

      <DropDoor href={href} signedIn={signedIn} className="group/drop mx-auto w-full max-w-[56rem]">
        <div className={cn(
          "relative overflow-hidden rounded-2xl border border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--surface)/0.55)] px-5 py-7 text-center backdrop-blur-sm sm:py-9",
          "shadow-[0_0_46px_-10px_rgb(var(--accent)/0.55),inset_0_0_42px_-20px_rgb(var(--accent)/0.55)]",
          href && "cursor-pointer transition-[border-color,box-shadow] duration-200 hover:border-[rgb(var(--accent)/0.8)]",
          "group-data-[over=1]/drop:border-accent group-data-[over=1]/drop:shadow-[0_0_64px_-6px_rgb(var(--accent)/0.7),inset_0_0_52px_-16px_rgb(var(--accent)/0.7)]",
        )}>
          <span aria-hidden className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.12)] text-accent ring-1 ring-[rgb(var(--accent)/0.25)]">
            <Upload size={18} />
          </span>
          <h1 id="home-start-title" className="mx-auto mt-3 max-w-md text-[14px] font-medium leading-relaxed text-muted sm:text-[15px]">
            {t("home2.startLead")}
          </h1>
          {href ? (
            <Gate href={href} signedIn={signedIn} ariaLabel={t("home2.startCta")}
              className="cta mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-full px-7 text-sm font-semibold">
              {t("home2.startCta")}
              <ArrowRight size={15} aria-hidden />
            </Gate>
          ) : (
            <span aria-disabled
              className="mt-4 inline-flex h-10 cursor-default items-center justify-center gap-2 rounded-full bg-raised px-7 text-sm font-semibold text-faint">
              {t("home2.startCta")}
              <ArrowRight size={15} aria-hidden />
            </span>
          )}
        </div>
      </DropDoor>

      {/* THE QUICK CHIPS — real tools, workflows and categories, badged where
          a module is not running. ONE LINE AT EVERY WIDTH: a bleeding
          carousel on a phone (`rail-x-sm`), and from `sm` up a row that is
          centred when it fits and scrolls sideways when it does not
          (`w-max max-w-full mx-auto`). Never a wrap — a wrap is decided by
          the font's width, so the row would jump from two lines to one the
          moment the web font replaced the fallback, and take the whole page
          below it along. */}
      {chips.length > 0 && (
        <div className="rail-x-sm mt-5 sm:mx-auto sm:flex sm:w-max sm:max-w-full sm:gap-2 sm:overflow-x-auto sm:p-1">
          {chips.map((c) => <Chip key={c.key} card={c} signedIn={signedIn} t={t} />)}
        </div>
      )}

      {/* NO PHOTOGRAPH OF YOUR OWN YET? The same example files the cards use,
          round, each one a door into the generator. On a phone the sentence
          takes its own line so the thumbnails never wrap under it unevenly. */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2.5">
        <span className="basis-full text-center text-[12px] text-faint sm:basis-auto">{t("home2.noPhoto")}</span>
        <span className="flex items-center gap-2.5">
          {SAMPLE_PRODUCTS.map((src, i) => {
            const thumb = <Image src={src} alt="" width={44} height={44} sizes="44px" className="h-full w-full object-cover" />;
            const cls = "block h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-[rgb(var(--glass-border)/0.3)] sm:h-11 sm:w-11";
            return href ? (
              <Gate key={src} href={href} signedIn={signedIn}
                className={cn(cls, "transition-transform duration-200 hover:scale-105 hover:ring-[rgb(var(--accent)/0.6)]")}
                ariaLabel={t("home2.sample", { n: i + 1 })}>
                {thumb}
              </Gate>
            ) : <span key={src} className={cls} aria-hidden>{thumb}</span>;
          })}
        </span>
      </div>
    </section>
  );
}
