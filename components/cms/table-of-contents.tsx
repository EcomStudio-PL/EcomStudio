"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * NAVIGATING A LONG DOCUMENT.
 *
 * A Regulamin is twenty clauses and nobody reads it top to bottom — they come
 * looking for one. On a desktop that is a sticky column beside the text; on a
 * phone there is no room for a column, so it is a dropdown above it. Same
 * links, same ids, two shapes.
 *
 * The ids come from the sanitised markup itself (see anchorHeadings in
 * blocks.tsx), so a clause added in the editor appears here without anybody
 * maintaining a second list.
 */
export function TableOfContents({ items, label }: {
  items: { id: string; text: string }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <>
      {/* PHONE: a disclosure above the document. */}
      <nav aria-label={label} className="order-first mb-6 lg:hidden">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-[13.5px] font-semibold">
          {label}
          <ChevronDown size={16} aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
        {open && (
          <ol className="mt-2 space-y-1 rounded-xl border border-line bg-surface p-2">
            {items.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-[13.5px] text-muted transition-colors hover:bg-raised hover:text-ink">
                  {item.text}
                </a>
              </li>
            ))}
          </ol>
        )}
      </nav>

      {/* DESKTOP: a sticky column that stays with the reader. */}
      <nav aria-label={label} className="hidden lg:block">
        <div className="sticky top-24">
          <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</h2>
          <ol className="mt-3 space-y-1.5 border-l border-line">
            {items.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`}
                  className="block border-l-2 border-transparent -ml-px py-1 pl-3 text-[13px] leading-snug text-muted transition-colors hover:border-accent hover:text-ink">
                  {item.text}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
    </>
  );
}
