/**
 * THE RESEND BUTTON'S STATE — one function, so the rule is readable and can be
 * tested without a browser.
 *
 * Four states, in priority order: a send in flight, a code that has already
 * expired (which may ALWAYS be replaced), a cooldown that is still running, and
 * a button that is simply ready.
 *
 * The cooldown is not the code's lifetime. It is how long the SERVER refuses to
 * issue a new code — `resend_seconds` in the login-security settings, 60 s by
 * default — while the code itself lives for `code_ttl_seconds`. Rendering the
 * cooldown does not shorten either.
 */
export type ResendView = {
  /** i18n key for the label. */
  labelKey: string;
  /** mm:ss, only for the cooldown label. */
  time?: string;
  disabled: boolean;
  /** Whether to show the spinner. */
  loading: boolean;
};

/** Seconds → mm:ss. Used by both countdowns on the security screen. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function resendView(
  state: { sending: boolean; expired: boolean; cooldown: number },
): ResendView {
  if (state.sending) return { labelKey: "security.sending", disabled: true, loading: true };
  if (state.expired) return { labelKey: "security.newCode", disabled: false, loading: false };
  if (state.cooldown > 0) {
    return { labelKey: "security.resendIn", time: mmss(state.cooldown), disabled: true, loading: false };
  }
  return { labelKey: "security.resend", disabled: false, loading: false };
}
