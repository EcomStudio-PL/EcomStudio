"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * DRAWER — one mobile menu component for the whole product.
 *
 * Customer and admin differ only in what goes inside; width, safe areas,
 * header treatment, close button, scroll behaviour and the closing animation
 * are defined once here. The panel is a single continuous surface: sections
 * are separated by spacing and typography, never by nesting cards inside
 * cards.
 */
export function Drawer({ open, onClose, label, header, children, footer }: {
  open: boolean;
  onClose: () => void;
  label: string;
  /** Account island. Receives the drawer's own close handler so the X can
   *  live inside it. */
  header: React.ReactNode | ((close: () => void) => React.ReactNode);
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [closing, setClosing] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setClosing(false); onClose(); }, 190);
  }, [onClose]);

  useEffect(() => { setClosing(false); onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, close]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={label}>
      <div
        className={cn("scrim absolute inset-0 backdrop-blur-[2px]", closing ? "animate-fade-out" : "animate-fade")}
        onClick={close}
      />
      <div className={cn(
        "drawer-panel absolute inset-y-0 left-0 flex w-[var(--drawer-w)] max-w-[88vw] flex-col",
        closing ? "animate-drawer-out" : "animate-drawer"
      )}>
        {/* The header is the account island; it hosts the close control so the
            X sits inside the island rather than floating over the panel. */}
        <div className="shrink-0 pb-3">
          {typeof header === "function" ? (header as (close: () => void) => React.ReactNode)(close) : header}
        </div>

        <nav className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
          {children}
        </nav>

        {footer && (
          <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The identity block both drawers use. Avatar, name, email and two facts —
 * plan/credits for a customer, role/KPIs for staff — laid out flush against
 * the drawer's own background, so it reads as the top of the menu rather
 * than a card dropped inside it.
 */
export function DrawerIdentity({ initial, name, email, badge, tone = "accent", facts }: {
  initial: string;
  name: string;
  email?: string;
  badge?: React.ReactNode;
  tone?: "accent" | "accent2";
  /** Two or three compact key/value facts shown under the identity. */
  facts?: { label: string; value: React.ReactNode; href?: string; tone?: "accent" | "accent2" | "ink" }[];
}) {
  return (
    <div className="pr-12">
      <div className="flex items-center gap-3">
        <span aria-hidden className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-bold shadow-e2",
          tone === "accent2" ? "bg-accent2-soft text-accent2" : "brand-gradient text-white"
        )}>
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{name}</p>
          {email && <p className="mt-0.5 truncate text-xs text-faint">{email}</p>}
        </div>
      </div>
      {badge && <div className="mt-3">{badge}</div>}
      {facts && facts.length > 0 && (
        <dl className={cn("mt-4 grid gap-x-4 gap-y-3", facts.length > 2 ? "grid-cols-3" : "grid-cols-2")}>
          {facts.map((f) => {
            const body = (
              <>
                <dt className="overline text-[10px]">{f.label}</dt>
                <dd className={cn("metric mt-0.5 truncate text-[15px]",
                  f.tone === "accent2" ? "text-accent2" : f.tone === "ink" ? "text-ink" : "text-accent")}>
                  {f.value}
                </dd>
              </>
            );
            return f.href
              ? <a key={f.label} href={f.href} className="min-w-0 rounded-lg transition-opacity hover:opacity-80">{body}</a>
              : <div key={f.label} className="min-w-0">{body}</div>;
          })}
        </dl>
      )}
    </div>
  );
}

/** Close control for the account island: 44px target, inside the surface. */
export function IslandClose({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors duration-200 hover:bg-[rgb(var(--ink)/0.08)] hover:text-ink active:scale-95"
    >
      <X aria-hidden size={19} />
    </button>
  );
}

/** Group label inside a drawer or sidebar: spacing and tracking do the work,
 *  no boxes and no rules. */
export function NavGroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="overline px-2.5 pb-1 pt-2.5 text-[9.5px] tracking-[0.2em] opacity-80">{children}</p>;
}
