"use client";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Crown, Gift, Loader2, MailCheck, RotateCcw, Sparkles, Stamp, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { PlanCards } from "@/components/plan/plan-cards";
import { TopUps } from "@/components/plan/topups";
import { CARD_ORDER, CARD_ORDER_PHONE } from "@/components/plan/pricing-config";
import type { PricingPageData } from "@/components/plan/pricing-types";
import { trackEvent } from "@/components/analytics/google-analytics";
import { resendConfirmation } from "@/app/actions/auth";
import { toolPricingAction } from "@/app/actions/public-tools";
import { recommendedPack, toolState, type ToolState } from "@/lib/public-tools";
import { useToolViewer } from "./tool-viewer";
import type { RestoreOffer, ToolSession } from "./use-tool-session";

/**
 * WHAT STANDS BETWEEN THIS PANEL AND A RESULT — one card for every tool.
 *
 * Under the Generate button, from the one rule (lib/public-tools.ts
 * toolState) on the server's facts, the wallet the panel shows and the price
 * of the configuration on screen:
 *
 *   A   a visitor — one quiet line: an account is what Generate needs;
 *   B   enough — the trial-watermark note when the next run would carry it,
 *       and "Masz X darmowych kredytów – kliknij Generuj" right after a claim;
 *   B2  short, and the existing onboarding would give credits: confirm the
 *       address, or answer the existing survey (its own modal opens);
 *   C   short, no paid plan: the existing plan cards, in a dialog;
 *   D   short, on a paid plan: the existing packs, the smallest one that
 *       covers the gap preselected.
 *
 * It decides nothing the server does not decide again: the run endpoints
 * re-price and re-check every request, and a checkout only ever sells what
 * /checkout prices. Credits appear when the payment is settled (the webhook),
 * never because a success URL was visited — the panel's balance is the
 * server's, re-read when the page renders.
 */
/** "1 kredytu", not "1 kredytów": the one count the genitive after
 *  "brakuje" gets wrong has its own line. */
function missingKey(base: string, n: number): string {
  return n === 1 ? `${base}One` : base;
}

