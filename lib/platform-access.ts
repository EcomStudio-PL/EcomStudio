/**
 * WHO MAY GET IN — the shape of it, shared by client and server.
 *
 * This is PUBLIC access control: may a stranger create an account, may an
 * existing customer sign in, do the buttons even appear. It is deliberately
 * NOT the Feature Availability registry, which governs modules AFTER sign-in;
 * mixing the two would mean "the platform is closed" and "the video tool is in
 * maintenance" shared one switch.
 *
 * Four independent flags rather than one, because the four states the business
 * actually needs are all combinations of them: open, existing-customers-only,
 * pre-launch with a waiting list, and closed.
 */

export type PlatformAccess = {
  /** May a NEW account be created (e-mail or social). */
  allowSignup: boolean;
  /** May an existing customer sign in. Admins are never covered by this. */
  allowLogin: boolean;
  /** Are the sign-in / sign-up entry points drawn at all. Presentation only —
   *  a hidden button is not a closed door, which is why the two above are
   *  enforced on the server regardless of this. */
  showAuthEntry: boolean;
  /** Offer the waiting list when the door is shut. */
  waitlistEnabled: boolean;
  /** Optional scheduled opening: before it, signup stays closed even if the
   *  switch is on. Computed server-side, never from a device clock. */
  signupOpensAt: string | null;
  copy: AccessCopy;
  mobileOverride: boolean;
  mobileCopy: AccessCopy;
};

/** The three things a shut door can say. Each is a title, a body and a CTA. */
export type AccessCopy = {
  loginTitle: string; loginBody: string; loginCta: string;
  signupTitle: string; signupBody: string; signupCta: string;
  closedTitle: string; closedBody: string;
};

export const EMPTY_ACCESS_COPY: AccessCopy = {
  loginTitle: "", loginBody: "", loginCta: "",
  signupTitle: "", signupBody: "", signupCta: "",
  closedTitle: "", closedBody: "",
};

export const ACCESS_DEFAULTS: PlatformAccess = {
  allowSignup: true,
  allowLogin: true,
  showAuthEntry: true,
  waitlistEnabled: false,
  signupOpensAt: null,
  copy: EMPTY_ACCESS_COPY,
  mobileOverride: false,
  mobileCopy: EMPTY_ACCESS_COPY,
};

/**
 * The four presets, as a convenience over the flags — never instead of them.
 * The panel writes real flags; this only names the combinations so an operator
 * can pick "Przedpremiera" without reasoning about four switches.
 */
export type PlatformMode = "open" | "existing_only" | "prelaunch" | "closed" | "custom";

export const MODE_PRESETS: Record<Exclude<PlatformMode, "custom">, Pick<
  PlatformAccess, "allowSignup" | "allowLogin" | "showAuthEntry" | "waitlistEnabled"
>> = {
  open:          { allowSignup: true,  allowLogin: true,  showAuthEntry: true,  waitlistEnabled: false },
  existing_only: { allowSignup: false, allowLogin: true,  showAuthEntry: true,  waitlistEnabled: true },
  prelaunch:     { allowSignup: false, allowLogin: false, showAuthEntry: true,  waitlistEnabled: true },
  closed:        { allowSignup: false, allowLogin: false, showAuthEntry: false, waitlistEnabled: false },
};

/** Which preset a configuration corresponds to, or "custom". */
export function modeOf(access: PlatformAccess): PlatformMode {
  for (const [mode, preset] of Object.entries(MODE_PRESETS)) {
    if (preset.allowSignup === access.allowSignup
      && preset.allowLogin === access.allowLogin
      && preset.showAuthEntry === access.showAuthEntry
      && preset.waitlistEnabled === access.waitlistEnabled) {
      return mode as PlatformMode;
    }
  }
  return "custom";
}

/**
 * Is signup open RIGHT NOW. The switch and the schedule are both consulted,
 * and `now` is always the server's clock — the caller passes it, so no client
 * can move the opening date by changing its own.
 */
export function signupOpen(access: PlatformAccess, now: Date): boolean {
  if (!access.allowSignup) return false;
  if (access.signupOpensAt) {
    const opens = new Date(access.signupOpensAt).getTime();
    if (Number.isFinite(opens) && now.getTime() < opens) return false;
  }
  return true;
}

/** What a blocked attempt should be told. `closed` is the case with no waiting
 *  list to offer — the one message that must not end in a dead CTA. */
export type BlockedReason = "login_closed" | "signup_closed" | "closed";

export function blockedReasonFor(
  access: PlatformAccess,
  intent: "login" | "register",
  now: Date,
): BlockedReason | null {
  if (intent === "login") {
    if (access.allowLogin) return null;
    return access.waitlistEnabled ? "login_closed" : "closed";
  }
  if (signupOpen(access, now)) return null;
  return access.waitlistEnabled ? "signup_closed" : "closed";
}

/** Mobile falls back to the desktop line by line, so overriding one sentence
 *  does not mean retyping the other seven. */
export function accessCopyFor(access: PlatformAccess, mobile: boolean): AccessCopy {
  if (!mobile || !access.mobileOverride) return access.copy;
  const m = access.mobileCopy;
  const pick = (a: string, b: string) => (a.trim() !== "" ? a : b);
  return {
    loginTitle: pick(m.loginTitle, access.copy.loginTitle),
    loginBody: pick(m.loginBody, access.copy.loginBody),
    loginCta: pick(m.loginCta, access.copy.loginCta),
    signupTitle: pick(m.signupTitle, access.copy.signupTitle),
    signupBody: pick(m.signupBody, access.copy.signupBody),
    signupCta: pick(m.signupCta, access.copy.signupCta),
    closedTitle: pick(m.closedTitle, access.copy.closedTitle),
    closedBody: pick(m.closedBody, access.copy.closedBody),
  };
}
