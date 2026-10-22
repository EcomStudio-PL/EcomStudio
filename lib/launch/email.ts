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
 * An internationalised domain is checked — and stored — in its ASCII
 * (punycode) form, and a punycode TLD is a TLD.
 */
export const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Trimmed, lower-cased, the domain in ASCII: 'Jan@Żółw.PL' → 'jan@xn--w-uga1v8h.pl'.
 * The URL parser does the IDNA conversion the same way in a browser and in
 * Node; a domain it refuses stays as typed (and then fails the rule).
 */
export function asciiEmail(value: string): string {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  const domain = email.slice(at + 1);
  if (/^[\x00-\x7f]*$/.test(domain)) return email;
  try {
    const host = new URL(`http://${domain}`).hostname;
    return host ? `${email.slice(0, at)}@${host}` : email;
  } catch {
    return email;
  }
}

/** Shaped like an address under that rule (≤ 254, after asciiEmail). */
export function isLaunchEmail(value: string): boolean {
  const email = asciiEmail(value);
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}
