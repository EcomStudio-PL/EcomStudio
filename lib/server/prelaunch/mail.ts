import "server-only";
import { absoluteUrl } from "@/lib/site";
import type { Client } from "@/lib/services/workspace";
import { deliverHtml, type MailIdentity, type SmtpConfig } from "@/lib/server/mailer";
import { dispatchToken, readIntegrationSecrets, safeError, type MailConfig } from "@/lib/server/integrations";
import { defaultTemplate, lookupPublishedTemplate, renderTemplateEmail, type EmailTemplateDef } from "@/lib/server/message-templates";
import { rpcMailPayload, rpcMarkSent, rpcPublicConfig, type MailPayload } from "./rpc";
import { cleanLocale, type PrelaunchLocale } from "./handles";

/**
 * THE TWO MAILS OF THE PRE-LAUNCH LIST — both sent from `after()`, never while
 * the visitor waits, so the response time says nothing about the address.
 *
 * 1. THE DOUBLE OPT-IN (waitlist.optin / _en / _de). Always sent when the
 *    database issued a token — it has no on/off switch, because without it
 *    nobody can ever confirm. The mailbox comes from prelaunch_mail_payload
 *    (the waitlist payload without its welcome switch) plus the Vault password,
 *    exactly as /api/waitlist reads it. The template studio owns the WORDS;
 *    the code owns the LINK: whatever the published template says, its button
 *    points at the computed confirmation URL (the renderAuthMail rule,
 *    lib/server/auth-mail.ts). It never renders a first name (S9) — the
 *    address is not proven yet, so the name is a stranger's free text.
 *    The outcome is written back (prelaunch_mark_sent) for the admin stats.
 *
 * 2. THE WELCOME after a confirmation (waitlist.confirmation / _en / _de),
 *    through waitlist_confirmation_payload — which answers only while the
 *    studio's delivery switch is on. Same switch, same mailbox as before.
 *
 * A failure is logged without the address and without any token: an SMTP
 * error message can quote the recipient, so it is scrubbed first.
 */

const OPTIN_EVENT: Record<PrelaunchLocale, string> = {
  pl: "waitlist.optin", en: "waitlist.optin_en", de: "waitlist.optin_de",
};
const WELCOME_EVENT: Record<PrelaunchLocale, string> = {
  pl: "waitlist.confirmation", en: "waitlist.confirmation_en", de: "waitlist.confirmation_de",
};
/** The button's words when a published template leaves them blank. */
const OPTIN_CTA: Record<PrelaunchLocale, string> = {
  pl: "Potwierdzam zapis", en: "Confirm my signup", de: "Anmeldung bestätigen",
};
const DATE_TAG: Record<PrelaunchLocale, string> = { pl: "pl-PL", en: "en-GB", de: "de-DE" };

export const optinEvent = (locale: string) => OPTIN_EVENT[cleanLocale(locale)];
export const welcomeEvent = (locale: string) => WELCOME_EVENT[cleanLocale(locale)];

/** The double opt-in link. The token rides in the FRAGMENT (S19): a browser
 *  never sends it to a server, so it is in no request log and no GA hit. */
export function confirmLink(rawToken: string): string {
  return `${absoluteUrl("/potwierdz-zapis")}#t=${rawToken}`;
}

/** A confirmed signup's referral link. `ref_code` contains "code", so the GA
 *  sanitiser drops it from every page_location. */
export function referralLink(code: string): string {
  return absoluteUrl(`/?ref_code=${code}`);
}

