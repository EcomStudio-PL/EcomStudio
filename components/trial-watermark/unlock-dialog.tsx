"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { saveImageFrom } from "@/lib/save-image";
import { patchLibrary } from "@/lib/library-cache";
import { trialPaywallAction } from "@/app/actions/trial-watermark";
import type { GalleryTrial, TrialPaywallPlan, TrialUnlockSurface } from "@/lib/trial-watermark/types";
import { fetchTrialStatus, pause, postTrialUnlock } from "./api";
import {
  daysLeftOf, errorKey, needsFreshLink, nextConfirmDelay, patchAsset, unlockedPatch,
  type TrialAssetPatch,
} from "./model";
import { TrialPaywall } from "./paywall";
import { TrialDialogShell } from "./shell";

/** What the dialog needs to know about the image — any gallery item will do. */
export type TrialUnlockTarget = {
  assetId: string;
  url?: string;
  thumbUrl?: string;
  previewUrl?: string;
  product?: string | null;
  model?: string | null;
  trial?: GalleryTrial | null;
};

/** `wasLocked` is false when the image had been unlocked already (fresh links only). */
export type TrialUnlocked = (assetId: string, patch: TrialAssetPatch, info: { wasLocked: boolean }) => void;

type Stage =
  | { kind: "checking" }
  | { kind: "paywall"; paywallId: string | null; daysLeft: number | null; plans: TrialPaywallPlan[]; hasLiveSubscription: boolean; pending: boolean }
  /** After checkout: asking the status route until the plan is active. `timedOut` = "still processing". */
  | { kind: "confirming"; timedOut: boolean }
  | { kind: "unlocking" }
  | { kind: "success"; preview: string; downloadUrl: string | null; receivedAt: number }
  /** The original is gone — or was never kept. A neutral line, nothing to buy. */
  | { kind: "expired"; reason: "expired" | "unavailable" }
  | { kind: "error"; code: string; retry: "check" | "unlock" | "confirm" };

/**
 * "USUŃ ZNAK WODNY" — one image, from the click to the clean file.
 *
 *   checking   → trialPaywallAction: is this image still locked, may this
 *                workspace unlock it now?
 *   paywall    → no active plan: the image, the plans, "Wybierz plan";
 *   confirming → back from the checkout (/library?unlock=…): the status route
 *                is asked with a backoff for about two minutes, because the
 *                webhook that activates the plan lands when it lands;
 *   unlocking  → the server swaps the marked file for the clean one;
 *   success    → the clean picture and "Pobierz";
 *   expired    → the original is gone: a neutral line, no offer;
 *   error      → what failed and "Spróbuj ponownie".
 *
 * The server decides everything that matters. This component only shows the
 * verdicts and, after an unlock, hands the new links to whoever owns the card
 * (and to the library cache, so /library never paints the marked file again).
 */
