"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * DATA TABLE — the same rows in the shape each screen size can actually read.
 *
 * Phones get stacked records: the first cell becomes the record's title and
 * the rest become a two-column grid of labelled fields, so nothing forces the
 * page sideways and a screen still holds several records. From
 * `lg` up it is a real table inside its OWN scroll container — if a wide
 * admin table has to scroll, only the table scrolls, never the application.
 * A fading edge marks that there is more to the right.
 */
export function AdminTable({ headers, rows, empty, primary = 0 }: {
  headers: string[];
  rows: React.ReactNode[][];
  empty: string;
  /** Index of the column used as the record title on phones. */
  primary?: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [rows.length]);

  if (rows.length === 0) {
    return (
      <div className="panel rounded-2xl px-5 py-12 text-center text-sm text-muted">{empty}</div>
    );
  }

  return (
    <>
      {/* PHONE / TABLET — one record per card. The secondary fields sit in TWO
          columns, label above value: a seven-column table used to become seven
          full-width rows, so eight records were a minute of scrolling. Paired
          up they halve the card, and a short label over a short value reads
          faster than a label and a value pushed to opposite edges. */}
      <ul className="space-y-2 lg:hidden">
        {rows.map((cells, i) => (
          <li key={i} className="panel rounded-2xl p-3.5">
            <div className="min-w-0 text-sm font-semibold">{cells[primary]}</div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
              {cells.map((cell, j) => {
                if (j === primary || cell === null || cell === undefined || cell === "") return null;
                return (
                  <div key={j} className="min-w-0">
                    <dt className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                      {headers[j]}
                    </dt>
                    <dd className="mt-0.5 min-w-0 text-[13px] leading-snug text-ink">{cell}</dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>

      {/* DESKTOP — the table, scrolling inside its own container. */}
      <div className="panel relative hidden overflow-hidden rounded-2xl lg:block">
        <div ref={scroller} className="table-scroll thin-scroll max-h-[70dvh] overflow-y-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface/95 text-left text-[11px] uppercase tracking-[0.08em] text-faint backdrop-blur">
                {headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-5 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, i) => (
                <tr key={i} className="border-t border-line transition-colors hover:bg-raised/50">
                  {cells.map((c, j) => (
                    <td key={j} className={cn("px-5 py-3 align-middle", j === primary && "font-medium")}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Scroll affordance: a soft edge, only while there is more to see. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[rgb(var(--surface))] to-transparent transition-opacity duration-200",
            more ? "opacity-100" : "opacity-0"
          )}
        />
      </div>
    </>
  );
}
