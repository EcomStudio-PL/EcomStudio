"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/lib/notify";
import { generationTitle, toolName } from "@/lib/notifications/catalog";
import { cancelTile, dismissTile, retryTile, useInflight, type InflightTile as Tile } from "@/lib/inflight/store";
import { estimateParts, formatElapsed, isSlow } from "@/lib/inflight/types";
import { cn } from "@/lib/utils";

/** How long a finished tile shows its result before the real card takes its place. */
export const SETTLE_MS = 1_600;

/**
 * THE IN-PROGRESS TILE (Generacje w toku V2) — one component for every tool's
 * gallery and the library.
 *
 * It shows only what the server said: the real stage ("Retusz zdjęć · etap
 * 1/3"), a timer counted from the SERVER's start (so a refresh does not
 * reset it), the usual time when enough finished runs exist, and nothing
 * else — no percentage, no invented step. Done: the result fades in where the
 * tile was, with "Nowe" and a short glow, then the real card replaces it.
 * Failed: what happened in plain words, whether the credits came back (only
 * when the ledger says so), "Spróbuj ponownie" (the original request, after
 * a confirmation, at its price) and "Usuń".
 */
export function InflightTileView({ tile, aspect, onSettled, className, style }: {
  tile: Tile;
  /** width / height of what it will become. */
  aspect: number;
  /** A gallery on screen takes the results once the crossfade has played. */
  onSettled?: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t, locale } = useI18n();
  const outcome = tile.resolved?.outcome ?? null;
  const state = outcome === "done" || outcome === "partial" ? "done" : outcome ? "failed" : "running";
  const now = useNow(state === "running");
  // The server's clock: the timer counts from when the SERVER started it.
  const { offsetMs } = useInflight();
  const [confirming, setConfirming] = useState(false);
  /** The price the server asked for instead (a Miniaturka retry that reuses
   *  paid Retusz passes) — confirmed again before it is sent. */
  const [repriced, setRepriced] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const settled = useRef(false);

  useEffect(() => {
    if (state !== "done" || !onSettled || settled.current) return;
    const timer = setTimeout(() => { settled.current = true; onSettled(tile.id); }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [state, onSettled, tile.id]);

  const tool = toolName(tile.tool, t) ?? t("inflight.toolAny");
  const elapsed = Math.max(0, now + offsetMs - Date.parse(tile.startedAt));
  const slow = isSlow(elapsed, tile.estimateMs);
  const stage = tile.status === "queued"
    ? t("inflight.queued")
    : tile.stage
      ? `${t(`inflight.stage.${tile.stage}`)}${tile.step ? ` · ${t("inflight.step", { n: tile.step.index, m: tile.step.count })}` : ""}`
      : t("inflight.stage.generate");
  const thumb = tile.resolved?.items[0]?.thumbUrl ?? null;

  async function retry() {
    setBusy(true);
    const out = await retryTile(tile.id, repriced ?? undefined);
    setBusy(false);
    if (!out.ok && out.error === "price_changed" && typeof out.quotedTotal === "number" && out.quotedTotal !== repriced) {
      setRepriced(out.quotedTotal);
      return;
    }
    setConfirming(false);
    setRepriced(null);
    if (out.ok) return;
    if (out.error === "source_unavailable" || out.error === "missing_input" || out.error === "references_required") {
      toast.error(t("inflight.photosGone"));
    } else if (out.error === "concurrency_limit") {
      toast.error(limitText(t, locale, out.limit ?? 1));
    } else {
      const known = t(`studio.err.${out.error}`, {});
      toast.error(known && known !== `studio.err.${out.error}` ? known : t("common.error"));
    }
  }

  async function cancel() {
    setBusy(true);
    const ok = await cancelTile(tile.id);
    setBusy(false);
    if (!ok) toast.error(t("inflight.cancelFailed"));
  }

  const failedBody = (() => {
    const r = tile.resolved;
    if (!r) return "";
    if (r.outcome === "cancelled") return t("inflight.cancelled");
    if (r.refund === "refunded" && r.refundedCredits) return t("notif.v2.failedRefunded", { n: r.refundedCredits });
    if (r.refund === "refunded") return t("inflight.refunded");
    if (r.refund === "pending") return t("inflight.refundPending");
    if (r.refund === "not_charged") return t("notif.v2.failedNotCharged");
    return t("notif.v2.failedRetry");
  })();

  return (
    <div data-inflight-tile data-state={state} data-tool={tile.tool} data-stage={tile.stage ?? "queued"}
      className={cn("inflight-tile w-full min-w-0", className)}
      style={{ aspectRatio: String(aspect), ...style }}>
      {/* What a screen reader hears: the tool and the stage when they change,
          and the outcome — never the clock ticking every second. */}
      <span className="sr-only" aria-live="polite">
        {state === "running" ? `${tool} · ${stage}` : state === "done" ? generationTitle("done", tile.tool, t) : generationTitle("failed", tile.tool, t)}
      </span>
      {tile.preview && state !== "done" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="inflight-photo" src={tile.preview} alt="" aria-hidden />
      )}
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="inflight-result" src={thumb} alt="" aria-hidden />
      )}

      <div className="relative z-10 flex h-full min-h-0 flex-col p-2">
        <div className="flex min-h-0 justify-end gap-1">
          {state === "running" && tile.cancellable && (
            <button type="button" onClick={cancel} disabled={busy} data-inflight-cancel
              className="rounded-full bg-black/45 px-2 py-0.5 text-[10.5px] font-semibold text-white/90 backdrop-blur transition-colors hover:bg-black/65">
              {t("inflight.cancel")}
            </button>
          )}
          {state === "failed" && (
            <button type="button" onClick={() => dismissTile(tile.id)} data-inflight-remove
              aria-label={t("inflight.remove")} title={t("inflight.remove")}
              className="rounded-full bg-black/45 p-1 text-white/80 backdrop-blur transition-colors hover:bg-black/65 hover:text-white">
              <X size={11} aria-hidden />
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-center">
          {state === "running" && (
            <>
              <Loader2 size={18} aria-hidden className="text-white/85 motion-safe:animate-spin" />
              <span data-inflight-elapsed className="font-display text-[15px] font-semibold tabular-nums leading-none text-white">
                {formatElapsed(elapsed)}
              </span>
              {slow ? (
                <span data-inflight-slow className="line-clamp-3 max-w-[16rem] text-[10.5px] leading-snug text-white/75">{t("inflight.slow")}</span>
              ) : tile.estimateMs !== null ? (
                <span data-inflight-estimate className="text-[10.5px] text-white/65">
                  {(() => { const e = estimateParts(tile.estimateMs); return t(e.unit === "s" ? "inflight.usuallySec" : "inflight.usuallyMin", { n: e.n }); })()}
                </span>
              ) : null}
            </>
          )}
          {state === "failed" && (
            <>
              <AlertTriangle size={17} aria-hidden className="text-amber-300" />
              <span className="line-clamp-2 text-[11.5px] font-semibold leading-tight text-white">
                {tile.resolved?.outcome === "cancelled" ? t("inflight.cancelledTitle") : generationTitle("failed", tile.tool, t)}
              </span>
              <span data-inflight-refund={tile.resolved?.refund} className="line-clamp-3 max-w-[16rem] text-[10.5px] leading-snug text-white/70">{failedBody}</span>
              {tile.snapshot && tile.resolved?.outcome !== "cancelled" && (
                <span className="mt-1 flex flex-wrap items-center justify-center gap-1">
                  <button type="button" onClick={() => setConfirming(true)} disabled={busy} data-inflight-retry
                    className="inline-flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-[#111] transition-colors hover:bg-white">
                    <RotateCcw size={11} aria-hidden /> {t("inflight.retry")}
                  </button>
                  <button type="button" onClick={() => dismissTile(tile.id)} data-inflight-remove-text
                    className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/85 transition-colors hover:bg-white/20">
                    <Trash2 size={11} aria-hidden /> {t("inflight.remove")}
                  </button>
                </span>
              )}
            </>
          )}
        </div>

        {state === "done" ? (
          <span className="self-start rounded-md bg-accent px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white shadow-e2">
            {t("genv3.newBadge")}
          </span>
        ) : state === "running" ? (
          <span data-inflight-stage className="truncate text-left text-[10.5px] font-medium text-white/80">
            <span className="font-semibold text-white">{tool}</span> · {stage}
          </span>
        ) : (
          <span className="truncate text-left text-[10.5px] font-medium text-white/60">{tool}</span>
        )}
      </div>

      <Modal portal open={confirming} onClose={() => { setConfirming(false); setRepriced(null); }} title={t("inflight.retryTitle")}>
        <p className="text-sm leading-relaxed text-muted">
          {t("inflight.retryBody", { n: repriced ?? tile.snapshot?.credits ?? 0 })}
        </p>
        {repriced !== null && (
          <p className="mt-2 text-[12.5px] font-medium text-ink" data-inflight-repriced>{t("inflight.repriced", { n: repriced })}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => { setConfirming(false); setRepriced(null); }}
            className="h-10 rounded-xl px-4 text-sm font-semibold text-muted transition-colors hover:bg-raised hover:text-ink">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={retry} disabled={busy} data-inflight-retry-confirm
            className="cta inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold">
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {t("inflight.retryConfirm", { n: repriced ?? tile.snapshot?.credits ?? 0 })}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** "Masz 3 generacje w toku. To limit Twojego planu. …" with Polish plurals. */
export function limitText(t: ReturnType<typeof useI18n>["t"], locale: string, n: number): string {
  let form = "other";
  try { form = new Intl.PluralRules(locale).select(n); } catch { /* default */ }
  const key = `inflight.limit.${form}`;
  const text = t(key, { n });
  return text === key ? t("inflight.limit.other", { n }) : text;
}

/** The clock a running tile reads, ticking once a second only while it runs. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}