export function TrialUnlockDialog({ target, surface, confirming, onClose, onUnlocked }: {
  target: TrialUnlockTarget;
  surface: TrialUnlockSurface;
  /** Open straight into the post-checkout wait instead of the paywall check. */
  confirming: boolean;
  onClose: () => void;
  onUnlocked: TrialUnlocked;
}) {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>(confirming ? { kind: "confirming", timedOut: false } : { kind: "checking" });
  // The status route signs a thumbnail too: the post-checkout dialog may open
  // for an image the page has not loaded yet.
  const [statusThumb, setStatusThumb] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // Plans from the last paywall, reused if an unlock is refused afterwards.
  const lastPaywall = useRef<Extract<Stage, { kind: "paywall" }> | null>(null);
  const paywallRetried = useRef(false);
  // `unlock` may need the paywall check and the check may end in an unlock;
  // the ref breaks the cycle between the two callbacks.
  const checkRef = useRef<() => Promise<void>>(async () => {});
  const report = useRef(onUnlocked);
  report.current = onUnlocked;

  const { assetId } = target;
  const watermarked = target.previewUrl || target.thumbUrl || target.url || statusThumb;
  const days = daysLeftOf(target.trial);

  const showPaywall = useCallback((s: Omit<Extract<Stage, { kind: "paywall" }>, "kind">) => {
    const next = { kind: "paywall" as const, ...s };
    if (s.plans.length > 0) lastPaywall.current = next;
    setStage(next);
  }, []);

  const unlock = useCallback(async (wasLocked: boolean) => {
    setStage({ kind: "unlocking" });
    const r = await postTrialUnlock(assetId, surface);
    if (r.state === "unlocked") {
      // Reported even if the dialog was closed meanwhile: the marked file is
      // gone on the server now, and a card left pointing at it would break.
      report.current(assetId, unlockedPatch(r), { wasLocked });
      if (!alive.current) return;
      setStage({ kind: "success", preview: r.previewUrl || r.thumbUrl || r.url, downloadUrl: r.downloadUrl, receivedAt: Date.now() });
      return;
    }
    if (!alive.current) return;
    if (r.state === "expired") { setStage({ kind: "expired", reason: "expired" }); return; }
    if (r.state === "unavailable" || r.state === "not_found") { setStage({ kind: "expired", reason: "unavailable" }); return; }
    if (r.state === "not_entitled") {
      const prev = lastPaywall.current;
      if (prev || r.pending || r.hasLiveSubscription || paywallRetried.current) {
        showPaywall({
          paywallId: prev?.paywallId ?? null, daysLeft: prev?.daysLeft ?? days, plans: prev?.plans ?? [],
          hasLiveSubscription: r.hasLiveSubscription, pending: r.pending,
        });
        return;
      }
      // Refused without a paywall in hand (the plan lapsed between the two
      // calls): fetch the offer once — never in a loop.
      paywallRetried.current = true;
      void checkRef.current();
      return;
    }
    setStage({ kind: "error", code: r.state === "error" ? r.error : "generic", retry: "unlock" });
  }, [assetId, surface, days, showPaywall]);

  const check = useCallback(async () => {
    setStage({ kind: "checking" });
    let res: Awaited<ReturnType<typeof trialPaywallAction>>;
    try { res = await trialPaywallAction({ assetId, surface }); } catch { res = { kind: "error" }; }
    if (!alive.current) return;
    if (res.kind === "entitled") { await unlock(true); return; }
    if (res.kind === "paywall") {
      showPaywall({ paywallId: res.paywallId, daysLeft: res.daysLeft, plans: res.plans, hasLiveSubscription: res.hasLiveSubscription, pending: res.pending });
      return;
    }
    if (res.kind === "not_locked") {
      // Already unlocked (in another tab, by a teammate): the unlock answers
      // idempotently with fresh links, which is what the card needs.
      if (res.state === "unlocked") { await unlock(false); return; }
      setStage({ kind: "expired", reason: res.state === "expired" ? "expired" : "unavailable" });
      return;
    }
    setStage({ kind: "error", code: "generic", retry: "check" });
  }, [assetId, surface, unlock, showPaywall]);
  checkRef.current = check;

  /** Back from the checkout: ask until the plan is active, then unlock. */
  const confirm = useCallback(async () => {
    setStage({ kind: "confirming", timedOut: false });
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const s = await fetchTrialStatus(assetId);
      if (!alive.current) return;
      if (s) {
        if (s.thumbUrl) setStatusThumb(s.thumbUrl);
        if (s.state === "expired") { setStage({ kind: "expired", reason: "expired" }); return; }
        if (s.state === "unavailable" || s.state === "not_found") { setStage({ kind: "expired", reason: "unavailable" }); return; }
        if (s.state === "unlocked") { await unlock(false); return; }
        if (s.entitled) { await unlock(true); return; }
      }
      const wait = nextConfirmDelay(attempt, Date.now() - started);
      if (wait === null) { setStage({ kind: "confirming", timedOut: true }); return; }
      if (!(await pause(wait, () => alive.current))) return;
    }
  }, [assetId, unlock]);

  // One run per opening; the dialog is remounted (keyed) for the next one.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (confirming ? confirm() : check());
  }, [confirming, confirm, check]);

  async function download() {
    if (stage.kind !== "success" || downloading) return;
    setDownloading(true);
    try {
      let url = stage.downloadUrl;
      // The link lives for seconds (config TTL). A customer who read the
      // screen for a minute gets a fresh one rather than an error.
      if (needsFreshLink(url, stage.receivedAt)) {
        const s = await fetchTrialStatus(assetId);
        url = s?.state === "unlocked" ? s.downloadUrl : null;
        if (url && alive.current) {
          const fresh = url;
          setStage((prev) => prev.kind === "success" ? { ...prev, downloadUrl: fresh, receivedAt: Date.now() } : prev);
        }
      }
      if (!url) { toast.error(t("genv3.downloadFailed")); return; }
      await saveImageFrom(url, { seed: target.product ?? target.model });
    } catch {
      toast.error(t("genv3.downloadFailed"));
    } finally {
      if (alive.current) setDownloading(false);
    }
  }

  function retry() {
    if (stage.kind !== "error") return;
    if (stage.retry === "unlock") void unlock(true);
    else if (stage.retry === "confirm") void confirm();
    else void check();
  }

  const wide = stage.kind === "paywall";
  return (
    <TrialDialogShell label={t("genv3.wm.dialogLabel")} onClose={onClose} locked={stage.kind === "unlocking"}
      focusKey={stage.kind + ("timedOut" in stage ? String(stage.timedOut) : "")} wide={wide}>
      {stage.kind === "paywall" ? (
        <TrialPaywall preview={watermarked ?? null} paywallId={stage.paywallId} assetId={assetId}
          daysLeft={stage.daysLeft} expiresAt={target.trial?.expiresAt ?? null} plans={stage.plans}
          hasLiveSubscription={stage.hasLiveSubscription} pending={stage.pending}
          onCheckAgain={() => void confirm()} />
      ) : stage.kind === "success" ? (
        <div data-trial-success className="space-y-4">
          <div className="pr-8">
            <p className="flex items-center gap-2 font-display text-[1.0625rem] font-semibold">
              <CheckCircle2 size={18} aria-hidden className="text-success" />
              {t("genv3.wm.successTitle")}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("genv3.wm.successBody")}</p>
          </div>
          <div className="flex justify-center overflow-hidden rounded-2xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={stage.preview} alt={target.product ?? ""} data-trial-clean
              className="max-h-[46dvh] w-auto max-w-full object-contain" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => void download()} disabled={downloading} data-trial-download
              className="cta inline-flex h-11 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold [--accent:var(--accent-strong)] disabled:opacity-60">
              {downloading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
              {t("common.download")}
            </button>
            <button type="button" onClick={onClose}
              className="plate inline-flex h-11 items-center justify-center rounded-xl text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised">
              {t("common.close")}
            </button>
          </div>
        </div>
      ) : stage.kind === "expired" ? (
        <div data-trial-expired className="space-y-4 pr-8">
          <p className="text-[13.5px] leading-relaxed text-muted">
            {t(stage.reason === "expired" ? "genv3.wm.expired" : "genv3.wm.unavailable")}
          </p>
          <button type="button" onClick={onClose}
            className="plate inline-flex h-11 w-full items-center justify-center rounded-xl text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised">
            {t("common.close")}
          </button>
        </div>
      ) : stage.kind === "error" ? (
        <div data-trial-error className="space-y-4 pr-8">
          <div>
            <p className="font-display text-[1.0625rem] font-semibold">{t("genv3.wm.errorTitle")}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(errorKey(stage.code))}</p>
          </div>
          <button type="button" onClick={retry} data-trial-retry
            className="cta inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold [--accent:var(--accent-strong)]">
            <RefreshCw size={14} aria-hidden />
            {t("common.retry")}
          </button>
        </div>
      ) : stage.kind === "confirming" && stage.timedOut ? (
        <div data-trial-processing className="space-y-4 pr-8">
          <div>
            <p className="font-display text-[1.0625rem] font-semibold">{t("genv3.wm.processingTitle")}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("genv3.wm.processingBody")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => void confirm()} data-trial-check-again
              className="cta inline-flex h-11 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold [--accent:var(--accent-strong)]">
              <RefreshCw size={14} aria-hidden />
              {t("genv3.wm.checkAgain")}
            </button>
            <button type="button" onClick={() => void check()} data-trial-see-plans
              className="plate inline-flex h-11 items-center justify-center rounded-xl text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised">
              {t("genv3.wm.seePlans")}
            </button>
          </div>
        </div>
      ) : (
        // checking · confirming · unlocking — one quiet waiting state.
        <div data-trial-waiting={stage.kind} aria-live="polite" className="flex items-center gap-4 py-2 pr-8">
          {watermarked && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={watermarked} alt="" className="h-16 w-16 shrink-0 rounded-xl bg-sunken object-contain" />
          )}
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <Loader2 size={15} className="animate-spin text-accent" aria-hidden />
              {t(stage.kind === "unlocking" ? "genv3.wm.unlocking" : stage.kind === "confirming" ? "genv3.wm.confirming" : "genv3.wm.checking")}
            </p>
            {stage.kind === "confirming" && <p className="mt-1 text-[12.5px] text-muted">{t("genv3.wm.confirmingBody")}</p>}
          </div>
        </div>
      )}
    </TrialDialogShell>
  );
}

