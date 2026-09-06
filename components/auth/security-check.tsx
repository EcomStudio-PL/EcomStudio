"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, Loader2, MailCheck, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
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
 */
export function SecurityCheck({ next }: { next: string }) {
  const { t } = useI18n();
  const [masked, setMasked] = useState("");
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [notConfigured, setNotConfigured] = useState(false);
  const started = useRef(false);

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
      setCooldown(res.resendSeconds);
      if (res.status === "not_configured") setNotConfigured(true);
    });
  }, [next]);

  // Resend countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const submit = useCallback(async (code: string) => {
    setBusy(true);
    setError(null);
    const res = await verifyCodeAction(code);
    if (res.ok) {
      // Only navigate when the gate would really pass now.
      const ready = await clearanceReadyAction();
      window.location.assign(ready ? next : "/login");
      return;
    }
    setBusy(false);
    setDigits("");
    if (res.reason === "locked") setError(t("security.locked"));
    else if (res.reason === "expired") setError(t("security.expired"));
    else if (typeof res.attemptsLeft === "number") {
      setError(t("security.wrongCode", { n: res.attemptsLeft }));
    } else setError(t("security.wrongCode", { n: 0 }));
  }, [next, t]);

  const onInput = (value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 6);
    setDigits(clean);
    setError(null);
    if (clean.length === 6 && !busy) void submit(clean);
  };

  const resend = useCallback(async () => {
    setError(null);
    const res = await resendCodeAction();
    if (res.status === "sent") {
      setNotice(t("security.resent"));
      setCooldown((c) => (c > 0 ? c : 60));
    } else if (res.status === "cooldown") {
      setCooldown(res.waitSeconds ?? 60);
    } else if (res.status === "not_configured") {
      setNotConfigured(true);
    } else setError(t("common.error"));
  }, [t]);

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
              onChange={(e) => onInput(e.target.value)} disabled={busy} autoFocus
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]"
              placeholder="••••••"
            />
          </div>

          {error && (
            <p className="relative mt-3 text-[13px] font-medium text-danger">{error}</p>
          )}
          {notice && !error && (
            <p className="relative mt-3 flex items-center justify-center gap-1.5 text-[13px] font-medium text-success">
              <MailCheck size={14} aria-hidden /> {notice}
            </p>
          )}

          <button type="button" disabled={busy || digits.length !== 6} onClick={() => void submit(digits)}
            className="cta relative mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60">
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {busy ? t("common.loading") : t("security.confirm")}
          </button>

          <button type="button" onClick={() => void resend()} disabled={cooldown > 0}
            className="relative mt-4 text-[13px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-50">
            {cooldown > 0 ? t("security.resendIn", { n: cooldown }) : t("security.resend")}
          </button>
        </>
      )}
    </Card>
  );
}
