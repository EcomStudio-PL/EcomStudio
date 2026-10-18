"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Lock, RefreshCw, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { patchLibrary } from "@/lib/library-cache";
import { trialPaywallAction } from "@/app/actions/trial-watermark";
import type { TrialPaywallPlan } from "@/lib/trial-watermark/types";
import { pause, postTrialUnlockAll } from "./api";
import {
  bulkAdvance, bulkContinues, bulkSkip, bulkStart, daysLeftOf, errorKey, patchAsset, unlockedPatch,
  type BulkProgress, type TrialAssetPatch,
} from "./model";
import { TrialPaywall } from "./paywall";
import { TrialDialogShell } from "./shell";
import type { TrialUnlockTarget } from "./unlock-dialog";

type Stage =
  | { kind: "checking" }
  | { kind: "paywall"; paywallId: string; daysLeft: number | null; plans: TrialPaywallPlan[]; hasLiveSubscription: boolean; pending: boolean }
  | { kind: "running"; p: BulkProgress; stopping: boolean }
  | { kind: "finished"; p: BulkProgress; stopped: boolean }
  | { kind: "not_entitled"; pending: boolean; hasLiveSubscription: boolean }
  | { kind: "error"; code: string; p: BulkProgress | null };

/** Errors worth a second ask before telling the customer. */
const TRANSIENT = new Set(["rate_limited", "network", "busy"]);
const TRANSIENT_TRIES = 3;

/**
 * "USUŃ ZNAK WODNY ZE WSZYSTKICH" — every locked image of the workspace, in
 * batches the server sizes (≤ 4 per call), with a counter that tells the
 * truth: "Odblokowano X z Y", Y re-derived from the server's own `remaining`
 * after every batch.
 *
 * A workspace without an active plan sees ONE paywall (R31), for the first
 * locked image on screen — the checkout comes back to that image, and this
 * button is still there for the rest. An image that fails is skipped for the
 * rest of the run and offered again with "Ponów nieudane". The run stops when
 * the server says done, when a batch moves nothing, or when the customer
 * stops it; a batch already sent finishes and its images are patched either
 * way, because on the server they are already unlocked.
 */
