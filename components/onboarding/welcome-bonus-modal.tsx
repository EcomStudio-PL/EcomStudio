"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, Gift, Loader2, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { claimWelcomeBonusAction, welcomeBonusStateAction } from "@/app/actions/welcome-bonus";
import {
  OTHER_VALUE, formatCountdown, renderPlaceholders,
  type BonusCopy, type OfferView, type SurveyQuestion,
} from "@/lib/welcome-bonus";
import { cn } from "@/lib/utils";

/**
 * WELCOME BONUS — the claim.
 *
 * A short chip survey the customer answers for credits. Everything that
 * decides whether the bonus is real lives on the server: the amount is frozen
 * on the offer row, the deadline is compared against the server clock inside
 * one transaction, and the grant is idempotent. This component collects
 * answers and renders the outcome — it cannot grant anything.
 *
 * `secondsLeft` arrives from the server and is only counted DOWN here, for
 * the display. Reopening the modal re-reads it, so the number on screen can
 * drift by at most one page load and never in the customer's favour.
 */

export type BonusModalProps = {
  offer: OfferView;
  questions: SurveyQuestion[];
  copy: BonusCopy;
  badge: string;
  /** Media-library icon; empty falls back to the built-in gift. */
  icon: string;
  firstName: string;
  /** Open on mount — the first qualifying sign-in. Otherwise it waits to be
   *  opened from the notification. */
  autoOpen: boolean;
};

