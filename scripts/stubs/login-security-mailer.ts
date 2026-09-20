/**
 * A MAILER THAT RECORDS INSTEAD OF SENDING.
 *
 * Aliased in place of lib/server/mailer for scripts/login-security-key-tests.ts
 * so the step-up chain runs for real all the way to the transport boundary and
 * stops exactly there. Everything before it — the server secret, the derived
 * token, the hash comparison the database performs, the challenge row, the
 * generated code, the rendered mail — is the production code path.
 *
 * It records what the transport was actually handed, because "sendSecurityCode
 * was called" is not the assertion that matters. The assertion that matters is
 * that a real six-digit code reached a transport with a complete SMTP identity.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  encryption: "tls" | "ssl" | "auto";
  password: string;
};

export type MailIdentity = {
  from_name: string;
  from_email: string;
  reply_to: string;
};

export type Delivery = {
  to: string;
  subject: string;
  text: string;
  html: string;
  identity: MailIdentity;
  smtp: SmtpConfig;
};

/** Every delivery the code under test attempted, oldest first. */
export const deliveries: Delivery[] = [];

/** When set, the transport fails the way a dead SMTP server does. */
let failWith: string | null = null;

export function __reset(): void {
  deliveries.length = 0;
  failWith = null;
}

export function __failNextWith(message: string | null): void {
  failWith = message;
}

export async function deliverHtml(
  mail: { to: string; subject: string; text: string; html: string },
  identity: MailIdentity,
  smtp: SmtpConfig,
): Promise<{ sent: boolean; error?: string }> {
  if (failWith) return { sent: false, error: failWith };
  deliveries.push({ ...mail, identity, smtp });
  return { sent: true };
}
