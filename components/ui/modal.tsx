"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
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
  return (
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
}

export function ConfirmModal({ open, onClose, onConfirm, title, body, confirmLabel, danger, pending }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; body: string; confirmLabel: string; danger?: boolean; pending?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={title}>
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
export function SecretInput({ value, onChange, placeholder, id }: {
  value: string; onChange: (v: string) => void; placeholder?: string; id?: string;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="pr-16 font-mono text-xs"
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
