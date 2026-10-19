import { BrandMark } from "@/components/layout/brand";
import { IcePicture, type IceImage } from "@/components/seller-home/ice-slot-image";
import { cn } from "@/lib/utils";

/**
 * THE LONG PAGE'S QUIETER SECTIONS — server-rendered, no state of their own.
 *
 * Each one takes finished strings: whether it shows at all (its switch, its
 * required fields) is decided by the page before it is called, so nothing
 * here can render half a section.
 */

/**
 * ILE TO KOSZTUJE — one line, two prices.
 *
 * It states figures, so it ships HIDDEN (SECTION_DEFAULT_SHOWN.cost) and the
 * page renders it only when the owner switched it on AND all four parts are
 * filled: a comparison with one side blank is not a comparison. The GrovBase
 * side carries the brand magenta — the one figure the eye should end on.
 */
export function CostStrip({ left, leftValue, right, rightValue }: {
  left: string; leftValue: string; right: string; rightValue: string;
}) {
  return (
    <section data-launch-cost aria-label={`${left} ${leftValue} · ${right} ${rightValue}`}
      className="glass my-6 grid gap-3 rounded-2xl px-5 py-5 text-center sm:my-10 sm:grid-cols-2 sm:gap-0 sm:px-8 sm:py-6 lg:rounded-[clamp(18px,1.4vw,28px)]">
      <p className="flex flex-col items-center justify-center gap-1 sm:border-r sm:border-[rgb(var(--glass-border)/0.16)] sm:pr-6">
        <span className="text-[13.5px] text-muted sm:text-[14.5px]">{left}</span>
        <span className="font-display text-[1.5rem] font-semibold tracking-tight text-ink sm:text-[1.8rem]">{leftValue}</span>
      </p>
      <p className="flex flex-col items-center justify-center gap-1 sm:pl-6">
        <span className="text-[13.5px] text-muted sm:text-[14.5px]">{right}</span>
        <span className="font-display text-[1.5rem] font-semibold tracking-tight text-accent2 sm:text-[1.8rem]">{rightValue}</span>
      </p>
    </section>
  );
}

/**
 * KTO ZA TYM STOI — the trust tile.
 *
 * It speaks for real people, so it ships HIDDEN until the owner turns it on
 * (SECTION_DEFAULT_SHOWN.creators). The photo is the one the owner picked in
 * the builder; without one the brand mark stands in rather than a stock face.
 */
export function CreatorsTile({ eyebrow, title, body, signature, image }: {
  eyebrow: string; title: string; body: string; signature: string; image: IceImage | null;
}) {
  return (
    <section data-launch-creators aria-labelledby="launch-creators-title"
      className="glass my-6 flex flex-col items-center gap-5 rounded-3xl px-5 py-7 text-center sm:my-10 sm:flex-row sm:items-center sm:gap-8 sm:px-8 sm:py-8 sm:text-left lg:rounded-[clamp(20px,1.6vw,32px)]">
      <div className={cn(
        "relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-3xl sm:h-36 sm:w-36",
        image ? "ring-1 ring-[rgb(var(--glass-border)/0.2)]" : "bg-[rgb(var(--accent)/0.12)] ring-1 ring-[rgb(var(--accent)/0.25)]",
      )}>
        {image ? <IcePicture image={image} sizes="(min-width: 640px) 144px, 112px" /> : <BrandMark size={44} />}
      </div>
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent sm:text-[12px]">{eyebrow}</p>}
        <h2 id="launch-creators-title" className="mt-2 font-display text-[1.4rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.7rem]">
          {title}
        </h2>
        {body && <p className="mt-2.5 max-w-[62ch] text-[14.5px] leading-relaxed text-muted">{body}</p>}
        {signature && <p className="mt-3 text-[13.5px] font-semibold text-ink">{signature}</p>}
      </div>
    </section>
  );
}