/**
 * The dialog as a hook: `start(item, surface)` opens it, `dialog` is what the
 * surface renders (once, anywhere — it portals itself). After an unlock the
 * library cache is patched here, for every surface, and `onUnlocked` patches
 * the surface's own state.
 */
export function useTrialUnlock({ onUnlocked }: { onUnlocked: TrialUnlocked }) {
  const [session, setSession] = useState<{
    target: TrialUnlockTarget; surface: TrialUnlockSurface; confirming: boolean; key: number;
  } | null>(null);
  const report = useRef(onUnlocked);
  report.current = onUnlocked;

  const start = useCallback((target: TrialUnlockTarget, surface: TrialUnlockSurface, opts?: { confirming?: boolean }) => {
    setSession((prev) => prev ?? { target, surface, confirming: opts?.confirming === true, key: Date.now() });
  }, []);
  const close = useCallback(() => setSession(null), []);
  const unlocked = useCallback<TrialUnlocked>((assetId, patch, info) => {
    patchLibrary((list) => patchAsset(list, assetId, patch));
    report.current(assetId, patch, info);
  }, []);

  const dialog = session ? (
    <TrialUnlockDialog key={session.key} target={session.target} surface={session.surface}
      confirming={session.confirming} onClose={close} onUnlocked={unlocked} />
  ) : null;
  return { start, dialog, open: session !== null };
}
