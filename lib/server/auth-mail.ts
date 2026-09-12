import "server-only";
import type { Client } from "@/lib/services/workspace";
import { AUTH_EMAIL_TEMPLATES } from "@/lib/server/auth-email-templates";
import { dispatchToken, readIntegrationSecrets, safeError, type MailConfig } from "@/lib/server/integrations";
import { deliverHtml, type MailIdentity, type SmtpConfig } from "@/lib/server/mailer";
import { lookupPublishedTemplate, renderTemplateEmail } from "@/lib/server/message-templates";
import { absoluteUrl } from "@/lib/site";

/**
 * AUTH E-MAILS, WRITTEN AND SENT BY GROVBASE.
 *
 * Supabase still owns authentication: it creates the account, mints the token
 * and validates it when the customer comes back. What it no longer owns is
 * the MESSAGE. With the Send Email Hook enabled, GoTrue stops rendering its
 * own templates and posts the token here instead; this module turns that into
 * a GrovBase e-mail and hands it to the mailbox the operator already
 * configured (contact@grovbase.com).
 *
 * Two sources of copy, in this order, and no third:
 *
 *   1. the PUBLISHED template from Admin → Szablony wiadomości;
 *   2. the built-in GrovBase template in this repository.
 *
 * A draft is never sent — publishing is what makes copy live, and that has to
 * stay true for auth mail too. And there is deliberately no fallback to a
 * Supabase-branded default: if everything else failed we would rather send
 * the shipped GrovBase words than something with another company's name on it.
 *
 * THE LINK IS NEVER THE TEMPLATE'S. Whatever an admin types, the call to
 * action points at the URL computed here from the token in this payload —
 * so a published template cannot accidentally ship an auth mail whose button
 * goes nowhere, and cannot be edited into pointing somewhere else.
 */

/* ── the payload ───────────────────────────────────────────────────────────*/

/** The action types GoTrue actually sends through this hook. */
export const AUTH_ACTIONS = [
  "signup", "recovery", "magiclink", "invite", "email_change", "reauthentication",
] as const;
export type AuthAction = (typeof AUTH_ACTIONS)[number];

export type SendEmailPayload = {
  user: {
    id: string;
    email: string;
    /** Present only for an email change. */
    new_email?: string;
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new: string;
    token_hash_new: string;
  };
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Runtime validation, because this arrives over the wire from a service we do
 * not control the version of. A signature proves who sent it, not that it is
 * shaped the way last year's documentation said.
 */
export function parsePayload(value: unknown): SendEmailPayload | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const user = root.user as Record<string, unknown> | undefined;
  const data = (root.email_data ?? root.email) as Record<string, unknown> | undefined;
  if (!user || !data || typeof user !== "object" || typeof data !== "object") return null;

  const email = str(user.email).trim();
  const action = str(data.email_action_type).trim();
  if (!email || !action) return null;
  // A delivery with neither hash is not something we can turn into a link.
  if (!str(data.token_hash) && !str(data.token_hash_new)) return null;

  return {
    user: {
      id: str(user.id),
      email,
      new_email: str(user.new_email).trim() || undefined,
      user_metadata: (user.user_metadata && typeof user.user_metadata === "object"
        ? user.user_metadata as Record<string, unknown>
        : {}),
    },
    email_data: {
      token: str(data.token),
      token_hash: str(data.token_hash),
      redirect_to: str(data.redirect_to),
      email_action_type: action,
      site_url: str(data.site_url),
      token_new: str(data.token_new),
      token_hash_new: str(data.token_hash_new),
    },
  };
}

export function isAuthAction(value: string): value is AuthAction {
  return (AUTH_ACTIONS as readonly string[]).includes(value);
}

/* ── one payload → the messages it means ───────────────────────────────────*/

export type OutboundAuthMail = {
  to: string;
  action: AuthAction;
  /** The template row this renders from — the key the admin edits. */
  templateKey: string;
  /** Hash for THIS recipient's link. */
  tokenHash: string;
  /** The six-digit code, for templates that show one instead of a link. */
  token: string;
  /** `type` for /auth/confirm, i.e. what verifyOtp will be asked to verify. */
  confirmType: string;
};

/** `/auth/confirm` is GrovBase's own landing page — the customer never sees a
 *  Supabase URL, and the route decides where they go afterwards, so no
 *  redirect target rides in from outside. */
export function confirmUrl(tokenHash: string, confirmType: string): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type: confirmType });
  return absoluteUrl(`/auth/confirm?${params.toString()}`);
}

const TEMPLATE_KEY: Record<AuthAction, string> = {
  signup: "auth.confirm_signup",
  recovery: "auth.reset_password",
  magiclink: "auth.magic_link",
  invite: "auth.invite",
  email_change: "auth.email_change",
  reauthentication: "auth.reauthentication",
};