export function ToolNotice({ cost, balance, session, className, variant = "card", hidden = false }: {
  cost: number;
  balance: number;
  /** For saving the work before the checkout takes the member away. */
  session?: Pick<ToolSession, "prepare">;
  className?: string;
  /**
   * "line" (Generator UX V3): the same state, the same dialogs and actions, as
   * ONE short line above a tool's Generate bar instead of a card under it.
   */
  variant?: "card" | "line";
  /**
   * The line's slot is taken by something more urgent (the Generate bar's one
   * line): the notice stays MOUNTED — what it has reported, the bonus it saw
   * claimed, an open plan/top-up dialog — and only its line is not drawn.
   */
  hidden?: boolean;
}) {
  const viewer = useToolViewer();
  const { t } = useI18n();
  const state: ToolState | null = useMemo(
    () => (viewer ? toolState(viewer.facts, balance, cost) : null),
    [viewer, balance, cost],
  );
  const [dialog, setDialog] = useState<"plan" | "topup" | null>(null);

  // "Masz X darmowych kredytów – kliknij Generuj": the survey was this card's
  // last state and the balance now covers the image.
  const previous = useRef<ToolState | null>(null);
  const [claimed, setClaimed] = useState<number | null>(null);
  useEffect(() => {
    const prev = previous.current;
    if (prev?.code === "B2" && prev.step === "survey" && state?.code === "B") {
      setClaimed(prev.bonus);
      if (viewer) trackEvent("tool_onboarding_completed", { tool_id: viewer.tool });
    }
    previous.current = state;
  }, [state, viewer]);

  // Each restricting state is reported once per page, not once per render.
  const reported = useRef(new Set<string>());
  useEffect(() => {
    if (!viewer || !state || hidden) return;
    const name = state.code === "B2" ? "tool_state_b2_shown" : state.code === "C" ? "tool_state_c_shown"
      : state.code === "D" ? "tool_state_d_shown" : null;
    if (!name || reported.current.has(name)) return;
    reported.current.add(name);
    trackEvent(name, { tool_id: viewer.tool, state: state.code === "B2" ? state.step : state.code.toLowerCase() });
  }, [state, viewer, hidden]);

  if (!viewer || !state) return null;

  if (variant === "line") {
    const billing = <BillingDialog kind={dialog} missing={state.code === "C" || state.code === "D" ? state.missing : 0} onClose={() => setDialog(null)} session={session} />;
    if (hidden) return billing;
    return (
      <NoticeLine state={state} claimed={claimed} watermark={!!viewer.trialWatermark && cost > 0}
        email={viewer.email ?? null} onBilling={(kind) => {
          trackEvent(kind === "plan" ? "tool_choose_plan_click" : "tool_topup_click", { tool_id: viewer.tool });
          setDialog(kind);
        }}
        dialog={billing}
      />
    );
  }

  const box = (tone: "info" | "warn", icon: React.ReactNode, children: React.ReactNode, data: string) => (
    <div data-tool-notice={data} role={tone === "warn" ? "status" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px] leading-snug",
        tone === "warn" ? "border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)]" : "border-line bg-raised/60",
        className,
      )}>
      <span className="mt-0.5 shrink-0 text-muted" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );

  if (state.code === "A") {
    return box("info", <Sparkles size={14} />, <p className="text-muted">{t("publicTools.notice.guest")}</p>, "a");
  }

  if (state.code === "B") {
    if (claimed) {
      return box("info", <Gift size={14} />, <p className="font-semibold text-ink">{t("publicTools.notice.claimed", { n: claimed })}</p>, "claimed");
    }
    if (viewer.trialWatermark && cost > 0) {
      return box("info", <Stamp size={14} />, <p className="text-muted">{t("publicTools.notice.watermark")}</p>, "watermark");
    }
    return null;
  }

  const missingLine = (key: string) => (
    <p className="font-semibold text-ink">{t(missingKey(key, state.missing), { n: state.missing })}</p>
  );

  if (state.code === "B2") {
    return box("warn", <Gift size={14} />, (
      <>
        {missingLine("publicTools.notice.missing")}
        {state.step === "verify" ? (
          <>
            <p className="mt-0.5 text-muted">{t("publicTools.notice.verify")}</p>
            {viewer.email && <ResendButton email={viewer.email} />}
          </>
        ) : (
          <>
            <p className="mt-0.5 text-muted">{t("publicTools.notice.survey", { n: state.bonus })}</p>
            <button type="button" data-tool-survey
              onClick={() => window.dispatchEvent(new Event("grovbase:open-bonus"))}
              className="cta mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-semibold">
              <Gift size={14} aria-hidden /> {t("publicTools.notice.surveyCta")}
            </button>
          </>
        )}
      </>
    ), `b2-${state.step}`);
  }

  return (
    <>
      {box("warn", state.code === "C" ? <Crown size={14} /> : <Coins size={14} />, (
        <>
          {missingLine(state.code === "C" ? "publicTools.notice.missingImage" : "publicTools.notice.missing")}
          {state.code === "C" && <p className="mt-0.5 text-muted">{t("publicTools.notice.choosePlanBody")}</p>}
          <button type="button" data-tool-billing={state.code === "C" ? "plan" : "topup"}
            onClick={() => {
              trackEvent(state.code === "C" ? "tool_choose_plan_click" : "tool_topup_click", { tool_id: viewer.tool });
              setDialog(state.code === "C" ? "plan" : "topup");
            }}
            className="cta mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-semibold">
            {state.code === "C" ? <Crown size={14} aria-hidden /> : <Coins size={14} aria-hidden />}
            {t(state.code === "C" ? "publicTools.notice.choosePlan" : "publicTools.notice.topup")}
          </button>
        </>
      ), state.code.toLowerCase())}
      <BillingDialog kind={dialog} missing={state.missing} onClose={() => setDialog(null)} session={session} />
    </>
  );
}

/**
 * THE SAME STATES, ONE LINE EACH — what the Generate bar shows above its
 * button. Same order, same dialogs, same resend and survey as the card:
 *
 *   A   (a visitor) quiet: the photos stay here, an account comes at Generate
 *   B   nothing, or the watermark note, or "Masz X darmowych kredytów"
 *   B2  "Potwierdź adres e-mail · Wyślij ponownie" / the survey
 *   C   "Brakuje Ci 8 kr. · Wybierz plan"
 *   D   "Brakuje Ci 8 kr. · Doładuj"
 */
