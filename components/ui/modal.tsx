"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

/**
 * `portal` renders the dialog into document.body instead of in place.
 *
 * A `position: fixed` element is fixed to the VIEWPORT only while no ancestor
 * has a transform, filter or backdrop-filter. `.panel` carries a
 * backdrop-filter and `.panel-interactive` a hover/active transform, so a
 * dialog rendered inside such a card is fixed to the CARD: it is squeezed into
 * the card's box, painted under the next card in the grid (the filter also
 * makes each card its own stacking context, so `z-50` only counts inside it)
 * and moved by the hover transform while it is being clicked. The provider
 * key modal lived inside exactly such a card, which is why its input could not
 * be typed into or pasted into. Rendering at the body escapes every ancestor.
 */
export function Modal({ open, onClose, title, children, wide, portal }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean; portal?: boolean;
}) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  const dialog = (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scrim animate-fade absolute inset-0 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn(
        "overlay thin-scroll animate-sheet relative m-0 max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] w-full overflow-y-auto overscroll-contain",
        "rounded-t-2xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:m-4 sm:max-h-[88dvh] sm:rounded-2xl sm:p-6",
        wide ? "sm:max-w-2xl" : "sm:max-w-md"
      )}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
            <X size={16} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
  // `open` only ever turns true on the client (an interaction), so document
  // exists whenever a portal is asked for; the guard keeps SSR honest anyway.
  return portal && typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}

export function ConfirmModal({ open, onClose, onConfirm, title, body, confirmLabel, danger, pending, portal }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; body: string; confirmLabel: string; danger?: boolean; pending?: boolean; portal?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={title} portal={portal}>
      <p className="text-sm text-muted">{body}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/** Password-style secret input. Reveal shows only what was typed in this session —
 *  stored secrets are never fetched back from the server. */
export function SecretInput({ value, onChange, placeholder, id, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; id?: string; autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      {/*
        16 px on touch screens: iOS Safari zooms the page into any focused
        field smaller than that, which on a bottom-sheet dialog reads as a
        frozen screen. `new-password` + the manager opt-outs stop a saved
        LOGIN password being autofilled into an API-key field.
      */}
      <Input
        id={id}
        name={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        data-1p-ignore=""
        data-lpignore="true"
        className="pr-16 font-mono text-base sm:text-xs"
      />
      <button type="button" onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink">
        {show ? t("common.hide") : t("common.show")}
      </button>
    </div>
  );
}

/** Same label/value recipe as Stat (components/ui/stat.tsx) so admin stat
 *  rows and customer stat tiles share one typographic rhythm. */
export function StatCard({ label, value, hint, accent }: {
  label: string; value: string | number; hint?: string; accent?: boolean;
}) {
  return (
    <div className="panel rounded-2xl px-4 py-3.5">
      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className={cn("mt-2 truncate metric text-[1.6rem] leading-none", accent ? "text-accent" : "text-ink")}>{value}</p>
      {hint && <p className="mt-1.5 truncate text-[11px] text-faint">{hint}</p>}
    </div>
  );
}
