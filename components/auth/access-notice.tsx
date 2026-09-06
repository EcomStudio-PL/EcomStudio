"use client";
import { Clock, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { AccessCopy, BlockedReason } from "@/lib/platform-access";

/**
 * WHAT A CLOSED DOOR SAYS.
 *
 * Not "ACCESS DENIED", not an error banner, not a dead end — an invitation.
 * The customer arrived wanting in; the honest, useful answer is when, and how
 * to be told. So: a short line about where the product is, and the waiting
 * list they already have a flow for.
 *
 * The one case with no waiting list to offer says so plainly and offers
 * nothing it cannot deliver, rather than a button that goes nowhere.
 */
export function AccessNotice({ reason, copy, waitlistEnabled, onWaitlist, onSwitchToLogin }: {
  reason: BlockedReason;
  copy: AccessCopy;
  waitlistEnabled: boolean;
  /** Takes the visitor to the existing waiting-list flow. */
  onWaitlist: () => void;
  /** Only offered when signup is shut but existing customers can still sign in. */
  onSwitchToLogin?: () => void;
}) {
  const { t } = useI18n();

  const text = (custom: string, key: string) =>
    custom.trim() !== "" ? custom : t(key);

  const content = reason === "login_closed"
    ? {
        title: text(copy.loginTitle, "access.loginTitle"),
        body: text(copy.loginBody, "access.loginBody"),
        cta: text(copy.loginCta, "access.joinWaitlist"),
      }
    : reason === "signup_closed"
      ? {
          title: text(copy.signupTitle, "access.signupTitle"),
          body: text(copy.signupBody, "access.signupBody"),
          cta: text(copy.signupCta, "access.joinWaitlist"),
        }
      : {
          title: text(copy.closedTitle, "access.closedTitle"),
          body: text(copy.closedBody, "access.closedBody"),
          cta: "",
        };

  return (
    <div className="relative px-1 pb-4 pt-2 text-center">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(20rem 8rem at 50% -35%, rgb(var(--accent) / 0.18), transparent 70%)" }} />
      <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--accent)/0.14)] text-accent">
        {reason === "closed" ? <Clock size={26} aria-hidden /> : <Sparkles size={26} aria-hidden />}
      </span>
      <h3 className="relative mt-4 font-display text-lg font-semibold tracking-tight">{content.title}</h3>
      <p className="relative mt-2 text-sm leading-relaxed text-muted">{content.body}</p>

      {/* The waiting list is the EXISTING flow — this only points at it. */}
      {waitlistEnabled && reason !== "closed" && (
        <button type="button" onClick={onWaitlist}
          className="cta relative mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold">
          {content.cta}
        </button>
      )}

      {/* Signup shut but the door is open for people who already have an
          account: say so, rather than leaving them guessing. */}
      {reason === "signup_closed" && onSwitchToLogin && (
        <button type="button" onClick={onSwitchToLogin}
          className="relative mt-3 text-sm font-medium text-accent">
          {t("access.haveAccount")}
        </button>
      )}
    </div>
  );
}