export function TrialBulkDialog({ first, expected, onClose, onUnlocked, onSettled }: {
  /** A locked image the page knows, for the paywall check; null = ask the server directly. */
  first: TrialUnlockTarget | null;
  /** The page's count of locked images — Y until the first batch answers. */
  expected: number;
  onClose: () => void;
  onUnlocked: (assetId: string, patch: TrialAssetPatch) => void;
  /** How many locked images are left once a run ends or stops. */
  onSettled: (lockedLeft: number) => void;
}) {
  const { t } = useI18n();
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const stop = useRef(false);
  const report = useRef({ onUnlocked, onSettled });
  report.current = { onUnlocked, onSettled };

  const settle = useCallback((p: BulkProgress) => {
    report.current.onSettled(p.remaining !== null ? p.remaining + p.failed.length : Math.max(0, expected - p.unlocked));
  }, [expected]);

  const run = useCallback(async (resume: BulkProgress | null) => {
    let p = resume ?? bulkStart(expected);
    stop.current = false;
    setStage({ kind: "running", p, stopping: false });
    let tries = 0;
    for (;;) {
      const r = await postTrialUnlockAll(p.bulkId, bulkSkip(p));
      if (r.state === "ok") {
        // Patched whether or not anyone is still watching: these files are
        // already swapped on the server.
        for (const u of r.unlocked) report.current.onUnlocked(u.assetId, unlockedPatch(u));
        p = bulkAdvance(p, r);
        tries = 0;
        if (!alive.current) { settle(p); return; }
        if (!bulkContinues(p) || stop.current) break;
        setStage({ kind: "running", p, stopping: false });
        continue;
      }
      if (!alive.current) { settle(p); return; }
      if (r.state === "not_entitled") {
        settle(p);
        setStage({ kind: "not_entitled", pending: r.pending, hasLiveSubscription: r.hasLiveSubscription });
        return;
      }
      if (TRANSIENT.has(r.error) && tries < TRANSIENT_TRIES && !stop.current) {
        tries++;
        if (!(await pause(1500 * 2 ** tries, () => alive.current))) { settle(p); return; }
        continue;
      }
      settle(p);
      setStage({ kind: "error", code: r.error, p });
      return;
    }
    settle(p);
    setStage({ kind: "finished", p, stopped: !p.done && !p.stalled });
  }, [expected, settle]);

  const check = useCallback(async () => {
    if (!first) { await run(null); return; }
    setStage({ kind: "checking" });
    let res: Awaited<ReturnType<typeof trialPaywallAction>>;
    try { res = await trialPaywallAction({ assetId: first.assetId, surface: "library_bulk" }); } catch { res = { kind: "error" }; }
    if (!alive.current) return;
    if (res.kind === "paywall") {
      setStage({ kind: "paywall", paywallId: res.paywallId, daysLeft: res.daysLeft, plans: res.plans, hasLiveSubscription: res.hasLiveSubscription, pending: res.pending });
      return;
    }
    if (res.kind === "error") { setStage({ kind: "error", code: "generic", p: null }); return; }
    // Entitled — or that one image is no longer locked, which says nothing
    // about the rest: the server judges each of them.
    await run(null);
  }, [first, run]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
  }, [check]);

  function close() {
    stop.current = true;
    onClose();
  }

  const progress = stage.kind === "running" || stage.kind === "finished" ? stage.p
    : stage.kind === "error" ? stage.p : null;
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.unlocked / progress.total) * 100)) : 0;
  const preview = first ? first.previewUrl || first.thumbUrl || first.url || null : null;

  return (
    <TrialDialogShell label={t("genv3.wm.bulkTitle")} onClose={close} focusKey={stage.kind} wide={stage.kind === "paywall"}>
      {stage.kind === "paywall" && first ? (
        <TrialPaywall preview={preview} paywallId={stage.paywallId} assetId={first.assetId}
          daysLeft={stage.daysLeft ?? daysLeftOf(first.trial)} expiresAt={first.trial?.expiresAt ?? null} plans={stage.plans}
          hasLiveSubscription={stage.hasLiveSubscription} pending={stage.pending} onCheckAgain={() => void check()} />
      ) : (
        <div data-trial-bulk={stage.kind} className="space-y-4">
          <div className="pr-8">
            <p className="flex items-center gap-2 font-display text-[1.0625rem] font-semibold">
              {stage.kind === "finished" && stage.p.done && stage.p.failed.length === 0
                ? <CheckCircle2 size={18} aria-hidden className="text-success" />
                : <Lock size={16} aria-hidden className="text-accent" />}
              {t("genv3.wm.bulkTitle")}
            </p>
          </div>

          {progress && (
            <div>
              <p className="text-[13.5px] font-semibold tabular-nums" data-trial-bulk-count aria-live="polite">
                {t("genv3.wm.bulkProgress", { x: progress.unlocked, y: progress.total })}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[rgb(var(--ink)/0.08)]" aria-hidden>
                <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
              {progress.failed.length > 0 && (
                <p className="mt-2 text-[12.5px] text-danger" data-trial-bulk-failed>
                  {t("genv3.wm.bulkFailed", { n: progress.failed.length })}
                </p>
              )}
            </div>
          )}

          {stage.kind === "checking" || stage.kind === "running" ? (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin text-accent" aria-hidden />
              {t(stage.kind === "checking" ? "genv3.wm.checking" : "genv3.wm.unlocking")}
            </p>
          ) : null}

          {stage.kind === "running" && (
            <button type="button" disabled={stage.stopping}
              onClick={() => { stop.current = true; setStage({ ...stage, stopping: true }); }} data-trial-bulk-stop
              className="plate inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised disabled:opacity-60">
              {stage.stopping && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {t("genv3.wm.bulkStop")}
            </button>
          )}

          {stage.kind === "finished" && (
            <>
              {stage.p.stalled && <p className="text-[12.5px] leading-relaxed text-muted">{t("genv3.wm.bulkNoProgress")}</p>}
              {stage.stopped && <p className="text-[12.5px] leading-relaxed text-muted">{t("genv3.wm.bulkStopped")}</p>}
              <div className={cn("grid gap-2", (stage.p.failed.length > 0 || stage.stopped) && "sm:grid-cols-2")}>
                {stage.stopped ? (
                  <button type="button" onClick={() => void run(stage.p)} data-trial-bulk-resume
                    className="cta inline-flex h-11 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold [--accent:var(--accent-strong)]">
                    <RefreshCw size={14} aria-hidden />{t("genv3.wm.bulkResume")}
                  </button>
                ) : stage.p.failed.length > 0 ? (
                  <button type="button" onClick={() => void run(null)} data-trial-bulk-retry
                    className="cta inline-flex h-11 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold [--accent:var(--accent-strong)]">
                    <RefreshCw size={14} aria-hidden />{t("genv3.wm.bulkRetry")}
                  </button>
                ) : null}
                <button type="button" onClick={close}
                  className="plate inline-flex h-11 items-center justify-center rounded-xl text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised">
                  {t("common.close")}
                </button>
              </div>
            </>
          )}

          {stage.kind === "not_entitled" && (
            stage.pending ? (
              <div data-trial-pending className="rounded-xl border border-line bg-sunken/50 p-3.5">
                <p className="text-[13px] font-semibold">{t("genv3.wm.pendingTitle")}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("genv3.wm.pendingBody")}</p>
              </div>
            ) : stage.hasLiveSubscription ? (
              <div data-trial-inactive className="space-y-3">
                <p className="text-[12.5px] leading-relaxed text-muted">{t("genv3.wm.inactiveBody")}</p>
                <Link href="/settings?tab=subscriptions" data-trial-manage
                  className="cta inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-[13.5px] font-semibold [--accent:var(--accent-strong)]">
                  <Settings size={14} aria-hidden />{t("genv3.wm.manage")}
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[12.5px] leading-relaxed text-muted">{t("genv3.wm.bulkNeedsPlan")}</p>
                <Link href="/plan#plany" data-trial-see-plans
                  className="cta inline-flex h-11 w-full items-center justify-center rounded-xl text-[13.5px] font-semibold [--accent:var(--accent-strong)]">
                  {t("genv3.wm.seePlans")}
                </Link>
              </div>
            )
          )}

          {stage.kind === "error" && (
            <>
              <p className="text-[12.5px] leading-relaxed text-muted">{t(errorKey(stage.code))}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => void (stage.p ? run(stage.p) : check())} data-trial-retry
                  className="cta inline-flex h-11 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold [--accent:var(--accent-strong)]">
                  <RefreshCw size={14} aria-hidden />{t("common.retry")}
                </button>
                <button type="button" onClick={close}
                  className="plate inline-flex h-11 items-center justify-center rounded-xl text-[13.5px] font-semibold text-ink transition-colors hover:bg-raised">
                  {t("common.close")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </TrialDialogShell>
  );
}

/**
 * The bulk dialog as a hook, the same shape as useTrialUnlock: `start` opens
 * it, `dialog` is rendered once. Every unlocked image patches the library
 * cache here and the page's own state through `onUnlocked`.
 */
export function useTrialBulkUnlock({ onUnlocked, onSettled }: {
  onUnlocked: (assetId: string, patch: TrialAssetPatch) => void;
  onSettled: (lockedLeft: number) => void;
}) {
  const [session, setSession] = useState<{ first: TrialUnlockTarget | null; expected: number; key: number } | null>(null);
  const report = useRef({ onUnlocked, onSettled });
  report.current = { onUnlocked, onSettled };

  const start = useCallback((first: TrialUnlockTarget | null, expected: number) => {
    setSession((prev) => prev ?? { first, expected, key: Date.now() });
  }, []);
  const close = useCallback(() => setSession(null), []);
  const unlocked = useCallback((assetId: string, patch: TrialAssetPatch) => {
    patchLibrary((list) => patchAsset(list, assetId, patch));
    report.current.onUnlocked(assetId, patch);
  }, []);
  const settled = useCallback((left: number) => report.current.onSettled(left), []);

  const dialog = session ? (
    <TrialBulkDialog key={session.key} first={session.first} expected={session.expected}
      onClose={close} onUnlocked={unlocked} onSettled={settled} />
  ) : null;
  return { start, dialog, open: session !== null };
}
