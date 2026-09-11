"use client";
import { toast as sonner } from "sonner";

/**
 * NOTIFY — the one door every transient message in the app goes through.
 *
 * The app used to import `toast` from sonner in sixty-three places and let the
 * library decide everything: where the message appeared, how long it stayed,
 * what it looked like. That is how we ended up with a full-width system-red box
 * sliding under the iPhone status bar.
 *
 * This module owns the two things a call site should never have to think about:
 *
 *   · HOW LONG a message stays. A confirmation is read in a glance; a failure
 *     has to survive the moment of "wait, what?" and be re-readable. So an
 *     error lives roughly twice as long as a success. sonner has no per-type
 *     duration on <Toaster>, which is the whole reason this wrapper exists.
 *   · WHICH severity a message is, as a closed set. Four kinds, four accents,
 *     no ad-hoc styling at the call site.
 *
 * WHERE and WHAT IT LOOKS LIKE belong to <AppToaster> (components/ui/toaster),
 * which is mounted once in the root layout.
 *
 * The API is deliberately the same shape as sonner's, so a call site reads
 * identically before and after: notify.success("Zapisano"). Only the import
 * line changes. Anything sonner can do that is NOT here — promise, loading,
 * custom JSX — is absent on purpose: nothing in the app uses it, and adding it
 * later is a deliberate act rather than an accident.
 *
 * Inline form validation is NOT this. A field that is wrong must say so next to
 * itself and keep saying it; a toast that disappears after four seconds is the
 * wrong instrument for a rule the user has to satisfy before submitting.
 */

/** Long enough to read twice. Failures are the messages people actually need. */
const ERROR_MS = 7000;
/** Long enough to register, short enough to get out of the way. */
const OK_MS = 4000;
/** A retry prompt is an instruction, so it sits between the two. */
const WARN_MS = 5500;

type Options = { id?: string | number; duration?: number; description?: string };

/** A toast is a message, not a payload: anything that is not a string is a bug
 *  at the call site, and an empty message is worse than none at all. */
function text(message: unknown): string {
  return typeof message === "string" ? message : String(message ?? "");
}

export const notify = {
  success(message: string, options?: Options) {
    return sonner.success(text(message), { duration: OK_MS, ...options });
  },
  error(message: string, options?: Options) {
    return sonner.error(text(message), { duration: ERROR_MS, ...options });
  },
  warning(message: string, options?: Options) {
    return sonner.warning(text(message), { duration: WARN_MS, ...options });
  },
  info(message: string, options?: Options) {
    return sonner.info(text(message), { duration: OK_MS, ...options });
  },
  /** Neutral, no severity colour — used where the app is narrating, not judging. */
  message(message: string, options?: Options) {
    return sonner.message(text(message), { duration: OK_MS, ...options });
  },
  dismiss(id?: string | number) {
    return sonner.dismiss(id);
  },
};

/**
 * The historical name, so the sixty-three existing call sites keep reading
 * `toast.success(...)` and only their import line had to change. New code can
 * use either; they are the same object.
 */
export const toast = notify;
