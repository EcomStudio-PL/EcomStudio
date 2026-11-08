"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Workflow } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { adoptAccepted } from "@/lib/inflight/store";
import type { GalleryItem } from "@/components/genv3/types";
import { cn } from "@/lib/utils";

/**
 * GROVBASE SHOT — "Wygeneruj ponownie · N kr." on a gallery tile of a
 * lifestyle shot. One more generation of THAT shot (the order's prompt and
 * references), a separate new image: the old one stays. Two steps, because a
 * phone has no hover and one tap must never spend credits: the first click
 * arms the button ("Potwierdź · N kr."), the second sends. A confirmed click
 * carries its own request id, so a double submit is one generation; the
 * server re-checks ownership and the price (`price_changed` → the new price is
 * shown and must be confirmed again). The credits follow the order's own
 * path: reserved by the run, charged only when the image is delivered,
 * returned otherwise. The new image arrives as an in-progress tile.
 */
type Reply = { ok: boolean; runId?: string; error?: string; quote?: { total?: number } };
const ERRORS = ["insufficient_credits", "price_changed", "too_many_runs", "rate_limited", "concurrency_limit", "order_in_progress"];
const ARM_MS = 5_000;

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null);

export function ShotRegenButton({ item, compact, variant = "tile" }: { item: GalleryItem; compact: boolean; variant?: "tile" | "cta" }) {
  const { t } = useI18n();
  const shot = item.grovshot;
  const [price, setPrice] = useState<number | null>(shot?.price ?? null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(id);
  }, [armed]);
  if (!shot) return null;

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/grovshot/runs/${shot.runId}/regenerate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ shot: shot.shot, quotedTotal: price, requestId: request.current }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as Reply;
      if (!json.ok || !json.runId) {
        if (json.error === "price_changed" && typeof json.quote?.total === "number") {
          // The price shown was not the price now: show it, confirm again.
          setPrice(json.quote.total);
          request.current = newRequestId();
          toast.message(t("gsv2.sets.regenPriceChanged", { n: json.quote.total }));
          return;
        }
        setArmed(false);
        toast.error(t(`gsv2.sets.err.${ERRORS.includes(json.error ?? "") ? json.error : "generic"}`));
        return;
      }
      setArmed(false);
      adoptAccepted({
        id: json.runId, kind: "run", tool: "prompts", operation: "grovshot_v2", expected: 1,
        ratio: item.ratio, preview: item.thumbUrl,
      });
      toast.success(t("gsv2.sets.regenStarted"));
    } catch {
      setArmed(false);
      toast.error(t("gsv2.sets.err.generic"));
    } finally {
      setBusy(false);
    }
  };

  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (!armed) {
      request.current = newRequestId();
      setArmed(true);
      return;
    }
    void send();
  };
  const label = armed
    ? (price !== null ? t("gsv2.sets.regenArm", { n: price }) : t("gsv2.sets.regenArmNoPrice"))
    : (price !== null ? t("gsv2.sets.regenCta", { n: price }) : t("gsv2.sets.regen"));
  if (variant === "cta") {
    // The image view's full-width action (the same two steps).
    return (
      <button type="button" onClick={click} disabled={busy} data-shot-regen data-armed={armed || undefined} data-regen-cta
        className={cn("flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold disabled:opacity-70",
          armed ? "bg-accent text-white hover:bg-accent/90" : "cta")}>
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
        {label}
      </button>
    );
  }
  return (
    <div className={cn("card-rail absolute inset-x-0 z-10 flex justify-center px-2", item.fresh ? "bottom-8" : "bottom-2", armed && "!opacity-100")}>
      <button type="button" onClick={click} disabled={busy} data-shot-regen data-armed={armed || undefined}
        aria-label={label} title={label}
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border font-semibold shadow-e2 backdrop-blur-md transition-colors disabled:opacity-70",
          compact ? "px-2 py-1 text-[10px]" : "px-2 py-1.5 text-[10.5px] sm:px-3 sm:text-[11.5px]",
          armed ? "border-accent bg-accent text-white hover:bg-accent/90" : "border-white/20 bg-black/55 text-white hover:bg-black/70",
        )}>
        {busy ? <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden /> : <RefreshCw size={12} className="shrink-0" aria-hidden />}
        {/* On a narrow tile only the action's words shorten: the price is always readable. */}
        <span aria-hidden className="min-w-0 truncate">{armed ? t("gsv2.sets.regenArmNoPrice") : t("gsv2.sets.regen")}</span>
        {price !== null && <span aria-hidden className="shrink-0">{t("gsv2.sets.regenPrice", { n: price })}</span>}
      </button>
    </div>
  );
}

/** Admins only: the order's process view (Admin → GrovBase Shot) from a standard tile. */
export function ShotProcessLink({ item }: { item: GalleryItem }) {
  const { t } = useI18n();
  if (!item.grovshot) return null;
  return (
    <Link href={`/admin/grovshot/${item.grovshot.runId}`} onClick={(e) => e.stopPropagation()} data-shot-process
      title={t("gsv2.sets.process")} aria-label={t("gsv2.sets.process")}
      className="card-rail absolute left-2 top-10 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-black/45 text-white/85 backdrop-blur-md hover:bg-black/65 hover:text-white">
      <Workflow size={13} aria-hidden />
    </Link>
  );
}
