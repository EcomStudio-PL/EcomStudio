"use client";
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE "O NAS" QUESTIONS — one open at a time, all of them closable.
 *
 * A real disclosure pattern rather than <details>: a button carrying
 * aria-expanded and aria-controls, and a region labelled by it, so a screen
 * reader announces "expanded / collapsed" and Enter/Space work as on any
 * button. The height animates through a grid row (0fr → 1fr) — no measuring,
 * no layout script — and the global reduced-motion rule turns it into an
 * instant change. Only the questions the server decided to show arrive here.
 */
export function AboutFaq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const base = useId();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface" data-about-faq>
      {items.map((it, i) => {
        const expanded = open === i;
        const btn = `${base}-q${i}`;
        const panel = `${base}-a${i}`;
        return (
          <li key={i} data-faq-item>
            <h3 className="m-0">
              <button type="button" id={btn} aria-expanded={expanded} aria-controls={panel}
                onClick={() => setOpen(expanded ? null : i)}
                className={cn(
                  "group flex w-full items-center justify-between gap-5 px-5 py-5 text-left font-display text-[15.5px] font-semibold leading-snug transition-colors sm:px-7",
                  "hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--accent)/0.55)]",
                )}>
                <span>{it.q}</span>
                <span aria-hidden className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-accent transition-transform duration-300",
                  expanded && "rotate-45 border-[rgb(var(--accent)/0.35)] bg-accent-soft/70",
                )}>
                  <Plus size={15} />
                </span>
              </button>
            </h3>
            <div id={panel} role="region" aria-labelledby={btn}
              className={cn("grid transition-[grid-template-rows] duration-300 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
              data-faq-answer={expanded ? "open" : "closed"}>
              <div className="overflow-hidden" {...(!expanded ? { inert: true } : {})}>
                <p className="px-5 pb-6 text-[14.5px] leading-relaxed text-muted sm:px-7">{it.a}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
