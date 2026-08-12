"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean;
}) {
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
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className={cn(
        "glass relative m-0 max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl p-6 sm:m-4 sm:rounded-2xl",
        wide ? "sm:max-w-2xl" : "sm:max-w-md"
      )}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
            ✕
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
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted">{body}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>✕</Button>
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
        {show ? "hide" : "show"}
      </button>
    </div>
  );
}

export function StatCard({ label, value, hint, accent }: {
  label: string; value: string | number; hint?: string; accent?: boolean;
}) {
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className="truncate text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-0.5 font-display text-xl font-semibold tracking-tight sm:text-2xl", accent && "text-accent")}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-faint">{hint}</p>}
    </div>
  );
}
