"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { legalTocIds, type LegalTocEntry } from "./legal-view";

/**
 * THE TABLE OF CONTENTS OF A LEGAL DOCUMENT.
 *
 * The Regulamin is nine chapters, thirty-four paragraphs, two annexes and a
 * version history; nobody reads it top to bottom, they come looking for one
 * clause. So the headings the text already has (parseLegalText) become two
 * shapes of the same list:
 *
 *   DESKTOP — a sticky column with its own scroll, so a long list never
 *   pushes past the bottom of the window, with the section being read
 *   highlighted.
 *
 *   PHONE — a closed <details> ABOVE the article. It is placed there in the
 *   markup, not moved there with CSS order: the previous table of contents
 *   relied on `order-first` inside a container that was only a grid from
 *   `lg` up, so on a phone it ended up under the document it was meant to
 *   introduce. A <details> also opens and closes without any JavaScript.
 *
 * The highlight is IntersectionObserver work — no scroll listener, and
 * positions are read only when a heading crosses the reading band or the
 * end of the text comes into view. Without JavaScript the links still work;
 * only the highlight is missing.
 */

/** The heading being read: the first one inside the band just under the
 *  sticky header, or else the last one already scrolled past. Once the end
 *  of the text is on screen (`[data-legal-end]`, right after the article),
 *  the last heading on screen — the final sections are too short to ever
 *  reach the top of the window. */
function useActiveHeading(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || ids.length === 0) return;
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const inBand = new Set<string>();
    let atEnd = false;
    const pick = () => {
      if (atEnd) {
        let last: string | null = null;
        for (const el of els) if (el.getBoundingClientRect().top < window.innerHeight * 0.85) last = el.id;
        setActive(last);
        return;
      }
      const first = els.find((el) => inBand.has(el.id));
      if (first) { setActive(first.id); return; }
      // Between two headings: the last one above the band is still the
      // section on screen.
      let above: string | null = null;
      for (const el of els) {
        if (el.getBoundingClientRect().top < 96) above = el.id;
        else break;
      }
      setActive(above);
    };
    const band = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) inBand.add(e.target.id);
        else inBand.delete(e.target.id);
      }
      pick();
    }, { rootMargin: "-88px 0px -62% 0px" });
    for (const el of els) band.observe(el);
    const end = document.querySelector("[data-legal-end]");
    const tail = end ? new IntersectionObserver(([e]) => { atEnd = e.isIntersecting; pick(); }) : null;
    if (end && tail) tail.observe(end);
    return () => { band.disconnect(); tail?.disconnect(); };
  }, [ids]);
  return active;
}

/*
 * TWO LANGUAGES ON ONE LIST. The entries are the document's own headings, so
 * they are in the language of the TEXT (`lang` — Polish for an English reader
 * on ?lang=pl), while the label around them ("Contents") is in the reader's
 * interface language, which the page itself already declares. A screen
 * reader then pronounces "Rozdział I" as Polish, not as English.
 */
export function LegalTocAside({ entries, label, lang }: { entries: LegalTocEntry[]; label: string; lang: string }) {
  const ids = useMemo(() => legalTocIds(entries), [entries]);
  const active = useActiveHeading(ids);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted entry inside the column's own scroll, without
  // scrollIntoView (which would also scroll the page the reader is moving).
  useEffect(() => {
    const box = listRef.current;
    if (!box || !active) return;
    const link = box.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(active)}"]`);
    if (!link) return;
    const top = link.offsetTop;
    if (top < box.scrollTop + 24 || top > box.scrollTop + box.clientHeight - 48) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [active]);

  if (entries.length === 0) return null;
  return (
    <nav aria-label={label} data-legal-toc="aside" className="sticky top-24">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <div ref={listRef}
        className="relative mt-3 max-h-[calc(100dvh-9.5rem)] overflow-y-auto overscroll-contain pb-6 pr-2 [scrollbar-width:thin]">
        <TocList entries={entries} active={active} lang={lang} />
      </div>
    </nav>
  );
}

export function LegalTocMobile({ entries, label, lang }: { entries: LegalTocEntry[]; label: string; lang: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  if (entries.length === 0) return null;
  return (
    <details ref={ref} data-legal-toc="mobile"
      className="group rounded-2xl border border-line bg-sunken/50 open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[14px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown size={17} aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      {/* A tap on a link jumps to the clause and folds the list away, so the
          reader lands on the text instead of under an open menu. */}
      <nav aria-label={label}
        onClick={(e) => { if ((e.target as HTMLElement).closest("a") && ref.current) ref.current.open = false; }}
        className="max-h-[60dvh] overflow-y-auto overscroll-contain border-t border-line px-2 pb-3 pt-2">
        <TocList entries={entries} active={null} lang={lang} />
      </nav>
    </details>
  );
}

function TocList({ entries, active, lang }: { entries: LegalTocEntry[]; active: string | null; lang: string }) {
  return (
    <ol lang={lang} className="space-y-0.5">
      {entries.map((entry) => {
        const here = active === entry.id;
        const inside = here || entry.children.some((c) => c.id === active);
        return (
          <li key={entry.id}>
            <a href={`#${entry.id}`} data-toc-id={entry.id} {...(here ? { "aria-current": "location" as const } : {})}
              className={`block rounded-lg border-l-2 px-3 py-1.5 text-[13.5px] leading-snug transition-colors ${
                inside ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"} ${here ? "bg-accent-soft/40 font-semibold" : "font-medium"}`}>
              {entry.text}
            </a>
            {entry.children.length > 0 && (
              <ol className="mb-1.5 ml-3 mt-0.5 space-y-px border-l border-line/80">
                {entry.children.map((child) => {
                  const on = active === child.id;
                  return (
                    <li key={child.id}>
                      <a href={`#${child.id}`} data-toc-id={child.id} {...(on ? { "aria-current": "location" as const } : {})}
                        className={`-ml-px block border-l-2 py-1 pl-3 pr-2 text-[12.5px] leading-snug transition-colors ${
                          on ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                        {child.text}
                      </a>
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