/**
 * What actually has to go out.
 *
 * Every action is one message except `email_change`, which with Supabase's
 * "Secure email change" turned on is TWO — one asking the current address to
 * approve the move, one asking the new address to confirm it.
 *
 * The token/hash pairing for that case is genuinely counter-intuitive and is
 * documented as such by Supabase: the field named `token_hash_new` belongs to
 * the CURRENT address, and plain `token_hash` belongs to the NEW one. Getting
 * it backwards produces two mails that each fail to verify, so it is spelled
 * out rather than inferred:
 *
 *   current address (user.email)      → token      + token_hash_new
 *   new address     (user.new_email)  → token_new  + token_hash
 *
 * With secure change OFF only one pair exists and a single mail goes to the
 * new address.
 */
export function planMails(payload: SendEmailPayload): OutboundAuthMail[] {
  const action = payload.email_data.email_action_type;
  if (!isAuthAction(action)) return [];
  const key = TEMPLATE_KEY[action];
  const d = payload.email_data;

  if (action === "email_change") {
    const mails: OutboundAuthMail[] = [];
    const newAddress = payload.user.new_email ?? "";
    // Secure email change: both pairs present → two messages.
    if (d.token_hash && d.token_hash_new && newAddress) {
      mails.push({
        to: payload.user.email, action, templateKey: key,
        tokenHash: d.token_hash_new, token: d.token, confirmType: "email_change",
      });
      mails.push({
        to: newAddress, action, templateKey: key,
        tokenHash: d.token_hash, token: d.token_new || d.token, confirmType: "email_change",
      });
      return mails;
    }
    // Secure email change off: one message, to the new address if we were
    // told it and to the account address otherwise.
    return [{
      to: newAddress || payload.user.email, action, templateKey: key,
      tokenHash: d.token_hash || d.token_hash_new,
      token: d.token || d.token_new,
      confirmType: "email_change",
    }];
  }

  return [{
    to: payload.user.email,
    action,
    templateKey: key,
    tokenHash: d.token_hash || d.token_hash_new,
    token: d.token || d.token_new,
    // Signup confirmations verify as type "email" — the same value the
    // GrovBase template has always linked with, and the one /auth/confirm
    // already accepts.
    confirmType: action === "signup" ? "email"
      : action === "magiclink" ? "magiclink"
        : action === "invite" ? "invite"
          : action === "reauthentication" ? "email"
            : "recovery",
  }];
}

/* ── rendering ─────────────────────────────────────────────────────────────*/

/**
 * The built-in GrovBase templates carry GoTrue's Go-template markers, because
 * the very same file is what an operator would paste into a dashboard. Here
 * the markers are filled in from the payload instead. Only the three forms
 * those files actually use are supported — this is a substitution, not a
 * template language, and nothing user-supplied is ever evaluated.
 */