export function WelcomeBonusModal(props: BonusModalProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(props.autoOpen);
  const [offer, setOffer] = useState(props.offer);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  /** "Inne — wpisz skąd", per question. Kept beside the answers rather than
   *  inside them so the option column stays groupable for analytics. */
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** An empty box only turns red after a submit attempt — not while typing. */
  const [submitted, setSubmitted] = useState(false);
  const [claimed, setClaimed] = useState<{ amount: number; balance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // The notification links to ?bonus=1; opening from anywhere else in the app
  // dispatches this event rather than routing, so the page underneath stays.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("grovbase:open-bonus", onOpen);
    return () => window.removeEventListener("grovbase:open-bonus", onOpen);
  }, []);

  // Re-read the offer from the SERVER whenever the modal opens: the countdown
  // below is presentation, this is the truth.
  useEffect(() => {
    if (!open || claimed) return;
    void welcomeBonusStateAction().then((fresh) => { if (fresh) setOffer(fresh); });
  }, [open, claimed]);

  // The visible countdown. One interval, no re-render storm: it ticks a number
  // that only this subtree reads.
  const [seconds, setSeconds] = useState(props.offer.secondsLeft);
  useEffect(() => { setSeconds(offer.secondsLeft); }, [offer.secondsLeft]);
  useEffect(() => {
    if (!open || claimed) return;
    const id = window.setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [open, claimed]);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    // Dismissing is not declining: the notification stays, and the next new
    // sign-in offers again until the bonus is claimed or the window closes.
    opener.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => { html.style.overflow = prevHtml; document.body.style.overflow = prevBody; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const visible = useMemo(
    () => props.questions.filter((q) => q.enabled),
    [props.questions],
  );

  const label = (q: SurveyQuestion) =>
    q.label && q.label.trim() !== "" ? q.label : t(`bonus.q.${q.key}`);
  const optionLabel = (q: SurveyQuestion, value: string, custom?: string) =>
    custom && custom.trim() !== "" ? custom : t(`bonus.opt.${q.key}.${value}`);

  const toggle = (q: SurveyQuestion, value: string) => {
    setError(null);
    setAnswers((prev) => {
      const current = prev[q.key] ?? [];
      const next = q.type === "SINGLE_SELECT"
        ? (current[0] === value ? [] : [value])
        : (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
      // Picking something else instead of "Inne" drops the sentence that was
      // only ever about "Inne" — keeping it would file a description under an
      // answer it does not describe.
      if (!next.includes(OTHER_VALUE)) {
        setDetails((d) => (d[q.key] === undefined ? d : { ...d, [q.key]: "" }));
      }
      return { ...prev, [q.key]: next };
    });
  };

  const picked = (q: SurveyQuestion) => answers[q.key] ?? [];
  const needsDetail = (q: SurveyQuestion) => picked(q).includes(OTHER_VALUE);

  // Two ways to be incomplete: a required question with no answer at all, and
  // ANY question answered "Inne" with an empty box. The second applies to
  // optional questions too — the question stays optional, the choice does not.
  const missingRequired = visible.find((q) => q.required && picked(q).length === 0);
  const missingDetail = visible.find((q) => needsDetail(q) && (details[q.key] ?? "").trim() === "");

  const submit = async () => {
    if (busy) return;                       // the client half of "claim once"
    setSubmitted(true);
    if (missingRequired) { setError(t("bonus.errMissing")); return; }
    if (missingDetail) {
      setError(t("bonus.errMissingDetail"));
      document.getElementById(`bonus-other-${missingDetail.key}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await claimWelcomeBonusAction(answers, details);
    setBusy(false);
    if (res.ok) {
      setClaimed({ amount: res.amount, balance: res.balance });
      // The credit counter in the chrome is server-rendered.
      router.refresh();
      return;
    }
    if (res.error === "expired") { setError(t("bonus.errExpired")); setOffer({ ...offer, status: "EXPIRED" }); return; }
    if (res.error === "missing_answer") { setError(t("bonus.errMissing")); return; }
    setError(t("common.error"));
  };

  if (!open) return null;

  const values = {
    credits: offer.amount,
    hours: Math.ceil(offer.secondsLeft / 3600),
    first_name: props.firstName,
  };
  // ONE placeholder engine, and it is renderPlaceholders.
  //
  // `t()` interpolates {key}; this copy is written in {{key}}, because that is
  // the syntax the admin editor documents and validates. Running BOTH over the
  // same string meant t() ate the inner braces of "{{credits}}" and left the
  // outer pair behind — which is why production rendered a literal "{150}" in
  // the title and on the button. The fallback is fetched RAW and rendered
  // exactly like an admin's own text, by the one function that knows the
  // whitelist.
  const text = (custom: string, fallbackKey: string) =>
    renderPlaceholders(custom.trim() !== "" ? custom : t(fallbackKey), values);

  return (
    <div
      className="bonus-modal-root fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bonus-title"
    >
      <button type="button" aria-label={t("common.close")} onClick={close}
        className="auth-backdrop absolute inset-0 cursor-default bg-[rgb(var(--bg)/0.74)] backdrop-blur-[8px]" />

      <div ref={panelRef}
        className="auth-panel panel relative flex w-full max-w-[620px] flex-col overflow-hidden rounded-3xl"
        style={{ maxHeight: "min(100%, 760px)" }}>
        <span aria-hidden className="auth-orbit" />

        {claimed ? (
          <ClaimedState amount={claimed.amount} balance={claimed.balance}
            copy={props.copy} icon={props.icon} onDone={close} values={values} />
        ) : (
          <>
            <header className="relative px-5 pb-2 pt-5 sm:px-7 sm:pt-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <BonusIcon icon={props.icon} />
                  <span className="rounded-full bg-[rgb(var(--accent)/0.16)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                    {props.badge}
                  </span>
                </div>
                <button type="button" onClick={close} aria-label={t("common.close")}
                  className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink">
                  <X size={18} aria-hidden />
                </button>
              </div>
              <h2 id="bonus-title" className="mt-3 font-display text-[21px] font-semibold leading-tight tracking-tight sm:text-2xl">
                {text(props.copy.modalTitle, "bonus.modalTitle")}
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
                {text(props.copy.modalSubtitle, "bonus.modalSub")}
              </p>
              {/* Quiet, not alarming: a plain line of muted text, no red, no
                  pulsing. It is an offer with a deadline, not a threat. */}
              <p className="mt-2 text-[12px] font-medium text-faint">
                {t("bonus.expiresIn")}{" "}
                <span className="metric tabular-nums text-muted">{formatCountdown(seconds)}</span>
              </p>
            </header>

            <div className="auth-modal-body relative min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-4 pt-3 sm:px-7">
              {visible.map((q) => (
                <fieldset key={q.key}>
                  <legend className="mb-2 text-[13.5px] font-semibold text-ink">
                    {label(q)}
                    {!q.required && <span className="ml-2 text-[11px] font-normal text-faint">{t("bonus.optional")}</span>}
                  </legend>
                  {/* Chips WRAP. A horizontal scroller hides options behind an
                      edge on exactly the screens where they matter most. */}
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((o) => {
                      const picked = (answers[q.key] ?? []).includes(o.value);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={picked}
                          onClick={() => toggle(q, o.value)}
                          className={cn(
                            "min-h-[40px] rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-150",
                            picked
                              ? "border-[rgb(var(--accent)/0.55)] bg-[rgb(var(--accent)/0.14)] text-ink"
                              : "border-line bg-surface text-muted hover:border-[rgb(var(--accent)/0.3)] hover:text-ink",
                          )}
                        >
                          {optionLabel(q, o.value, o.label)}
                        </button>
                      );
                    })}
                  </div>

                  {/* THE SENTENCE THAT MAKES "INNE" WORTH ASKING.
                      It belongs to THIS question and appears directly under
                      it — not in a shared box at the bottom where nobody can
                      tell which answer it describes. */}
                  {needsDetail(q) && (
                    <div className="bonus-other mt-2.5">
                      <label htmlFor={`bonus-other-${q.key}`}
                        className="mb-1 block text-[12px] font-medium text-muted">
                        {t(`bonus.otherLabel.${q.key}`)}
                      </label>
                      <input
                        id={`bonus-other-${q.key}`}
                        type="text"
                        autoFocus
                        maxLength={120}
                        value={details[q.key] ?? ""}
                        onChange={(e) => {
                          setError(null);
                          setDetails((d) => ({ ...d, [q.key]: e.target.value }));
                        }}
                        placeholder={t(`bonus.otherPlaceholder.${q.key}`)}
                        aria-required
                        aria-invalid={submitted && (details[q.key] ?? "").trim() === "" ? true : undefined}
                        className="h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.6)] aria-[invalid=true]:border-danger"
                      />
                    </div>
                  )}
                </fieldset>
              ))}

              {error && (
                <p role="alert" className="rounded-xl bg-[rgb(var(--danger)/0.10)] px-3.5 py-2.5 text-[13px] font-medium text-danger">
                  {error}
                </p>
              )}
            </div>

            {/* Sticky footer: on a phone the CTA must not be the thing you have
                to scroll to find. */}
            <footer className="relative border-t border-line bg-[rgb(var(--surface)/0.9)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-7">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || offer.status === "EXPIRED"}
                className="cta flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60"
              >
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Gift size={16} aria-hidden />}
                {text(props.copy.cta, "bonus.cta")}
              </button>
              <p className="mt-2 text-center text-[11.5px] text-faint">{t("bonus.underMinute")}</p>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/** The reward landing. A brief sparkle, a real number, and a way into the
 *  product — not ten seconds of confetti. */
function ClaimedState({ amount, balance, copy, icon, onDone, values }: {
  amount: number; balance: number; copy: BonusCopy; icon: string;
  onDone: () => void; values: Record<string, string | number>;
}) {
  const { t, locale } = useI18n();
  // Same single engine as the modal above — see the comment there.
  const text = (custom: string, fallbackKey: string) =>
    renderPlaceholders(custom.trim() !== "" ? custom : t(fallbackKey), { ...values, credits: amount });
  return (
    <div className="relative px-6 py-10 text-center sm:px-10">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32"
        style={{ background: "radial-gradient(22rem 9rem at 50% -30%, rgb(var(--accent) / 0.22), transparent 70%)" }} />
      <span className="bonus-pop relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgb(var(--accent)/0.16)] text-accent">
        {icon ? <BonusIcon icon={icon} large /> : <Sparkles size={30} aria-hidden />}
      </span>
      <h2 className="relative mt-5 font-display text-2xl font-semibold tracking-tight">
        {text(copy.successTitle, "bonus.successTitle")}
      </h2>
      <p className="relative mt-2 text-sm leading-relaxed text-muted">
        {text(copy.successBody, "bonus.successBody")}
      </p>
      <p className="relative mt-4 text-[13px] text-faint">
        {t("bonus.newBalance")}{" "}
        <span className="metric text-ink">{new Intl.NumberFormat(locale).format(balance)}</span>
      </p>
      <button type="button" onClick={onDone}
        className="cta relative mt-7 inline-flex h-12 items-center justify-center rounded-xl px-7 text-sm font-semibold">
        {t("bonus.startCreating")}
      </button>
    </div>
  );
}

/** The admin's icon when there is one, the system gift when there is not. */
function BonusIcon({ icon, large }: { icon: string; large?: boolean }) {
  const size = large ? 34 : 20;
  if (icon) {
    return (
      <Image src={icon} alt="" width={size + 10} height={size + 10} unoptimized
        className={large ? "h-9 w-9 object-contain" : "h-6 w-6 object-contain"} />
    );
  }
  return (
    <span className={cn(
      "flex items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.16)] text-accent",
      large ? "h-11 w-11" : "h-10 w-10",
    )}>
      <Gift size={size} aria-hidden />
    </span>
  );
}

/** The check used by the notification row. Exported so the bell can show the
 *  same gift treatment without importing the whole modal. */
export { Check as BonusCheck };
