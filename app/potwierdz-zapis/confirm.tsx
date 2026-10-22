"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Loader2, MailCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { resolveLine } from "@/lib/launch/tokens";
import { ReferralShare } from "@/components/launch/referral-share";
import { launchTrack } from "@/components/launch/launch-analytics";
import { cn } from "@/lib/utils";

/** The launch page's referral wording; the body is a template whose
 *  {referral} is filled from the confirm answer (an approved value or none). */
export type ConfirmShareCopy = {
  title: string; body: string; bodyNone: string; copy: string; rewardNote: string;
};

type Status = "loading" | "ready" | "busy" | "confirmed" | "already" | "expired" | "invalid" | "rate_limited" | "error";

type ConfirmAnswer = {
  ok?: boolean;
  status?: string;
  first_name?: unknown;
  referral?: { url?: unknown } | null;
  referral_credits?: unknown;
};

/** What a token from our own mail looks like (32 random bytes, base64url).
 *  Anything else is not worth a request. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * The confirmation, in the browser — because the token only exists there.
 *
 * On mount: read `#t=` ONCE and immediately replace the address without it,
 * so the token is not left in the history entry, a bookmark or a screenshot.
 * Then wait for a real press (see page.tsx for why there is no auto-confirm).
 *
 * The answers are the route's and nothing else: confirmed (first time),
 * already (a second click — still good news), expired (offer a new link, sent
 * with the OLD token so nobody has to retype an address), invalid (a mangled
 * or made-up link — the same screen for all of them, so the page never says
 * whether a token existed).
 */