export function renderGoTemplate(
  html: string,
  values: { tokenHash: string; firstName: string; token: string },
): string {
  const firstName = values.firstName.trim();
  return html
    // {{ if .Data.first_name }}A{{ else }}B{{ end }}
    .replace(
      /\{\{\s*if\s+\.Data\.first_name\s*\}\}([\s\S]*?)\{\{\s*else\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g,
      (_m, withName: string, without: string) => (firstName ? withName : without),
    )
    // {{ if .Data.first_name }}A{{ end }}
    .replace(
      /\{\{\s*if\s+\.Data\.first_name\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g,
      (_m, withName: string) => (firstName ? withName : ""),
    )
    .replace(/\{\{\s*\.Data\.first_name\s*\}\}/g, escapeHtml(firstName))
    .replace(/\{\{\s*\.TokenHash\s*\}\}/g, encodeURIComponent(values.tokenHash))
    .replace(/\{\{\s*\.Token\s*\}\}/g, escapeHtml(values.token));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain-text alternative, derived from the HTML so the two cannot drift. */
function textFromHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|div|h1|h2|h3|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&zwnj;/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** The words shipped in code, per action — used when no published template
 *  exists. Signup and recovery have full HTML art; the rest render through
 *  the shared GrovBase card, which is still unmistakably GrovBase. */
const BUILTIN_COPY: Record<AuthAction, { subject: string; heading: string; body: string; cta: string }> = {
  signup: {
    subject: "Potwierdź swój adres e-mail — GrovBase",
    heading: "Potwierdź swój adres e-mail",
    body: "Kliknij przycisk poniżej, aby aktywować konto GrovBase.",
    cta: "Potwierdź adres e-mail",
  },
  recovery: {
    subject: "Reset hasła — GrovBase",
    heading: "Ustaw nowe hasło",
    body: "Otrzymaliśmy prośbę o zmianę hasła do Twojego konta GrovBase. Link jest ważny przez godzinę.",
    cta: "Ustaw nowe hasło",
  },
  magiclink: {
    subject: "Twój link logowania — GrovBase",
    heading: "Zaloguj się do GrovBase",
    body: "Kliknij przycisk poniżej, aby zalogować się bez hasła. Link jest jednorazowy.",
    cta: "Zaloguj się",
  },
  invite: {
    subject: "Zaproszenie do GrovBase",
    heading: "Zaproszenie do GrovBase",
    body: "Zostałeś zaproszony do GrovBase. Kliknij przycisk poniżej, aby założyć konto.",
    cta: "Przyjmij zaproszenie",
  },
  email_change: {
    subject: "Potwierdź zmianę adresu e-mail — GrovBase",
    heading: "Potwierdź zmianę adresu e-mail",
    body: "Otrzymaliśmy prośbę o zmianę adresu e-mail przypisanego do Twojego konta GrovBase. Potwierdź ją, klikając przycisk poniżej.",
    cta: "Potwierdź zmianę",
  },
  reauthentication: {
    subject: "Kod potwierdzenia — GrovBase",
    heading: "Potwierdź, że to Ty",
    body: "Aby dokończyć tę operację, podaj poniższy kod w GrovBase.",
    cta: "",
  },
};

export type RenderedAuthMail = {
  subject: string;
  html: string;
  text: string;
  source: "published" | "builtin";
  templateVersion: number | null;
};

/**
 * Render one message. A published admin template wins; the built-in GrovBase
 * copy is the fallback. The CTA URL is always the server-computed link.
 */
export async function renderAuthMail(
  supabase: Client,
  mail: OutboundAuthMail,
  firstName: string,
): Promise<RenderedAuthMail> {
  const url = confirmUrl(mail.tokenHash, mail.confirmType);
  const builtin = BUILTIN_COPY[mail.action];

  const token = dispatchToken();
  if (token) {
    const def = await lookupPublishedTemplate(supabase, token, mail.templateKey, "email");
    if (def && def.channel === "email") {
      const data = {
        first_name: firstName,
        email: mail.to,
        code: mail.token,
        // Available to the copy, though the button below never depends on it.
        confirm_url: url,
      };
      const rendered = renderTemplateEmail(
        // The link is ours, not the template's: a published auth mail must
        // never be one typo away from a dead button.
        { ...def.email, showCta: builtin.cta !== "", ctaUrl: url,
          ctaLabel: def.email.ctaLabel.trim() || builtin.cta },
        data,
        {
          badge: "GROVBASE",
          fields: mail.action === "reauthentication" && mail.token
            ? [{ label: "Kod", value: mail.token, mono: true }]
            : [],
        },
      );
      return {
        subject: rendered.subject, html: rendered.html, text: rendered.text,
        source: "published", templateVersion: null,
      };
    }
  }

  // Built-in. Signup and recovery have hand-built HTML in the repository —
  // the same file an operator could paste anywhere — so those render through
  // the Go markers. Everything else uses the shared GrovBase card.
  const rich = AUTH_EMAIL_TEMPLATES[mail.templateKey];
  if (rich) {
    const html = renderGoTemplate(rich.html, {
      tokenHash: mail.tokenHash, firstName, token: mail.token,
    });
    return {
      subject: rich.subject, html, text: textFromHtml(html),
      source: "builtin", templateVersion: null,
    };
  }

  const { renderEmailTemplate } = await import("@/lib/server/email-template");
  const { html, text } = renderEmailTemplate({
    badge: "GROVBASE",
    title: builtin.heading,
    intro: firstName ? `Cześć ${firstName}! ${builtin.body}` : builtin.body,
    fields: mail.action === "reauthentication" && mail.token
      ? [{ label: "Kod", value: mail.token, mono: true }]
      : [],
    cta: builtin.cta ? { label: builtin.cta, url } : undefined,
    footer: "Jeżeli to nie Ty prosiłeś o tę wiadomość, po prostu ją zignoruj.",
    showLogo: true,
  });
  return { subject: builtin.subject, html, text, source: "builtin", templateVersion: null };
}

/* ── sending ───────────────────────────────────────────────────────────────*/

/**
 * The SAME mailbox everything else goes out on — no second transport. The
 * password is stored sealed and is opened for the length of one send; the
 * bridge between the integrations key and the mailer's ciphertext shape is
 * the one the security-code mail already uses.
 */
export async function sendAuthMail(
  supabase: Client,
  to: string,
  rendered: { subject: string; html: string; text: string },
): Promise<{ sent: boolean; transport: string; error?: string }> {
  const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
  const password = secrets.smtp_password ?? (config.smtp_same_as_imap ? secrets.imap_password : undefined);
  if (!config.smtp_host.trim() || !config.smtp_user.trim() || !password) {
    return { sent: false, transport: "none", error: "not_configured" };
  }
  const smtp: SmtpConfig = {
    host: config.smtp_host,
    port: config.smtp_port,
    user: config.smtp_user,
    encryption: config.smtp_encryption === "starttls" ? "tls"
      : config.smtp_encryption === "ssl" ? "ssl" : "auto",
    password,
  };
  const identity: MailIdentity = {
    from_name: config.from_name || "GrovBase",
    from_email: config.email,
    reply_to: config.email,
  };
  const result = await deliverHtml(
    { to, subject: rendered.subject, text: rendered.text, html: rendered.html },
    identity, smtp,
  );
  return {
    sent: result.sent,
    transport: "smtp",
    error: result.error ? safeError(result.error) : undefined,
  };
}
