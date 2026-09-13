/**
 * THE FAILURE VOCABULARY OF THE COMMUNICATIONS MODULE.
 *
 * Every code `app/actions/integrations.ts` can answer with, mapped to the one
 * translated sentence that tells the admin what to do next. All three screens
 * of the module read the same vocabulary, which is why it is one table.
 *
 * It lives in `lib/` rather than beside the card that renders it for one
 * reason: it is pure data and a pure function, and it needs to be testable.
 * Inside the client component it could only be checked by reading the file as
 * text, because importing it drags in `next/navigation`, the server actions and
 * the whole React runtime — so the rule below went unguarded and broke.
 */

/** Which channel failed, so an unrecognised code still names the right thing. */
export type ErrorChannel = "imap" | "smtp" | "telegram" | "captcha" | "generic";

const ERROR_KEYS: Record<string, string> = {
  forbidden: "comm.err.forbidden",
  not_configured: "comm.err.notConfigured",
  // NOT comm.secretUnreadable: that one is the page banner and names the
  // channels it concerns, so it needs a variable this table cannot supply. A
  // toast is already attached to the channel the admin just acted on.
  encryption_unavailable: "comm.err.secretStale",
  secret_write_failed: "comm.err.secretWrite",
  not_persisted: "comm.err.notPersisted",
  decrypt_failed: "comm.err.decrypt",
  invalid_email: "comm.invalidEmail",
  // The mail form saves every field at once, so a rejected save has to name the
  // one that was wrong — the generic sentence would leave the admin guessing.
  invalid_host: "comm.err.invalidHost",
  invalid_port: "comm.err.invalidPort",
  invalid_encryption: "comm.err.invalidEncryption",
  imap_port_mismatch: "comm.hint.imapSmtpPort",
  smtp_port_mismatch: "comm.hint.smtpImapPort",
  auth: "comm.err.auth",
  chat_not_found: "comm.err.chatNotFound",
  // A malformed id and an id Telegram does not know lead to the same fix, and
  // that sentence points straight at the field the admin has to correct.
  invalid_chat_id: "comm.err.chatNotFound",
  invalid_token: "comm.err.telegram",
  // A rejected captcha secret and an unreachable Cloudflare are different
  // fixes: retype the key vs. simply try again.
  captcha_secret: "comm.err.captchaSecret",
  timeout: "comm.err.timeout",
};

const CHANNEL_FALLBACK: Record<ErrorChannel, string> = {
  imap: "comm.err.imap",
  smtp: "comm.err.smtp",
  telegram: "comm.err.telegram",
  captcha: "comm.err.generic",
  generic: "comm.err.generic",
};

/**
 * CODES THREE CHANNELS SHARE, SENTENCES THEY DO NOT.
 *
 * `not_configured` is returned by the mail test, the Telegram test and the
 * Turnstile test alike — but `comm.err.notConfigured` says "Poczta nie została
 * jeszcze skonfigurowana", because the mailbox screens own that sentence. So
 * pressing "Testuj połączenie" on the TELEGRAM card answered that the MAILBOX
 * was not configured: a channel-agnostic code resolved to a channel-specific
 * sentence, and the channel argument was sitting right there, unused.
 *
 * The rule is now: a code whose correct wording depends on who raised it is
 * looked up per channel FIRST. Anything genuinely shared — forbidden, timeout,
 * the vault write — stays in ERROR_KEYS and reads correctly everywhere, which
 * is why those sentences say "sekret" and not "hasło".
 */
const PER_CHANNEL: Partial<Record<ErrorChannel, Record<string, string>>> = {
  telegram: {
    not_configured: "comm.err.tgNotConfigured",
    // The mail sentences for these talk about the mailbox password; Telegram
    // has a bot token and no mailbox.
    auth: "comm.err.telegram",
    decrypt_failed: "comm.err.secretStale",
    encryption_unavailable: "comm.err.secretStale",
  },
  captcha: {
    not_configured: "comm.err.captchaNotConfigured",
    auth: "comm.err.captchaSecret",
    decrypt_failed: "comm.err.secretStale",
    encryption_unavailable: "comm.err.secretStale",
  },
};

/**
 * WHICH SENTENCES BELONG TO WHICH CHANNEL.
 *
 * The per-channel table above fixes the combinations we know about. This fixes
 * the ones we do not: a sentence that names a channel may only ever be shown
 * ON that channel, whatever code produced it and whatever table it came from.
 *
 * Without this the rule is only as good as somebody remembering to add a row —
 * and the original bug was precisely a missing row. Here the invariant is
 * enforced on the way out, so a code that starts being returned by a channel it
 * never used to come from degrades to that channel's own sentence instead of
 * announcing the wrong product area.
 *
 * A key absent from this map is channel-neutral (forbidden, timeout, the vault
 * write) and may be shown anywhere.
 */
const SENTENCE_OWNER: Record<string, readonly ErrorChannel[]> = {
  "comm.err.notConfigured": ["imap", "smtp"],
  "comm.err.imap": ["imap"],
  "comm.err.smtp": ["smtp"],
  "comm.err.auth": ["imap", "smtp"],
  "comm.err.invalidHost": ["imap", "smtp"],
  "comm.err.invalidPort": ["imap", "smtp"],
  "comm.err.invalidEncryption": ["imap", "smtp"],
  "comm.hint.imapSmtpPort": ["imap", "smtp"],
  "comm.hint.smtpImapPort": ["imap", "smtp"],
  "comm.err.telegram": ["telegram"],
  "comm.err.tgNotConfigured": ["telegram"],
  "comm.err.chatNotFound": ["telegram"],
  "comm.err.captchaNotConfigured": ["captcha"],
  "comm.err.captchaSecret": ["captcha"],
};

/** May this sentence be shown on this channel? */
function belongsTo(key: string, channel: ErrorChannel): boolean {
  const owners = SENTENCE_OWNER[key];
  return !owners || owners.includes(channel);
}

/**
 * A code is never shown raw — "auth" on a screen is the same failure as a
 * stack trace on a screen. Anything these tables do not know falls back to the
 * channel's sentence, so a code added to the actions later still reads as
 * Polish rather than as debug output.
 */
export function integrationErrorKey(code: string | undefined, channel: ErrorChannel): string {
  const fallback = CHANNEL_FALLBACK[channel];
  if (!code) return fallback;
  const perChannel = PER_CHANNEL[channel]?.[code];
  if (perChannel) return belongsTo(perChannel, channel) ? perChannel : fallback;
  const mapped = ERROR_KEYS[code];
  if (mapped) return belongsTo(mapped, channel) ? mapped : fallback;
  // A network failure against Telegram is always the 10 s abort in
  // lib/server/telegram.ts; a mail server can stall for a dozen reasons, and
  // the channel sentence names all of them at once.
  if (code === "network" && channel === "telegram") return "comm.err.timeout";
  return fallback;
}

/** The ownership map, for the suite that checks the invariant really holds. */
export const SENTENCE_OWNERS: Readonly<Record<string, readonly ErrorChannel[]>> = SENTENCE_OWNER;

/** Every code either table knows, for the suite that checks they all resolve. */
export const KNOWN_ERROR_CODES: readonly string[] = [
  ...new Set([
    ...Object.keys(ERROR_KEYS),
    ...Object.values(PER_CHANNEL).flatMap((m) => Object.keys(m ?? {})),
  ]),
];

/** The channels a customer-facing failure can be attributed to. */
export const ERROR_CHANNELS: readonly ErrorChannel[] = [
  "imap", "smtp", "telegram", "captcha", "generic",
];
