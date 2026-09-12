/**
 * MAIL PORTS — what the numbers actually mean, in one place.
 *
 * WHY THIS EXISTS. The production mailbox was configured with IMAP on port 587
 * and SSL/TLS ticked. That combination cannot work and never could: 587 is the
 * mail SUBMISSION port — it speaks SMTP, and it speaks it in the clear until
 * STARTTLS upgrades the socket. An IMAP client opening a TLS handshake against
 * it is talking to a server that is waiting for a plaintext SMTP greeting, so
 * the connection hangs and then times out. What the admin saw was "Błąd
 * połączenia IMAP. Sprawdź host, port lub dane logowania." — which is true, and
 * useless, because it does not say WHICH of the three is wrong.
 *
 * The form now says so before anything is saved. These are the four
 * combinations that work, and nothing else is guessed at:
 *
 *   IMAP  993  implicit TLS   ← the normal one, and the Hostido default
 *   IMAP  143  STARTTLS
 *   SMTP  465  implicit TLS
 *   SMTP  587  STARTTLS       ← the normal one, and the Hostido default
 *
 * Pure functions with no imports, deliberately: the same rules run in the
 * browser as the admin types and in the server action before a save is
 * accepted, and a rule that exists twice is a rule that will disagree with
 * itself.
 */

export type SmtpEncryption = "starttls" | "ssl" | "none";

/** What a hint is FOR. An error blocks the save; a warning does not. */
export type Advice = { level: "error" | "warn"; key: string } | null;

/** Ports that speak SMTP submission — never IMAP, whatever is typed beside them. */
const SUBMISSION_PORTS = [25, 465, 587, 2525];
/** Ports that speak IMAP — never SMTP. */
const IMAP_PORTS = [143, 993];

export const IMAP_PRESET = { port: 993, secure: true } as const;
export const SMTP_PRESET = { port: 587, encryption: "starttls" as SmtpEncryption } as const;

export function validPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/**
 * The IMAP half. Returns the single most important thing wrong with this
 * port/TLS pair, or null when it is one of the two that work.
 */
export function imapAdvice(port: number, secure: boolean): Advice {
  if (!validPort(port)) return { level: "error", key: "comm.err.invalidPort" };
  // The bug from production, named exactly: this is an SMTP port and no amount
  // of fiddling with the TLS box will make an IMAP session start on it.
  if (SUBMISSION_PORTS.includes(port)) return { level: "error", key: "comm.hint.imapSmtpPort" };
  if (port === 993 && !secure) return { level: "error", key: "comm.hint.imap993NeedsTls" };
  if (port === 143 && secure) return { level: "error", key: "comm.hint.imap143NoTls" };
  // An unusual port is not an error — a self-hosted server may genuinely use
  // one — but it is worth a sentence, because the usual cause is a typo.
  if (!IMAP_PORTS.includes(port)) return { level: "warn", key: "comm.hint.imapUnusual" };
  return null;
}

/** The SMTP half, same contract. */
export function smtpAdvice(port: number, encryption: SmtpEncryption): Advice {
  if (!validPort(port)) return { level: "error", key: "comm.err.invalidPort" };
  if (IMAP_PORTS.includes(port)) return { level: "error", key: "comm.hint.smtpImapPort" };
  if (port === 465 && encryption !== "ssl") return { level: "error", key: "comm.hint.smtp465NeedsSsl" };
  if (port === 587 && encryption !== "starttls") return { level: "error", key: "comm.hint.smtp587NeedsStarttls" };
  // Not blocked — a relay on a trusted network legitimately runs without TLS —
  // but the password crosses the wire in the clear and that has to be said out
  // loud rather than discovered later.
  if (encryption === "none") return { level: "warn", key: "comm.hint.smtpPlaintext" };
  if (!SUBMISSION_PORTS.includes(port)) return { level: "warn", key: "comm.hint.smtpUnusual" };
  return null;
}
