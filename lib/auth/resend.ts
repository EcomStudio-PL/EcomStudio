/**
 * THE RESEND BUTTON'S STATE — one function, so the rule is readable and can be
 * tested without a browser.
 *
 * Four states, in priority order: a send in flight, a code that has expired
 * (which may be replaced), a code still alive (which may NOT), and a button
 * that is simply ready.
 *
 * THE COOLDOWN *IS* THE CODE'S LIFETIME NOW. It used to be a second, shorter
 * setting — `resend_seconds`, 59 s, against a 120 s code — so the screen
 * carried two clocks that disagreed and a person could hold a second code
 * while the first still verified. Migration 0111 retired that knob: a
 * replacement may be asked for exactly when the current code dies, so the
 * caller passes the code's own remaining seconds as `cooldown` and the two
 * lines on the screen cannot drift apart.
 *
 * This function only renders a decision. The refusal that matters is the
 * database's (login_challenge_start), which answers the same way whether or
 * not this button was ever drawn.
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
