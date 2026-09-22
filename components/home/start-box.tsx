import Image from "next/image";
import { ArrowRight, Upload } from "lucide-react";
import type { HomeCard } from "@/lib/home-sections";
import { SAMPLE_PRODUCTS } from "@/lib/home-sections";
import { Gate } from "./gate";
import { cn } from "@/lib/utils";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * THE START BOX — the one thing on this page that is bigger than everything
 * else, because it is the one thing a seller came to do.
 *
 * IT IS A DOOR, AND IT SAYS SO. It is deliberately NOT a file input.
 *
 * A drop zone here would be a lie in two directions. For a signed-out visitor
 * there is no workspace to upload into, so the file would be read and thrown
 * away. For a signed-in customer the upload belongs to the generator's own
 * session — that is where the reference photos are tied to a product, priced,
 * and sent to a model — and there is no handoff from outside it, so a file
 * dropped here would still have to be picked again on the next screen. Asking
 * for a photograph and then losing it is worse than not asking.
 *
 * So the box looks like the beginning of the work and IS the beginning of the
 * work: one press opens Generator Grovshot, where the upload lives. The line
 * under the button says that, rather than leaving it to be discovered.
 *
 * The chips below are the six real categories. Each one opens its own
 * workspace, which is a different form with different defaults — not the same
 * generator with a different heading.
 *
 * THIS IS A SERVER COMPONENT, and it has to be.
 *
 * It was a client one, taking `t` from useI18n, and that crashed the page the
 * first time it rendered: a chip carries `icon`, which is a Lucide COMPONENT —
 * a function — and React cannot serialise a function across the server/client
 * boundary. The error names the icon rather than the boundary
 * ("Functions cannot be passed directly to Client Components … function Mail"),
 * which is why it is worth writing down here.
 *
 * Nothing on this box needs client state. The only interactive parts are the
 * links, and `Gate` is already the client component that owns that behaviour —
 * so the boundary belongs around the anchors, not around the section.
 */
export function StartBox({ signedIn, chips, href, t }: {
  signedIn: boolean;
  chips: readonly HomeCard[];
  /** Where the primary action goes. The registry's own route for the
   *  generator, passed in from the server so this file holds no route. */
  href: string;
  t: T;
}) {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <Gate
        href={href}
        signedIn={signedIn}
        ariaLabel={t("home2.startCta")}
        className={cn(
          "group relative block overflow-hidden rounded-2xl border border-dashed border-[rgb(var(--accent)/0.42)]",
          "bg-[rgb(var(--accent)/0.045)] px-5 py-8 text-center transition-colors duration-200",
          "hover:border-[rgb(var(--accent)/0.75)] hover:bg-[rgb(var(--accent)/0.08)] sm:py-10",
        )}
      >
        {/* Brand light from the top-left, the same wash the mega-menu promo
            card uses. Decorative and pointer-transparent. */}
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{
          background:
            "radial-gradient(30rem 12rem at 18% -10%, rgb(var(--accent) / 0.20), transparent 70%),"
            + "radial-gradient(26rem 12rem at 96% 110%, rgb(var(--violet) / 0.18), transparent 72%)",
        }} />
        <span className="relative flex flex-col items-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.14)] text-accent transition-transform duration-200 group-hover:scale-105">
            <Upload size={20} aria-hidden />
          </span>
          <span className="mt-3 max-w-md text-[13.5px] leading-relaxed text-muted sm:text-[15px]">
            {t("home2.startLead")}
          </span>
          <span className="cta mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold">
            {t("home2.startCta")}
            <ArrowRight size={15} aria-hidden />
          </span>
          {/* WHERE THE BUTTON GOES, in words. The box looks like an upload
              zone; this is the sentence that stops that looking like a bug. */}
          <span className="mt-2.5 text-[11.5px] leading-snug text-faint">
            {t("home2.startHint")}
          </span>
        </span>
      </Gate>

      {/* THE CATEGORY CHIPS — the real six, badged where a module is not
          running. An inert chip is drawn and not pressable, like every other
          inert thing on this page. */}
      <div className="rail-x mt-4 sm:flex sm:flex-wrap sm:justify-center sm:overflow-visible">
        {chips.map((c) => {
          const inert = c.badge !== null;
          const inner = (
            <>
              <c.icon size={14} aria-hidden className={inert ? "text-faint" : "text-accent"} />
              {t(c.titleKey)}
              {inert && (
                <span className="rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-faint">
                  {t("features.badgeSoon")}
                </span>
              )}
            </>
          );
          const cls = cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-[12.5px] font-semibold",
            inert ? "cursor-default text-faint opacity-70" : "text-ink transition-colors duration-200 hover:border-[rgb(var(--accent)/0.45)] hover:bg-[rgb(var(--accent)/0.07)]",
          );
          return inert
            ? <span key={c.key} className={cls} aria-disabled>{inner}</span>
            : <Gate key={c.key} href={c.href} signedIn={signedIn} className={cls}>{inner}</Gate>;
        })}
      </div>

      {/* NO PHOTOGRAPH OF YOUR OWN YET? The five thumbnails are the same
          example files the cards below use, so pressing one lands on a result
          the visitor has already seen a moment earlier on this page. */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="text-[11.5px] text-faint">{t("home2.noPhoto")}</span>
        {SAMPLE_PRODUCTS.map((src, i) => (
          <Gate key={src} href={href} signedIn={signedIn}
            className="group h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-[rgb(var(--glass-border)/0.22)] transition-transform duration-200 hover:scale-105"
            ariaLabel={t("home2.sample", { n: i + 1 })}>
            <Image src={src} alt="" width={40} height={40} sizes="40px"
              className="h-full w-full object-cover" />
          </Gate>
        ))}
      </div>
    </section>
  );
}