function NoticeLine({ state, claimed, watermark, email, onBilling, dialog }: {
  state: ToolState;
  claimed: number | null;
  watermark: boolean;
  email: string | null;
  onBilling: (kind: "plan" | "topup") => void;
  dialog: React.ReactNode;
}) {
  const { t, locale } = useI18n();
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);
  const line = (icon: React.ReactNode, children: React.ReactNode, data: string, warn = false) => (
    <p data-tool-notice={data} data-bar-reason="account" role={warn ? "status" : undefined}
      className={cn("flex min-w-0 items-start gap-1.5 text-[12px] leading-snug", warn ? "text-ink" : "text-muted")}>
      <span aria-hidden className={cn("mt-[1px] shrink-0", warn ? "text-warning" : "text-faint")}>{icon}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
  const act = (label: string, onClick: () => void, data: string) => (
    <>
      <span aria-hidden className="text-faint"> · </span>
      <button type="button" onClick={onClick} data-tool-billing={data}
        className="font-semibold text-accent transition-opacity hover:opacity-75">{label}</button>
    </>
  );

  if (state.code === "A") return line(<Sparkles size={13} />, t("publicTools.line.guest"), "a");
  if (state.code === "B") {
    if (claimed) return line(<Gift size={13} />, t("publicTools.notice.claimed", { n: claimed }), "claimed");
    if (watermark) return line(<Stamp size={13} />, t("publicTools.notice.watermark"), "watermark");
    return null;
  }
  if (state.code === "B2") {
    return state.step === "verify"
      ? line(<MailCheck size={13} />, (
        <>
          {t("publicTools.line.verify")}
          {email && <ResendInline email={email} />}
        </>
      ), "b2-verify", true)
      : line(<Gift size={13} />, (
        <>
          {t("publicTools.line.survey", { n: n(state.bonus) })}
          <span aria-hidden className="text-faint"> · </span>
          <button type="button" data-tool-survey onClick={() => window.dispatchEvent(new Event("grovbase:open-bonus"))}
            className="font-semibold text-accent transition-opacity hover:opacity-75">{t("publicTools.line.surveyCta")}</button>
        </>
      ), "b2-survey", true);
  }
  return (
    <>
      {line(state.code === "C" ? <Crown size={13} /> : <Coins size={13} />, (
        <>
          {t("publicTools.line.missing", { n: n(state.missing) })}
          {state.code === "C"
            ? act(t("publicTools.line.choosePlan"), () => onBilling("plan"), "plan")
            : act(t("publicTools.line.topup"), () => onBilling("topup"), "topup")}
        </>
      ), state.code.toLowerCase(), true)}
      {dialog}
    </>
  );
}

/** "Wyślij ponownie", inline — the same server action as the card's button. */
function ResendInline({ email }: { email: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(resendConfirmation, null);
  if (state?.info) {
    return (
      <span className="font-medium text-success">
        <span aria-hidden className="text-faint"> · </span>
        {state.info === "cooldown" ? t("auth.resendCooldown") : t("auth.resendSent")}
      </span>
    );
  }
  return (
    <form action={action} className="inline">
      <input type="hidden" name="email" value={email} />
      <span aria-hidden className="text-faint"> · </span>
      <button type="submit" disabled={pending} data-tool-resend
        className="font-semibold text-accent transition-opacity hover:opacity-75 disabled:opacity-60">
        {pending ? <Loader2 size={12} className="inline animate-spin" aria-hidden /> : t("publicTools.line.resend")}
      </button>
    </form>
  );
}

/** "Wyślij link ponownie" for the account's own address — the existing action. */
function ResendButton({ email }: { email: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(resendConfirmation, null);
  if (state?.info) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-success">
        <MailCheck size={13} aria-hidden />
        {state.info === "cooldown" ? t("auth.resendCooldown") : t("auth.resendSent")}
      </p>
    );
  }
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="email" value={email} />
      <button type="submit" disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-[12.5px] font-semibold hover:bg-raised disabled:opacity-60">
        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <MailCheck size={14} aria-hidden />}
        {t("publicTools.notice.resend")}
      </button>
    </form>
  );
}

/**
 * THE PLANS / THE PACKS, over the panel — the cennik's own components on the
 * cennik's own data (toolPricingAction → loadPricingPage). A click on a buy
 * link saves the member's work first, so the checkout's way back finds the
 * same photos and settings waiting.
 */
