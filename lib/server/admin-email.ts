import "server-only";
import { smtpTransport, type MailIdentity, type SmtpConfig } from "@/lib/server/mailer";
import { renderEmailTemplate, type EmailField } from "@/lib/server/email-template";
import { safeError } from "@/lib/server/integrations";
import { absoluteUrl } from "@/lib/site";

/**
 * THE ADMIN NOTIFICATION CARD — the same event, addressed to an inbox.
 *
 * Telegram is where the operator looks NOW; the mailbox is where they look
 * LATER, so this renders the same payload as a piece of mail that survives
 * being read a week after it arrived: a dark GrovBase card, one definition-list
 * row per fact, and a single button back into the panel.
 *
 * Three constraints shape every line of the markup below.
 *
 *   1. Mail clients are not browsers. Outlook renders with Word, Gmail strips
 *      <style>, and none of them can be trusted with flexbox — so the layout is
 *      nested tables with fully inline styles, capped at 560px, on a system
 *      font stack. No external CSS, no webfont, no script, and no tracking
 *      pixel: an operator's own notification has nothing to measure.
 *   2. The payload is attacker-influenced. A signup name is typed by a
 *      stranger, so every interpolated value goes through `esc` (attributes
 *      included) and the subject is collapsed to one line — a raw CR/LF there
 *      is a header injection, not a formatting quirk.
 *   3. Links must work from someone else's inbox. The CTA is built with
 *      absoluteUrl(), never a relative path and never whatever host the
 *      request arrived on, and a href that is not http(s) is dropped rather
 *      than rendered.
 */

export type AdminEventPayload = {
  /** The notification event, e.g. "user.registered" — it picks the subject. */
  eventType: string;
  /** Display-ready, already localised: this is printed verbatim, not parsed. */
  occurredAt: string;
  title: string;
  icon?: string;
  /** Label/value pairs; an empty value drops the whole row. */
  rows: [string, string][];
  /** Overrides the per-event default button. */
  ctaLabel?: string;
  ctaHref?: string;
};

/** The card's palette, spelled out rather than themed: an e-mail cannot read
 *  CSS variables, and it must look the same in every client. */
const CANVAS = "#0A0710";
const CARD = "#15101F";
const EDGE = "#2C2338";
const TEXT = "#F6F2FA";
const MUTED = "#9C90AC";
const FAINT = "#6C6079";
/** The brand gradient. ACCENT doubles as the solid bgcolor fallback, because
 *  Outlook ignores background-image and would otherwise draw white on white. */
const ACCENT = "#D628CF";
const ACCENT_LIGHT = "#F950E1";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Same caps as the Telegram formatter: nothing legitimate is longer, and a
 *  runaway value must not turn one notification into a megabyte of mail. */
const TITLE_MAX = 200;
const LABEL_MAX = 80;
const VALUE_MAX = 300;

const SUBJECTS: Readonly<Record<string, string>> = {
  "user.registered": "🎉 Nowa rejestracja — GrovBase",
  "waitlist.signup": "📝 Nowy zapis na listę — GrovBase",
};

/** Where each event is actually handled in the panel. An event with no entry
 *  gets the dashboard, which is never the wrong place to land. */
const DESTINATIONS: Readonly<Record<string, { label: string; path: string }>> = {
  "user.registered": { label: "Otwórz listę użytkowników", path: "/admin/users" },
  "waitlist.signup": { label: "Otwórz listę oczekujących", path: "/admin/waitlist" },
};

