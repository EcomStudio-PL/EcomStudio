import "server-only";
import { smtpTransport, type MailIdentity, type SmtpConfig } from "@/lib/server/mailer";
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
  const icon = collapse(payload.icon ?? "");
  const heading = [icon, title].filter((part) => part !== "").join(" ");
  const when = clean(payload.occurredAt, LABEL_MAX);
  const rows = usableRows(payload.rows ?? []);
  const cta = ctaFor(payload);

  const body = [
    `              <tr>
                <td style="padding:0 0 6px 0;font-family:${FONT};font-size:21px;font-weight:700;line-height:1.3;letter-spacing:-0.01em;color:${TEXT};">${esc(heading)}</td>
              </tr>`,
    when
      ? `              <tr>
                <td style="padding:0 0 4px 0;font-family:${FONT};font-size:12px;font-weight:400;line-height:1.5;color:${FAINT};">${esc(when)}</td>
              </tr>`
      : "",
    `              <tr>
                <td style="padding:20px 0;"><div style="height:1px;font-size:0;line-height:1px;background-color:${EDGE};">&nbsp;</div></td>
              </tr>`,
    ...rows.map(([label, value]) => rowHtml(label, value)),
    cta ? ctaHtml(cta) : "",
  ]
    .filter((part) => part !== "")
    .join("\n");

  const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<!-- Declared dark so Apple Mail and Outlook stop "helpfully" inverting a card
     that is already dark and leaving light text on a light ground. -->
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:${CANVAS};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
        <tr>
          <td style="padding:0 4px 16px 4px;font-family:${FONT};font-size:20px;font-weight:700;line-height:1;letter-spacing:-0.02em;color:${TEXT};">Grov<span style="color:${ACCENT_LIGHT};">Base</span></td>
        </tr>
        <tr>
          <td style="background-color:${CARD};border:1px solid ${EDGE};border-radius:16px;padding:28px 28px 24px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
${body}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 4px 0 4px;font-family:${FONT};font-size:12px;font-weight:400;line-height:1.5;color:${FAINT};">GrovBase · grovbase.com</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    when ? `${heading}\n${when}` : heading,
    rows.map(([label, value]) => (label ? `${label}: ${value}` : value)).join("\n"),
    cta ? `${cta.label}: ${cta.href}` : "",
    "GrovBase · grovbase.com",
  ]
    .filter((block) => block !== "")
    .join("\n\n");

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
): Promise<{ ok: boolean; error?: string }> {
  const recipient = collapse(to);
  if (!recipient) return { ok: false, error: "no_recipient" };
  const from = fromHeader(identity);
  if (!from) return { ok: false, error: "not_configured" };
  const transport = smtpTransport(smtp);
  if (!transport) return { ok: false, error: "not_configured" };

  const { subject, html, text } = renderAdminNotification(payload);
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