export function ConfirmSignup({ share }: { share: ConfirmShareCopy | null }) {
  const { t, locale } = useI18n();
  const token = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const heading = useRef<HTMLHeadingElement>(null);
  /** The visitor pressed the button: from then on every outcome takes focus. */
  const answered = useRef(false);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [referral, setReferral] = useState<{ url: string; credits: number | null } | null>(null);
  const [resent, setResent] = useState<"" | "busy" | "sent" | "error">("");

  useEffect(() => {
    const read = () => {
      let raw: string | null = null;
      try { raw = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t"); } catch { raw = null; }
      if (window.location.hash) {
        try { window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); } catch { /* keep going */ }
      }
      token.current = raw && TOKEN_SHAPE.test(raw) ? raw : null;
      setResent("");
      setStatus(token.current ? "ready" : "invalid");
    };
    read();
    // A link pasted into the tab that is already on this page changes only
    // the fragment — no reload — so the new token arrives as a hashchange.
    const onHash = () => { if (window.location.hash) read(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function confirm(e: React.MouseEvent<HTMLButtonElement>) {
    // A scripted click is not a person agreeing to anything.
    if (!e.isTrusted || !token.current || status === "busy") return;
    answered.current = true;
    setStatus("busy");
    try {
      const res = await fetch("/api/public/prelaunch/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current }),
      });
      if (res.status === 429) { setStatus("rate_limited"); return; }
      const json = (await res.json().catch(() => ({}))) as ConfirmAnswer;
      if (!res.ok || !json.ok) { setStatus(res.status === 400 ? "invalid" : "error"); return; }
      const next = json.status === "confirmed" || json.status === "already" || json.status === "expired"
        ? json.status : "invalid";
      setFirstName(typeof json.first_name === "string" && json.first_name.trim() ? json.first_name.trim() : null);
      const url = typeof json.referral?.url === "string" ? json.referral.url : null;
      const credits = typeof json.referral_credits === "number" && Number.isFinite(json.referral_credits)
        ? json.referral_credits : null;
      setReferral(url ? { url, credits } : null);
      setStatus(next);
      if (next === "confirmed") launchTrack("prelaunch_email_confirmed");
    } catch {
      setStatus("error");
    }
  }

  async function resend() {
    if (!token.current || resent === "busy" || resent === "sent") return;
    setResent("busy");
    try {
      const res = await fetch("/api/public/prelaunch/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current }),
      });
      setResent(res.ok ? "sent" : "error");
    } catch {
      setResent("error");
    }
  }

  const prompt = status === "loading" || status === "ready" || status === "busy";
  const copy = prompt
    ? { title: t("prelaunchUi.confirm.title"), body: t("prelaunchUi.confirm.body") }
    : status === "confirmed"
      ? {
          title: firstName ? t("prelaunchUi.confirm.okTitleName", { name: firstName }) : t("prelaunchUi.confirm.okTitle"),
          body: t("prelaunchUi.confirm.okBody"),
        }
      : status === "already" ? { title: t("prelaunchUi.confirm.alreadyTitle"), body: t("prelaunchUi.confirm.alreadyBody") }
        : status === "expired" ? { title: t("prelaunchUi.confirm.expiredTitle"), body: t("prelaunchUi.confirm.expiredBody") }
          : status === "invalid" ? { title: t("prelaunchUi.confirm.invalidTitle"), body: t("prelaunchUi.confirm.invalidBody") }
            : status === "rate_limited" ? { title: t("common.error"), body: t("prelaunchUi.rateLimited") }
              : { title: t("common.error"), body: t("launch.err") };

  const good = status === "confirmed" || status === "already";
  // THE OUTCOME IS ANNOUNCED. The button the visitor pressed disappears with
  // the answer, so focus would fall to <body> in silence: the heading takes it
  // (and the result region is polite-live), as the signup form's result does.
  const settled = !prompt;
  useEffect(() => {
    if (settled && answered.current) heading.current?.focus();
  }, [settled, status]);
  const Icon = prompt ? MailCheck : good ? CheckCircle2 : status === "expired" ? Clock
    : status === "invalid" ? HelpCircle : AlertTriangle;
  const tone = prompt || good ? "bg-accent-soft/60 text-accent"
    : status === "invalid" ? "bg-sunken text-muted" : "bg-danger/10 text-danger";

  // The credits sentence when the answer carried an approved value; a line
  // with ANY token left in it (an unknown one included) falls back instead.
  const resolved = share && referral ? resolveLine(share.body, { referral: referral.credits }, locale) : null;
  const body = resolved !== null && !/\{[a-zA-Z_]+\}/.test(resolved) ? resolved : null;

  return (
    <div data-confirm-signup={status} className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <span aria-hidden className={cn("inline-flex h-11 w-11 items-center justify-center rounded-xl", tone)}>
        <Icon size={22} />
      </span>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h1 ref={heading} tabIndex={-1} data-confirm-title
          className="mt-5 font-display text-[clamp(1.35rem,4.5vw,1.8rem)] font-semibold leading-tight tracking-tight outline-none">
          {copy.title}
        </h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{copy.body}</p>
      </div>

      {prompt && (
        <button type="button" onClick={confirm} disabled={status !== "ready"} data-confirm-button
          className={cn(
            "cta mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold",
            status !== "ready" && "cursor-wait opacity-70",
          )}>
          {status === "busy" && <Loader2 size={16} className="animate-spin" aria-hidden />}
          {status === "busy" ? t("prelaunchUi.confirm.busy") : t("prelaunchUi.confirm.button")}
        </button>
      )}

      {(status === "error" || status === "rate_limited") && token.current && (
        <button type="button" onClick={() => setStatus("ready")} data-confirm-retry
          className="tap mt-5 text-sm font-semibold text-accent transition-opacity hover:opacity-75">
          {t("common.retry")}
        </button>
      )}

      {status === "expired" && (
        <div className="mt-6">
          {resent === "sent" ? (
            <p role="status" data-confirm-resent className="text-[14px] font-medium text-ink">{t("prelaunchUi.confirm.newLinkSent")}</p>
          ) : (
            <button type="button" onClick={resend} disabled={resent === "busy"} data-confirm-resend
              className="cta flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold">
              {resent === "busy" && <Loader2 size={16} className="animate-spin" aria-hidden />}
              {t("prelaunchUi.confirm.newLink")}
            </button>
          )}
          {resent === "error" && <p role="alert" className="mt-2 text-[13px] font-medium text-danger">{t("launch.err")}</p>}
        </div>
      )}

      {good && share && referral && (
        <ReferralShare url={referral.url} title={share.title} body={body ?? share.bodyNone}
          copyLabel={share.copy} rewardNote={body ? share.rewardNote : null} />
      )}

      <p className="mt-7 border-t border-line pt-5">
        <Link href="/" className="tap text-sm font-medium text-ink underline decoration-accent decoration-2 underline-offset-4 transition-opacity hover:opacity-75">
          ← {t("prelaunchUi.confirm.back")}
        </Link>
      </p>
    </div>
  );
}