function BillingDialog({ kind, missing, onClose, session }: {
  kind: "plan" | "topup" | null;
  missing: number;
  onClose: () => void;
  session?: Pick<ToolSession, "prepare">;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<PricingPageData | null>(null);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!kind || data) return;
    let live = true;
    void toolPricingAction().then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data); else setFailed(true);
    });
    return () => { live = false; };
  }, [kind, data]);

  const recommended = useMemo(() => (data ? recommendedPack(data.packs, missing) : null), [data, missing]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") ?? "";
    if (!a || !href.startsWith("/checkout")) return;
    e.preventDefault();
    if (leaving) return;
    setLeaving(true);
    void (async () => {
      try { await session?.prepare(); } finally { router.push(href); }
    })();
  }, [leaving, session, router]);

  return (
    <Modal open={kind !== null} onClose={onClose} portal xl={kind === "plan"} wide={kind === "topup"}
      title={t(kind === "plan" ? "publicTools.modal.planTitle" : "publicTools.modal.topupTitle")}>
      <div onClickCapture={onClickCapture} data-tool-billing-dialog={kind ?? undefined} aria-busy={leaving || undefined}>
        {!data ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted">
            {failed ? t("publicTools.modal.error") : <Loader2 className="animate-spin" aria-hidden />}
          </div>
        ) : kind === "plan" ? (
          <>
            <p className="mb-4 text-[13px] text-muted">{t(missingKey("publicTools.notice.missingImage", missing), { n: missing })}</p>
            <PlanCards plans={data.plans} period="monthly" data={data} order={CARD_ORDER_PHONE} layout="phone" onChangeHint={onClose} />
            <PlanCards plans={data.plans} period="monthly" data={data} order={CARD_ORDER} layout="wide" onChangeHint={onClose} />
          </>
        ) : (
          <>
            {recommended && (
              <p className="mb-3 text-[13px] text-muted" data-tool-recommended={recommended.slot}>
                {t("publicTools.modal.recommended", { n: recommended.slot + recommended.bonusCredits, missing })}
              </p>
            )}
            <TopUps data={data} onChoosePlan={onClose} recommendedSlot={recommended?.slot ?? null} />
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * "Masz przygotowane zdjęcia i ustawienia — przywrócić?" Shown when a saved
 * preparation is not obviously this viewer's own (a visitor's work meeting an
 * account, another account's work): it is offered, never applied silently.
 * Also says honestly when the browser could not keep the photos.
 */
export function ToolDraftBanner({ session, className }: {
  session: Pick<ToolSession, "offer" | "partial" | "storage" | "guest">;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const offer: RestoreOffer | null = session.offer;
  const [dismissed, setDismissed] = useState(false);
  if (offer) {
    const when = new Date(offer.meta.savedAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
    return (
      <div data-tool-draft="offer" role="region" aria-label={t("publicTools.draft.label")}
        className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--accent)/0.07)] px-3.5 py-2.5 text-[13px]", className)}>
        <RotateCcw size={15} className="shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1">{t("publicTools.draft.offer", { n: offer.meta.fileCount, when })}</p>
        <div className="flex gap-2">
          <button type="button" onClick={offer.accept} data-tool-draft-accept
            className="cta inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold">
            {t("publicTools.draft.restore")}
          </button>
          <button type="button" onClick={offer.discard} data-tool-draft-discard
            className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[12.5px] font-semibold hover:bg-raised">
            {t("publicTools.draft.discard")}
          </button>
        </div>
      </div>
    );
  }
  const problem = session.partial ? "partial" : session.guest && session.storage !== "ok" ? session.storage : null;
  if (!problem || dismissed) return null;
  return (
    <div data-tool-draft={problem} role="status"
      className={cn("flex items-start gap-2.5 rounded-xl border border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.08)] px-3.5 py-2.5 text-[12.5px]", className)}>
      <p className="min-w-0 flex-1">{t(`publicTools.draft.${problem}`)}</p>
      <button type="button" onClick={() => setDismissed(true)} aria-label={t("common.close")}
        className="-m-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-raised">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

/** "Masz 12 kr." — the balance line beside a panel's price, members only. */
export function BalanceLine({ balance, className }: { balance: number; className?: string }) {
  const viewer = useToolViewer();
  const { t } = useI18n();
  if (!viewer || viewer.facts.kind === "guest") return null;
  return <span data-tool-balance className={cn("tabular-nums text-muted", className)}>{t("publicTools.balance", { n: balance })}</span>;
}