const DEFAULT_DESTINATION = { label: "Otwórz panel GrovBase", path: "/admin" };

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clean(text: string, max: number): string {
  const collapsed = collapse(text);
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max).trimEnd()}…`;
}

/** Text AND attribute escaping in one function, so no call site has to decide
 *  which one it needed — quotes are escaped either way. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only an absolute http(s) URL may become a button. Anything else — a relative
 *  path, a javascript: URL from a payload we did not write — is dropped. */
function safeHref(href: string): string | null {
  const url = collapse(href);
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

function subjectFor(payload: AdminEventPayload): string {
  const known = SUBJECTS[payload.eventType];
  if (known) return known;
  // The fallback still has to read like a subject and not like a log line, so
  // it reuses the payload's own headline and keeps the brand suffix.
  const title = clean(payload.title, TITLE_MAX);
  const icon = collapse(payload.icon ?? "");
  const head = [icon, title].filter((part) => part !== "").join(" ");
  return head ? `${head} — GrovBase` : "Powiadomienie — GrovBase";
}

function ctaFor(payload: AdminEventPayload): { label: string; href: string } | null {
  const fallback = DESTINATIONS[payload.eventType] ?? DEFAULT_DESTINATION;
  // A caller may name its own destination, but it does not get to bypass the
  // http(s) rule: an unusable href drops back to the panel link.
  const href = safeHref(payload.ctaHref ?? "") ?? absoluteUrl(fallback.path);
  const label = clean(payload.ctaLabel ?? fallback.label, LABEL_MAX);
  return label ? { label, href } : null;
}

/** The rows worth printing: cleaned, capped, and stripped of the ones whose
 *  value never arrived — a label with nothing under it is noise in an e-mail
 *  exactly as it is in Telegram. */
function usableRows(rows: [string, string][]): [string, string][] {
  return rows
    .map(([label, value]) => [clean(label, LABEL_MAX), clean(value, VALUE_MAX)] as [string, string])
    .filter(([, value]) => value !== "");
}

function rowHtml(label: string, value: string): string {
  const labelCell = label
    ? `              <tr>
                <td style="padding:0 0 5px 0;font-family:${FONT};font-size:11px;font-weight:600;line-height:1.4;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${esc(label)}</td>
              </tr>\n`
    : "";
  return `${labelCell}              <tr>
                <td style="padding:0 0 18px 0;font-family:${FONT};font-size:16px;font-weight:500;line-height:1.5;color:${TEXT};word-break:break-word;">${esc(value)}</td>
              </tr>`;
}

function ctaHtml(cta: { label: string; href: string }): string {
  // The bulletproof button: colour on the <td> (bgcolor for Outlook, which
  // drops the gradient), padding on the <a>, so the whole block stays clickable
  // even where border-radius and background-image are ignored.
  return `              <tr>
                <td style="padding:8px 0 2px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td bgcolor="${ACCENT}" style="border-radius:10px;background-color:${ACCENT};background-image:linear-gradient(135deg,${ACCENT} 0%,${ACCENT_LIGHT} 100%);">
                      <a href="${esc(cta.href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(cta.label)}</a>
                    </td>
                  </tr></table>
                </td>
              </tr>`;
}

/**
 * The payload as a subject line, an HTML card and the plain-text alternative
 * that always ships with it — a text/plain part is what keeps the message out
 * of the spam folder and readable in a client that refuses HTML.
 *
 * Pure and side-effect free, which is what lets scripts/comm-tests.ts assert
 * the escaping and the row-dropping without a mail server.
 */
export function renderAdminNotification(payload: AdminEventPayload): { subject: string; html: string; text: string } {
  const subject = clean(subjectFor(payload), TITLE_MAX);
  const title = clean(payload.title, TITLE_MAX);
  const when = clean(payload.occurredAt, LABEL_MAX);
  const cta = ctaFor(payload);

  // The rows arrive with the Telegram emoji at the front of each label
  // ("👤 Użytkownik") — an e-mail table wants the words, so the emoji is
  // stripped and only a label that still says something survives.
  const fields: EmailField[] = usableRows(payload.rows ?? []).map(([label, value]) => {
    const words = label.replace(/^[^\p{L}\p{N}]+/u, "").trim() || label;
    const mono = /ip|e-mail|email|telefon|url|wejście/i.test(words);
    return { label: words, value, mono };
  });

  const { html, text } = renderEmailTemplate({
    badge: clean(payload.eventType, LABEL_MAX).toUpperCase(),
    title: [collapse(payload.icon ?? ""), title].filter(Boolean).join(" "),
    fields,
    cta: cta ? { label: cta.label, url: cta.href } : undefined,
    footer: "GrovBase Admin",
    timestamp: when,
  });
  return { subject, html, text };
}

/** One address, collapsed so a stray newline can never become a second header,
 *  and quoted the way nodemailer expects a display name. */
function fromHeader(identity: MailIdentity): string | null {
  const email = collapse(identity.from_email);
  if (!email) return null;
  const name = collapse(identity.from_name);
  return name ? `${name} <${email}>` : email;
}

/**
 * Send one card.
 *
 * It builds the transport itself rather than calling `deliver`, for two
 * reasons: deliver() sends text/plain only, and it falls back to Resend when
 * SMTP cannot be built — which for an admin notification would quietly send
 * from a different identity than the mailbox the operator configured. Here a
 * transport that cannot be built is an honest "not_configured".
 *
 * Never throws, and never returns a raw SMTP error: those quote the session,
 * and the session carries the credentials.
 */
export async function sendAdminNotification(
  smtp: SmtpConfig | null,
  identity: MailIdentity,
  to: string,
  payload: AdminEventPayload,
  rendered?: { subject: string; html: string; text: string },
): Promise<{ ok: boolean; error?: string }> {
  const recipient = collapse(to);
  if (!recipient) return { ok: false, error: "no_recipient" };
  const from = fromHeader(identity);
  if (!from) return { ok: false, error: "not_configured" };
  const transport = smtpTransport(smtp);
  if (!transport) return { ok: false, error: "not_configured" };

  // A pre-rendered message (a published admin template) wins over the default
  // card; both come through the same escaping and the same layout module.
  const { subject, html, text } = rendered ?? renderAdminNotification(payload);
  try {
    await transport.sendMail({
      from,
      to: recipient,
      subject,
      text,
      html,
      replyTo: collapse(identity.reply_to) || undefined,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e) };
  } finally {
    transport.close();
  }
}
