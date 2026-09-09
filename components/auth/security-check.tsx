"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, Loader2, MailCheck, AlertTriangle, Timer } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { createGate } from "@/lib/single-flight";
import { mmss, resendView } from "@/lib/auth/resend";
import {
  ensureChallengeAction, resendCodeAction, verifyCodeAction, clearanceReadyAction,
} from "@/app/actions/login-security";

/**
 * The 6-digit step-up form.
 *
 * On mount it asks the server to ensure a code is outstanding (which also sets
 * the device cookie and, on first entry, sends the email). It never holds the
 * code, the challenge id or any secret — only the masked address the server
 * hands back for display. On success it re-checks clearance server-side before
 * navigating, so it can only move on when the gate would actually let it.
 *
 * The countdown is SERVER time, not a client timer someone can restart: the
 * action returns how many seconds the LIVE challenge row has left
 * (expires_at − now(), via login_challenge_peek), the client only renders it
 * down. A page refresh re-reads the same row, so the clock keeps its place;
 * at 00:00 the form locks and only "send a new code" continues — which is
 * also what the database enforces, since an expired code verifies to
 * {reason:'expired'} regardless of what the UI shows.
 */
export function SecurityCheck({ next }: { next: string }) {
  const { t } = useI18n();
  const [masked, setMasked] = useState("");
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [resendWindow, setResendWindow] = useState(59);
  /**
   * BOTH CLOCKS ARE DEADLINES, NOT COUNTERS.
   *
   * The resend cooldown used to be a number decremented by a `setInterval`.
   * A background tab throttles that interval to once a minute, so locking the
   * phone for half a minute and coming back showed a clock that had barely
   * moved — and a re-render could restart it. These are wall-clock instants
   * (epoch ms) derived from what the SERVER said, and every render reads the
   * time left from `now`; nothing accumulates and nothing can drift.
   */
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notConfigured, setNotConfigured] = useState(false);
  const started = useRef(false);
  // In-flight latches. `disabled` on a button is one render away from a tap;
  // a gate closes in the same tick, which is what makes "five taps = one mail"
  // true rather than merely likely.
  const sendGate = useRef(createGate()).current;
  const verifyGate = useRef(createGate()).current;

  // Ensure a challenge exists exactly once per mount.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ensureChallengeAction().then((res) => {
      if (!res.ok) {
        if (res.reason === "already_trusted") window.location.assign(next);
        else window.location.assign("/login");
        return;
      }
      setMasked(res.masked);
      setResendWindow(res.resendSeconds);
      // What the SERVER would still refuse, not a fresh window invented here:
      // reopening the page onto a code sent 40 s ago waits 19 s, not 59.
      setResendAt(res.resendWaitSeconds > 0 ? Date.now() + res.resendWaitSeconds * 1000 : null);
      setExpiresAt(res.expiresInSeconds > 0 ? Date.now() + res.expiresInSeconds * 1000 : null);
      if (res.status === "not_configured") setNotConfigured(true);
    });
  }, [next]);

  /**
   * ONE TICKER for both clocks. It only re-reads the wall clock, so a throttled
   * interval costs accuracy in nothing but refresh rate — and coming back to a
   * backgrounded tab re-reads it immediately instead of waiting for the next
   * tick, which is what makes "minimise Safari for 30 s" show the truth.
   */
  useEffect(() => {
    if (resendAt === null && expiresAt === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("pageshow", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      window.removeEventListener("pageshow", tick);
    };
  }, [resendAt, expiresAt]);

  const left = (at: number | null) => (at === null ? null : Math.max(0, Math.ceil((at - now) / 1000)));
  const cooldown = left(resendAt) ?? 0;
  const remaining = left(expiresAt);
  const expired = expiresAt !== null && remaining === 0;

  const submit = useCallback(async (code: string) => {
    // The sixth digit and a tap on "Potwierdź" can land in the same frame, and
    // each wrong verify burns one of the user's attempts. One at a time.
    await verifyGate.run(async () => {
    setBusy(true);
    setError(null);
    const res = await verifyCodeAction(code).catch(() => null);
    if (res?.ok) {
      // Only navigate when the gate would really pass now.
      const ready = await clearanceReadyAction();
      window.location.assign(ready ? next : "/login");
      return;
    }
    setBusy(false);
    // A failed REQUEST is not a wrong code: the attempt was never counted, so
    // it says the server had the problem and leaves the digits alone.
    if (!res) { setError(t("security.serverError")); return; }
    setDigits("");
    if (res.reason === "locked") setError(t("security.locked"));
    else if (res.reason === "expired") { setExpiresAt(Date.now()); setError(t("security.expired")); }
    else if (res.reason === "error" || res.reason === "no_session" || res.reason === "no_device") {
      setError(t("security.serverError"));
    }
    else if (typeof res.attemptsLeft === "number") {
      setError(t("security.wrongCode", { n: res.attemptsLeft }));
    } else setError(t("security.wrongCode", { n: 0 }));
    });
  }, [next, t, verifyGate]);

  const onInput = (value: string) => {
    if (expired) return;
    const clean = value.replace(/\D/g, "").slice(0, 6);
    setDigits(clean);
    setError(null);
    if (clean.length === 6 && !busy) void submit(clean);
  };

  /**
   * SEND ONE CODE PER TAP.
   *
   * The button used to fire the action on every click while it waited: on a
   * phone, where a tap that shows no feedback invites another tap, that is one
   * e-mail per tap. Now the first call takes a synchronous latch, the button
   * goes into "Wysyłanie…" in the same tick, and every further tap returns
   * immediately. Only a send the SERVER confirms starts the cooldown; every
   * other outcome — a refusal, a failure, a dead connection — hands the button
   * straight back, which is what the `finally` is for: an early return that
   * skipped `setSending(false)` would leave it spinning for good.
   */
  const resend = useCallback(async () => {
    await sendGate.run(async () => {
      setSending(true);
      setError(null);
      setNotice(null);
      try {
        const res = await resendCodeAction().catch(() => null);
        if (!res) { setError(t("security.resendFailed")); return; }
        if (res.status === "sent") {
          setNotice(t("security.resent"));
          setDigits("");
          setResendAt(Date.now() + resendWindow * 1000);
          if (typeof res.expiresInSeconds === "number" && res.expiresInSeconds > 0) {
            setExpiresAt(Date.now() + res.expiresInSeconds * 1000);
          }
        } else if (res.status === "cooldown") {
          // The server refused because a code is still fresh — show ITS clock.
          const wait = res.waitSeconds && res.waitSeconds > 0 ? res.waitSeconds : resendWindow;
          setResendAt(Date.now() + wait * 1000);
        } else if (res.status === "not_configured") {
          setNotConfigured(true);
        } else setError(t("security.resendFailed"));
      } finally {
        setSending(false);
      }
    });
  }, [resendWindow, sendGate, t]);

  // An expired code can ALWAYS be replaced; otherwise the button waits out the
  // server's own window. See lib/auth/resend.ts for the whole rule.
  const view = resendView({ sending, expired, cooldown });

  return (
    <Card className="relative mx-auto w-full max-w-md overflow-hidden p-6 text-center sm:p-8">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(18rem 7rem at 50% -30%, rgb(var(--accent) / 0.16), transparent 70%)" }} />
      <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--accent)/0.14)] text-accent">
        <ShieldCheck size={26} aria-hidden />
      </span>
      <h1 className="relative mt-4 font-display text-xl font-semibold tracking-tight">{t("security.title")}</h1>
      <p className="relative mt-2 text-sm leading-relaxed text-muted">
        {masked ? t("security.sentTo", { email: masked }) : t("security.preparing")}
      </p>

      {notConfigured ? (
        <p className="relative mt-5 flex items-center justify-center gap-2 rounded-xl bg-[rgb(var(--warning)/0.12)] px-3 py-3 text-[13px] font-medium text-warning">
          <AlertTriangle size={15} aria-hidden />
          {t("security.mailUnavailable")}
        </p>
      ) : (
        <>
          <div className="relative mt-6">
            <input
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
              aria-label={t("security.codeLabel")} value={digits}
              onChange={(e) => onInput(e.target.value)} disabled={busy || expired} autoFocus
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-ink outline-none focus:border-[rgb(var(--accent)/0.6)] disabled:opacity-50"
              placeholder="••••••"
            />
          </div>

          {expired ? (
            <p className="relative mt-3 text-[13px] font-medium text-danger">
              {t("security.expiredNow")}{" "}
              <span className="font-normal text-muted">{t("security.expiredHint")}</span>
            </p>
          ) : remaining !== null && (
            <p className="relative mt-3 flex items-center justify-center gap-1.5 text-[13px] font-medium text-muted">
              <Timer size={14} aria-hidden className={remaining <= 15 ? "text-danger" : ""} />
              {t("security.expiresIn", { time: mmss(remaining) })}
            </p>
          )}

          {error && (
            <p className="relative mt-3 text-[13px] font-medium text-danger">{error}</p>
          )}
          {notice && !error && !expired && (
            <p className="relative mt-3 flex items-center justify-center gap-1.5 text-[13px] font-medium text-success">
              <MailCheck size={14} aria-hidden /> {notice}
            </p>
          )}

          <button type="button" disabled={busy || expired || digits.length !== 6} onClick={() => void submit(digits)}
            className="cta relative mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {/* "Weryfikowanie…", not a generic spinner caption: the six digits
                are already in, and the only question left is whether they are
                right. */}
            {busy ? t("security.verifying") : t("security.confirm")}
          </button>

          <button type="button" onClick={() => void resend()} disabled={view.disabled}
            aria-busy={view.loading}
            className={`relative mt-4 inline-flex items-center justify-center gap-1.5 text-[13px] font-medium transition-colors disabled:opacity-50 ${
              expired && !view.loading ? "text-accent hover:brightness-110" : "text-muted hover:text-ink"}`}>
            {view.loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
            {t(view.labelKey, view.time ? { time: view.time } : undefined)}
          </button>
        </>
      )}
    </Card>
  );
}
