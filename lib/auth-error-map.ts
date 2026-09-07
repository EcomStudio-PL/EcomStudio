/**
 * WHAT GOTRUE SAID → WHAT THE CUSTOMER IS TOLD.
 *
 * Pure, so it can be tested exhaustively without a database, a mailbox or a
 * running signup — which matters, because this table is what a customer reads
 * when something goes wrong, and it was wrong once already: a failing
 * confirmation e-mail reached the browser as "could not reach the server",
 * which sent people to check their wi-fi while the actual fault was ours and
 * a resend was one click away.
 *
 * Raw Supabase text NEVER reaches the customer. Neither does the fact that an
 * address is already registered — with confirmations on, GoTrue answers a
 * repeat signup with a success-shaped response, and the UI shows the same
 * check-your-inbox screen either way. Nothing here undoes that.
 */

export type SignUpErrorTarget =
  | { field: "password" | "email"; code: string }
  | { form: "rate_limited" | "activation_send" | "network" };

export type GoTrueErrorLike = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
};

export function mapSignUpError(error: GoTrueErrorLike): SignUpErrorTarget {
  const message = error.message ?? "";
  const code = error.code ?? "";
  const status = error.status ?? 0;

  // Weak / short / pwned password — GoTrue is authoritative here because the
  // project's own password policy lives in its config, not in our regex.
  if (/password/i.test(message)) return { field: "password", code: "pw_length" };

  // Deliverability beyond our format check: reserved TLDs, known-bad domains.
  // That belongs on the e-mail field, not on a server banner.
  if (code === "email_address_invalid" || /email.+invalid/i.test(message)) {
    return { field: "email", code: "email" };
  }

  // Confirmation mails are quota-limited. "Try again shortly" is the truth.
  if (status === 429 || code === "over_email_send_rate_limit") {
    return { form: "rate_limited" };
  }

  // The activation mail did not go out. Three shapes reach us: GoTrue's own
  // SMTP wording, a Send Email Hook that answered non-2xx (which GoTrue
  // reports as a hook failure, or as nothing recognisable at all), and the
  // bare 500 both collapse into. Any 500 out of signup is OURS — the request
  // plainly reached Supabase to be answered — so it is never "network".
  if (
    /send.*(confirmation|email)|email.*send|hook/i.test(message)
    || code === "unexpected_failure"
    || status === 500
  ) {
    return { form: "activation_send" };
  }

  // What is left: a request that genuinely did not complete.
  return { form: "network" };
}
