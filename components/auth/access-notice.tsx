"use client";
import { Clock, Gift, Rocket } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { AccessPerk } from "@/app/actions/platform-access";
import type { AccessCopy, BlockedReason } from "@/lib/platform-access";

/**
 * WHAT A CLOSED DOOR SAYS.
 *
 * Not "ACCESS DENIED", not an error banner, not a dead end — an invitation.
 * The customer arrived wanting in; the honest, useful answer is when, and how
 * to be told. So: a short line about where the product is, the bonuses the
 * waiting list actually carries, and the list they already have a flow for.
 *
 * This is the WHOLE dialog when it shows, not a panel underneath a "Zaloguj
 * się" heading — see auth-modal.tsx. A visitor who is told to sign in and then
 * told they cannot has read two contradicting things in one card.
 *
 * The one case with no waiting list to offer says so plainly and offers
 * nothing it cannot deliver, rather than a button that goes nowhere.
 */
export function AccessNotice({
  reason, copy, waitlistEnabled, perks = [], onWaitlist, onSwitchToLogin, titleId,
}: {
  reason: BlockedReason;
  copy: AccessCopy;
  waitlistEnabled: boolean;
  /** The launch page's own bonus lines. Empty renders no strip at all. */
  perks?: AccessPerk[];
  /** Takes the visitor to the existing waiting-list flow. */
  onWaitlist: () => void;
  /** Only offered when signup is shut but existing customers can still sign in. */
  onSwitchToLogin?: () => void;
  /** The dialog labels itself by this heading, so it must carry the id. */
  titleId?: string;
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

  const showList = waitlistEnabled && reason !== "closed";

  return (
    <div data-access-notice={reason} className="relative px-1 pb-1 pt-1 text-center">
      {/* One soft wash behind the mark. The card already has its own light. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{ background: "radial-gradient(18rem 7rem at 50% -30%, rgb(var(--accent) / 0.20), transparent 70%)" }} />

      {/* Not the header logo — a mark about WAITING, which is what this card
          is about. The dialog no longer carries the brand lockup above it, so
          this is the one symbol, and it should say "soon", not "GrovBase". */}
      <span aria-hidden className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--accent)/0.14)] text-accent ring-1 ring-inset ring-[rgb(var(--accent)/0.22)]">
        {reason === "closed" ? <Clock size={25} /> : <Rocket size={25} />}
      </span>

      <h2 id={titleId}
        className="relative mt-4 font-display text-[20px] font-semibold leading-tight tracking-tight sm:text-[22px]">
        {content.title}
      </h2>
      <p className="relative mx-auto mt-2 max-w-[34rem] text-[13.5px] leading-relaxed text-muted sm:text-sm">
        {content.body}
      </p>

      {/* THE BONUSES — compact, one row, no cards. They come from the launch
          page's own content, so what is promised here is what is promised
          there. Nothing is drawn when nothing is configured. */}
      {showList && perks.length > 0 && (
        <ul data-access-perks
          className="relative mt-5 grid grid-cols-3 gap-1.5 text-left sm:gap-2">
          {perks.slice(0, 3).map((p) => (
            <li key={`${p.t}${p.b}`}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-[rgb(var(--glass-border)/0.18)] bg-[rgb(var(--sunken)/0.5)] px-1.5 py-2.5 text-center">
              <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--accent)/0.16)] text-accent">
                <Gift className="h-3 w-3" />
              </span>
              <span className="min-w-0 leading-[1.25]">
                <span className="block text-[10.5px] font-semibold text-ink sm:text-[11.5px]">{p.t}</span>
                {p.b && <span className="block text-[9.5px] text-faint sm:text-[10.5px]">{p.b}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The waiting list is the EXISTING flow — this only points at it. */}
      {showList && (
        <button type="button" onClick={onWaitlist} data-access-cta
          className="cta relative mt-5 inline-flex h-12 w-full items-center justify-center rounded-xl px-5 text-[14.5px] font-semibold">
          {content.cta}
        </button>
      )}

      {/* Signup shut but the door is open for people who already have an
          account: say so, rather than leaving them guessing. */}
      {reason === "signup_closed" && onSwitchToLogin && (
        <button type="button" onClick={onSwitchToLogin} data-access-login
          className="relative mt-3 text-[13.5px] font-medium text-accent transition-opacity hover:opacity-75">
          {t("access.haveAccount")}
        </button>
      )}
    </div>
  );
}
