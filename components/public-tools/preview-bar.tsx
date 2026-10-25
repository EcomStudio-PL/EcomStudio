"use client";
import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { GUEST_PREVIEW_ROUTE } from "@/lib/public-tools";

/**
 * "Podgląd jako gość · Wyjdź z podglądu" — the strip an admin sees while
 * looking at the visitor's interface. Discreet, but always there: the admin
 * must never forget they are looking at a simulation, and leaving must always
 * be one click (the route below is the one write the middleware lets through
 * during the preview).
 */
export function GuestPreviewBar() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const exit = async () => {
    setBusy(true);
    try {
      await fetch(GUEST_PREVIEW_ROUTE, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: false }),
      });
    } finally {
      // A full load: every server component reads the cookie again.
      window.location.reload();
    }
  };
  return (
    <div data-guest-preview-bar role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-[rgb(var(--warning)/0.14)] px-3 py-1.5 text-[12.5px] font-semibold text-warning backdrop-blur">
      <span className="inline-flex items-center gap-1.5"><Eye size={14} aria-hidden /> {t("publicTools.preview.label")}</span>
      <button type="button" onClick={() => void exit()} disabled={busy} data-guest-preview-exit
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[rgb(var(--warning)/0.4)] bg-surface px-2.5 text-[12px] font-semibold text-ink hover:bg-raised disabled:opacity-60">
        {busy && <Loader2 size={12} className="animate-spin" aria-hidden />}
        {t("publicTools.preview.exit")}
      </button>
    </div>
  );
}
