/**
 * THE WORDING SOMEBODY AGREED TO, AS A VERSION STRING.
 *
 * `newsletter_contacts.consent_version` exists so that an operator asked "what
 * exactly did this person tick?" two years from now can answer it. That only
 * works if the version changes whenever the WORDING changes — a constant that
 * is set once and never touched again records nothing at all and is worse than
 * an empty column, because it looks like an answer.
 *
 * So the rule, and it is the whole reason this file exists rather than a string
 * literal at each call site:
 *
 *   BUMP THIS WHENEVER `newsletter.form.consent` CHANGES IN
 *   lib/i18n/dictionaries/{pl,en,de}.json.
 *
 * Both writers share it — the public form handler that records a new signup and
 * the resubscribe link on the unsubscribe page — so the two can never drift and
 * claim two different texts for the same sentence on screen.
 *
 * WHY THE DICTIONARY IS THE CANONICAL WORDING, and not whatever copy an admin
 * typed into the CMS section. A page-builder section has a free-text subtitle,
 * and if that were the consent sentence then every page would carry its own
 * unversioned agreement and this column could never be honest. The subtitle
 * stays what it is — descriptive copy above the form — and the sentence the
 * checkbox is attached to is always the reviewed one from the dictionary, in
 * the visitor's language.
 *
 * Isomorphic and dependency-free on purpose: the API route imports it on the
 * server, the unsubscribe page's button imports it in the browser.
 */
export const CONSENT_VERSION = "form-v1";

/**
 * Where the agreement was given, for `consent_source`. Values are short and
 * stable because they are read back in the admin panel's contact screen next
 * to the date — "cms_form" and "resubscribe_link" each answer a different
 * question about how somebody ended up on the list.
 */
export const CONSENT_SOURCE_FORM = "cms_form";
export const CONSENT_SOURCE_RESUBSCRIBE = "resubscribe_link";

/** The shape every unsubscribe token has. Spelled here rather than inlined at
 *  four call sites because all four must agree: `newsletter_unsubscribe` and
 *  `newsletter_resubscribe` take a `uuid`, and PostgREST answers a malformed
 *  one with a 22P02 cast error rather than a row count of zero. A token that
 *  cannot be a uuid is therefore rejected before it is ever sent — which is
 *  also what turns "somebody truncated the link" into the honest "this link is
 *  not valid" screen instead of a 500. */
export const UNSUBSCRIBE_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUnsubscribeToken = (value: string): boolean =>
  UNSUBSCRIBE_TOKEN_RE.test(value.trim());