/** An SMTP error can quote the recipient; a stack can quote a token. */
export function scrubForLog(text: string): string {
  return text
    .replace(/[^\s<>"'(),;:[\]]+@[^\s<>"'(),;:[\]]+/g, "[address]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
}

const logFailure = (kind: string, detail: unknown) =>
  console.error("prelaunch.mail", kind, scrubForLog(typeof detail === "string" ? detail : safeError(detail)));

/** The template for an event: the published one, else its built-in default. */
async function templateFor(supabase: Client, token: string, event: string): Promise<EmailTemplateDef | null> {
  const published = await lookupPublishedTemplate(supabase, token, event, "email");
  const def = (published?.channel === "email" ? published : null) ?? defaultTemplate(`${event}:email`);
  return def?.channel === "email" ? def.email : null;
}

type Transport = { identity: MailIdentity; smtp: SmtpConfig };

/**
 * The mailbox a payload names, with the password PREFERABLY from the Vault —
 * the same order /api/waitlist uses: what the admin last typed into
 * Komunikacja → Kanały wins over the legacy sealed copy on email_settings.
 */
async function transportFrom(supabase: Client, payload: MailPayload): Promise<Transport | null> {
  const s = payload.smtp;
  if (!s || typeof s.host !== "string" || s.host.trim() === "") return null;
  const encryption: SmtpConfig["encryption"] =
    s.encryption === "ssl" ? "ssl" : s.encryption === "tls" || s.encryption === "starttls" ? "tls" : "auto";
  const smtp: SmtpConfig = {
    host: s.host, port: Number(s.port) || 587, user: s.user ?? "", encryption,
    password: s.password ?? null, ciphertext: s.ciphertext, iv: s.iv, auth_tag: s.auth_tag,
  };
  const mail = await readIntegrationSecrets<MailConfig>(supabase, "mail");
  const vault = mail.secrets.smtp_password ?? (mail.config.smtp_same_as_imap ? mail.secrets.imap_password : undefined);
  if (vault) smtp.password = vault;
  return {
    identity: { from_name: payload.from_name ?? "", from_email: payload.from_email ?? "", reply_to: payload.reply_to ?? "" },
    smtp,
  };
}

/** How long a link lives, as the database will enforce it (optin_ttl_hours). */
async function optinTtlHours(supabase: Client): Promise<number> {
  const raw = await rpcPublicConfig(supabase).catch(() => null);
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>).optin_ttl_hours : null;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 336 ? v : 72;
}

/**
 * The double opt-in as it will be sent — published words, our link, no name.
 * Exported for the tests and the studio's reasoning; sendOptinMail is the
 * only caller in production.
 */
export async function renderOptinMail(
  supabase: Client,
  input: { locale: string; to: string; confirmUrl: string; expiresHours: number },
): Promise<{ subject: string; html: string; text: string } | null> {
  const token = dispatchToken();
  if (!token) return null;
  const locale = cleanLocale(input.locale);
  const def = await templateFor(supabase, token, OPTIN_EVENT[locale]);
  if (!def) return null;
  // ONLY these three. A published template that names {{first_name}} renders
  // it empty (the engine drops unknown placeholders) — the name never travels.
  const data = { email: input.to, confirm_url: input.confirmUrl, expires_hours: String(input.expiresHours) };
  const rendered = renderTemplateEmail(
    // The link is ours, not the template's: a published DOI mail must never be
    // one typo — or one malicious edit — away from a button that goes elsewhere.
    { ...def, showCta: true, ctaUrl: input.confirmUrl, ctaLabel: def.ctaLabel.trim() || OPTIN_CTA[locale] },
    data,
    // No field table, whatever the template's showFields says.
    { fields: [] },
  );
  return { subject: rendered.subject, html: rendered.html, text: rendered.text };
}

/**
 * Send one double opt-in and record the outcome. Never throws: it runs in
 * `after()`, where an exception has nobody to reach.
 */
export async function sendOptinMail(
  supabase: Client,
  input: { tokenId: string; to: string; locale: string; rawToken: string },
): Promise<boolean> {
  const token = dispatchToken();
  if (!token) return false;
  let sent = false;
  try {
    const payload = await rpcMailPayload(supabase, token);
    const transport = payload ? await transportFrom(supabase, payload) : null;
    if (!transport) {
      logFailure("optin", "mailbox not configured");
    } else {
      const rendered = await renderOptinMail(supabase, {
        locale: input.locale, to: input.to, confirmUrl: confirmLink(input.rawToken),
        expiresHours: await optinTtlHours(supabase),
      });
      if (!rendered) {
        logFailure("optin", "no template");
      } else {
        const result = await deliverHtml(
          { to: input.to, subject: rendered.subject, text: rendered.text, html: rendered.html },
          transport.identity, transport.smtp,
        );
        sent = result.sent;
        if (!result.sent) logFailure("optin", result.error ?? "not sent");
      }
    }
  } catch (e) {
    logFailure("optin", e);
  }
  try {
    await rpcMarkSent(supabase, token, input.tokenId, sent);
  } catch (e) {
    logFailure("mark_sent", e);
  }
  return sent;
}

/**
 * The welcome after a confirmation — only while the studio's switch is on
 * (waitlist_confirmation_payload answers null when it is off). The first name
 * is allowed here: the address has just been proven, and the name passed the
 * same letters-only rule on the way in.
 */
export async function sendWelcomeMail(
  supabase: Client,
  input: { to: string; firstName: string | null; locale: string },
): Promise<boolean> {
  const token = dispatchToken();
  if (!token) return false;
  try {
    const { data, error } = await supabase.rpc("waitlist_confirmation_payload", { p_token: token });
    if (error || !data || typeof data !== "object") return false;
    const transport = await transportFrom(supabase, data as unknown as MailPayload);
    if (!transport) return false;
    const locale = cleanLocale(input.locale);
    const def = await templateFor(supabase, token, WELCOME_EVENT[locale]);
    if (!def) return false;
    const now = new Date();
    const first = input.firstName ?? "";
    const rendered = renderTemplateEmail(def, {
      first_name: first,
      name: first,
      email: input.to,
      date: now.toLocaleDateString(DATE_TAG[locale], { timeZone: "Europe/Warsaw" }),
      time: now.toLocaleTimeString(DATE_TAG[locale], { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" }),
    }, { fields: [] });
    const result = await deliverHtml(
      { to: input.to, subject: rendered.subject, text: rendered.text, html: rendered.html },
      transport.identity, transport.smtp,
    );
    if (!result.sent) logFailure("welcome", result.error ?? "not sent");
    return result.sent;
  } catch (e) {
    logFailure("welcome", e);
    return false;
  }
}
