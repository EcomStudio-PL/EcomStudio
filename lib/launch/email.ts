/**
 * THE PRE-LAUNCH ADDRESS RULE — one pattern for the form, the routes and (as a
 * copy) the SQL's prelaunch_email_ok, so a visitor is never told "sent" by the
 * browser and "invalid" by the server.
 *
 * Strict on purpose (review S6): an RFC 5322 dot-atom local part and LDH
 * domain labels — no comments, quotes, commas, semicolons, colons or brackets.
 * The looser "anything around an @" accepted 'a(1)x@gmail.com' and
 * 'y,x@gmail.com', which the mailer re-parses into x@gmail.com: as many DOI
 * mails to one inbox as there are spellings, past every per-address limit.
 * Tested against the address lower-cased.
 */
export const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Shaped like an address under that rule (≤ 254, compared lower-cased). */
export function isLaunchEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}
