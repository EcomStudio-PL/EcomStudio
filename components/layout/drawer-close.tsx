"use client";
import { X } from "lucide-react";

/** Premium drawer close button: 40×40, bordered elevated surface, icon
 *  rotates 90° on hover/tap. */
export function DrawerClose({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-raised/70 text-muted transition-colors duration-200 hover:bg-raised hover:text-ink active:scale-95"
    >
      <X aria-hidden size={18} className="transition-transform duration-200 group-hover:rotate-90 group-active:rotate-90" />
    </button>
  );
}
