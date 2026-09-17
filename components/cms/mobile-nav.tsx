"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

/**
 * THE PUBLIC MENU ON A PHONE.
 *
 * Six marketing links do not fit at 360px, so below `lg` they collapse behind
 * one button. Deliberately the smallest thing that works: a state flag, a
 * panel, and the two behaviours a person expects from a menu — Escape closes
 * it, and the page behind it does not scroll while it is open.
 *
 * NOT the app's drawer. That one knows about workspaces, credits and the
 * bottom dock, and none of it belongs on a page a stranger is reading.
 */
export function MobileNav({ links, label, className }: {
  links: { label: string; url: string }[];
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // Restored rather than cleared: another component may own it already.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(true)} aria-label={label}
        aria-expanded={open} aria-haspopup="dialog"
        className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink">
        <Menu size={20} aria-hidden />
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label={label}
          className="fixed inset-0 z-50 flex flex-col bg-bg">
          <div className="flex h-[60px] items-center justify-end px-[var(--page-x,1rem)]">
            <button type="button" onClick={() => setOpen(false)} aria-label="Zamknij"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink">
              <X size={20} aria-hidden />
            </button>
          </div>
          <nav className="flex flex-col gap-1 px-[var(--page-x,1rem)] pt-4">
            {links.map((l) => (
              <Link key={l.url} href={l.url} onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3.5 text-[17px] font-medium transition-colors hover:bg-raised">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
