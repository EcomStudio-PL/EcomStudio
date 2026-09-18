"use client";
import { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/provider";
import { CONSENT_VERSION, isUnsubscribeToken } from "@/lib/newsletter-consent";

/**
 * "TO BYŁA POMYŁKA — ZAPISZ MNIE Z POWROTEM."
 *
 * The other half of one-click. The page unsubscribes the moment it opens, with
 * no confirmation, which is right for the person who meant it and unkind to the
 * person whose corporate link scanner opened the footer link for them. This is
 * what makes that trade honest.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT CALLS newsletter_resubscribe AND NOT newsletter_subscribe
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Because `newsletter_subscribe` cannot do this, and that is by design rather
 * than by omission. Three walls, all of them load-bearing:
 *
 *   · `newsletter_unsubscribe` answers with a status and never the address, so
 *     nothing on this page knows whom it just unsubscribed;
 *   · `newsletter_contacts` is admin-only under RLS, so the address cannot be
 *     looked up from the token either — which is precisely what makes it safe
 *     to put an unsubscribe token in an email;
 *   · `newsletter_subscribe` returns 'suppressed' for any address on the
 *     suppression list, and unsubscribing always writes one.
 *
 * So the way back in is a door with a different key: the token, which only the
 * recipient has. supabase/migrations/0096_newsletter_resubscribe.sql has the
 * full argument, including which suppressions it refuses to lift.
 *
 * IT TALKS TO THE DATABASE DIRECTLY, from the browser, with the anon key. That
 * is not a shortcut around a server route — `newsletter_resubscribe` is a
 * SECURITY DEFINER function with an explicit `grant execute ... to anon`, the
 * same anon surface `newsletter_subscribe`, `newsletter_unsubscribe` and
 * `newsletter_track` all sit on, and the function is the security boundary. A
 * route in front of it would add a hop and no check.
 *
 * WHAT IT COSTS: this button needs JavaScript. The thing that must work without
 * it — the unsubscribe itself — is done by the server component before this
 * ever renders, so a visitor with scripting off is still unsubscribed and still
 * reads the confirmation. Only the recovery affordance is scripted, and a
 * mistaken unsubscribe is recoverable by replying to any message besides.
 */

type State = "idle" | "sending" | "done" | "error";

export function Resubscribe({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>("idle");

  async function run() {
    if (state === "sending" || state === "done") return;
    // The page already rejected a malformed token before it got here; this is
    // the same guard repeated because the RPC's parameter is a `uuid` and a bad
    // one is a cast error rather than an empty result.
    if (!isUnsubscribeToken(token)) { setState("error"); return; }

    setState("sending");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("newsletter_resubscribe", {
        p_token: token.toLowerCase(),
        // What they have just agreed to, by version. See lib/newsletter-consent.ts:
        // bump it whenever the wording of `newsletter.form.consent` changes.
        p_consent_version: CONSENT_VERSION,
      });
      if (error) { setState("error"); return; }
      // THE FUNCTION'S ANSWER IS THE ANSWER. 'blocked' means the address is
      // suppressed for a reason that is not this person's to lift — a bounce, a
      // spam complaint, an operator's block — and 'unknown' means the migration
      // has not been applied or the token no longer resolves. Neither is a
      // success, and neither may be shown as one: a button that says "zapisane"
      // over an unchanged database is the exact failure this module refuses to
      // ship elsewhere.
      const result = (data ?? {}) as { status?: string };
      setState(result.status === "resubscribed" ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p role="status"
        className="mt-6 rounded-xl border border-accent/30 bg-accent-soft/50 px-4 py-3 text-[13.5px] font-medium text-accent">
        {t("newsletter.unsub.resubscribed")}
      </p>
    );
  }

  return (
    <div className="mt-6">
      <button type="button" onClick={run} disabled={state === "sending"}
        // min-h-[44px] and `text-left` rather than a centred pill: the label is
        // a full sentence and wraps to three lines at 320px, which a fixed-
        // height centred button turns into overflow.
        className="tap inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-line bg-sunken/60 px-5 py-3 text-center text-[13.5px] font-semibold text-ink transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-60 sm:w-auto">
        {state === "sending"
          ? <Loader2 size={15} aria-hidden className="animate-spin" />
          : <Undo2 size={15} aria-hidden />}
        {t("newsletter.unsub.resubscribe")}
      </button>
      {state === "error" && (
        <p role="alert" className="mt-2.5 text-[12.5px] font-medium text-danger">
          {t("newsletter.err.generic")}
        </p>
      )}
    </div>
  );
}
