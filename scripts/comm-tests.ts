/**
 * COMMUNICATIONS — deterministic tests for the parts that must never be wrong
 * and need no mail server: the error scrubber (a leaked bot token or password
 * would end up in a database column and on an admin's screen), the secret
 * merge semantics (keep / replace / delete — "keep" is what protects a working
 * password from an untouched form field), the derived dispatch token, the
 * reader for a claimed outbox row — that one takes `unknown`, so a mismatch
 * between it and the RPC's column names typechecks perfectly and silently
 * stops every notification — and the two message formatters, where the failure
 * mode is a card that renders a dangling label or, worse, a stranger's name as
 * markup.
 * Run: npm run test:comm
 */
process.env.APP_ENCRYPTION_KEY = "b".repeat(64); // throwaway key for the round trip

import { renderAdminNotification } from "../lib/server/admin-email";
import { decryptWith } from "../lib/server/crypto";
import { dispatchToken, mergeSecrets, safeError } from "../lib/server/integrations";
import { dispatchOne, formatTelegram, readClaim } from "../lib/server/notify";
import { absoluteUrl } from "../lib/site";

const KEY = "b".repeat(64);

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("A. SAFE ERRORS — nothing secret survives the trip to the UI");
const BOT_TOKEN = "7891234567:AAHkq2f9wR3xTvB7nQpLmZ0sYdEcVuIhGjK";
const withToken = safeError(new Error(`request to https://api.telegram.org/bot${BOT_TOKEN}/sendMessage failed`));
check("a bot token is redacted", !withToken.includes(BOT_TOKEN) && withToken.includes("[redacted]"), withToken);
check("the surrounding message survives", withToken.includes("api.telegram.org"), withToken);
const withPass = safeError("535 auth failed for user=contact@grovbase.com password=Sup3rSecret!");
check("a password= pair is redacted", !withPass.includes("Sup3rSecret!"), withPass);
check('a quoted "token": "…" pair is redacted',
  !safeError('{"token": "abc123def456"}').includes("abc123def456"), safeError('{"token": "abc123def456"}'));
const withUrl = safeError(new Error("connect imaps://contact:hunter2@host483417.hostido.net.pl:993 refused"));
check("basic-auth credentials in a URL are redacted", !withUrl.includes("hunter2"), withUrl);
check("Bearer values are redacted", !safeError("401 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9").includes("eyJhbGciOiJIUzI1NiJ9"));
check("whitespace is collapsed and the result is capped at 200 chars",
  safeError(new Error(`x\n  y ${"z".repeat(400)}`)).length === 200);
check("a PostgREST-shaped object still yields its message",
  safeError({ message: "permission denied for table integration_settings" }).startsWith("permission denied"));
check("a non-Error, non-object input never throws", safeError(undefined).length >= 0);

console.log("\nB. SECRET MERGE — absent keeps, string replaces, null deletes");
const stored = mergeSecrets({}, { imap_password: "first-pass", smtp_password: "smtp-pass" });
check("a string encrypts into a blob", Boolean(stored.imap_password?.c && stored.imap_password?.i && stored.imap_password?.t));
check("the blob round-trips back to the plaintext",
  decryptWith(KEY, stored.imap_password.c, stored.imap_password.i, stored.imap_password.t) === "first-pass");
check("ciphertext is not the plaintext", !JSON.stringify(stored).includes("first-pass"));

const untouched = mergeSecrets(stored, { smtp_password: "" });
check("an absent key keeps the stored secret",
  JSON.stringify(untouched.imap_password) === JSON.stringify(stored.imap_password));
check("an EMPTY string keeps the stored secret (untouched form field)",
  JSON.stringify(untouched.smtp_password) === JSON.stringify(stored.smtp_password));

const replaced = mergeSecrets(stored, { imap_password: "second-pass" });
check("a new string replaces the stored secret",
  decryptWith(KEY, replaced.imap_password.c, replaced.imap_password.i, replaced.imap_password.t) === "second-pass");
check("replacing one secret leaves the other alone",
  JSON.stringify(replaced.smtp_password) === JSON.stringify(stored.smtp_password));

const deleted = mergeSecrets(stored, { imap_password: null });
check("null deletes the entry", !("imap_password" in deleted) && "smtp_password" in deleted);
check("the merge never mutates its input", "imap_password" in stored);

const fresh = mergeSecrets(stored, { imap_password: "first-pass" });
check("the same plaintext encrypts differently every time (random IV)",
  fresh.imap_password.c !== stored.imap_password.c && fresh.imap_password.i !== stored.imap_password.i);

console.log("\nC. DISPATCH TOKEN — derived, deterministic, never the key itself");
const token = dispatchToken();
check("it is a sha256 hex digest", typeof token === "string" && /^[0-9a-f]{64}$/.test(token));
check("it is deterministic across calls", token === dispatchToken());
check("it is not the encryption key", token !== KEY);

process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY = "c".repeat(64);
check("a dedicated integrations key wins over the app key", dispatchToken() !== token);
delete process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY;
check("removing it restores the app-key token", dispatchToken() === token);

delete process.env.APP_ENCRYPTION_KEY;
check("no key configured means no token at all", dispatchToken() === null);
let refused = false;
try { mergeSecrets({}, { bot_token: "123" }); }
catch (e) { refused = (e as Error).message === "encryption_unavailable"; }
check("and a secret is refused rather than stored in the clear", refused);
process.env.APP_ENCRYPTION_KEY = KEY;

/* The claim is the one place where a wrong field name costs every message and
   nothing complains: readClaim's parameter is `unknown`, the RPC answers with
   an empty chat id instead of an error, and the dispatcher closes the row as
   "skipped" — which the claim CTE never looks at again. So the fixture below
   is copied field for field from the RETURNS TABLE of
   notification_dispatch_claim in 0055_admin_email_channel.sql. Keep them in
   step. */

/* The mail integration's config, as the claim's LEFT JOIN returns it — on
   EVERY claimed row, whatever its channel, which is why the telegram fixture
   carries it too. */
const MAIL_CONFIG = {
  smtp_host: "host483417.hostido.net.pl",
  smtp_port: 587,
  smtp_user: "contact@grovbase.com",
  smtp_encryption: "starttls",
  from_name: "GrovBase",
  email: "contact@grovbase.com",
  admin_notify_to: "contact@grovbase.com",
};

const CLAIMED_ROW = {
  id: "6f6d1b6a-1c2d-4f3e-8a90-0b1c2d3e4f50",
  event_type: "mail.received",
  payload: {
    title: "Nowy e-mail",
    icon: "✉️",
    rows: [["Od", "Jan Kowalski"], ["Temat", "Pytanie o zamówienie"]],
    quote: "Dzień dobry, chciałbym zapytać…",
    footer: "Otrzymano: 12:43",
  },
  dedupe_key: "mail.received:INBOX:4242",
  attempts: 1,
  created_at: "2026-01-15T11:43:00.000Z",
  channel: "telegram",
  telegram_enabled: true,
  telegram_config: { chat_id: "-1001234567890", channel_name: "GrovBase" },
  bot_token_ciphertext: { c: "ciphertext", i: "iv", t: "tag" },
  mail_config: MAIL_CONFIG,
  smtp_password_ciphertext: { c: "smtp-ciphertext", i: "smtp-iv", t: "smtp-tag" },
  admin_email_to: "contact@grovbase.com",
};

/* The same event enqueued for the second destination: one row, one channel,
   both carrying the same dedupe key (0055's index is on the pair). */
const ADMIN_ROW = {
  ...CLAIMED_ROW,
  id: "8b1e4c22-9a3f-4d61-b7c8-2e5f6a7b8c90",
  event_type: "user.registered",
  channel: "admin_email",
  payload: {
    title: "NOWA REJESTRACJA",
    icon: "🎉",
    rows: [["👤 Użytkownik", "Jan Kowalski"], ["📧 E-mail", "jan@example.com"]],
    footer: "Data: 15.01.2026, 12:43",
  },
  dedupe_key: "user.registered:jan@example.com",
};

async function main() {
  console.log("\nD. CLAIMED ROW — read the columns the dispatch RPC really returns");
  const row = readClaim(CLAIMED_ROW);
  check("a claimed row is readable at all", row !== null);
  check("the chat id comes out of telegram_config", row?.chatId === "-1001234567890", row?.chatId);
  check("the bot token comes out of bot_token_ciphertext",
    row?.blob?.c === "ciphertext" && row?.blob?.i === "iv" && row?.blob?.t === "tag", JSON.stringify(row?.blob));
  check("the payload becomes the message", row?.message.title === "Nowy e-mail" && row?.message.rows?.length === 2);
  check("telegram_enabled true keeps the row deliverable", row?.enabled === true);

  const disabled = readClaim({ ...CLAIMED_ROW, telegram_enabled: false });
  check("telegram_enabled false is carried through", disabled?.enabled === false);
  // No network here: the guard returns before the token is decrypted or used.
  const skipped = disabled ? await dispatchOne(disabled, KEY) : null;
  check("a disabled integration is skipped, not sent",
    skipped?.status === "skipped" && skipped.error === "telegram_not_configured", JSON.stringify(skipped));

  // A row with no Telegram row behind it at all — the LEFT JOIN's empty config.
  const bare = readClaim({ ...CLAIMED_ROW, telegram_enabled: false, telegram_config: {}, bot_token_ciphertext: null });
  check("an unconfigured row yields no credentials", bare?.chatId === "" && bare?.blob === null);
  check("a row without the channel column is still a telegram row", readClaim({ ...CLAIMED_ROW, channel: undefined })?.channel === "telegram");

  console.log("\nE. TELEGRAM CARD — compact one-line fields, and nothing raw");
  const card = formatTelegram({
    title: "NOWA REJESTRACJA",
    icon: "🎉",
    rows: [["👤 Użytkownik", "Jan Kowalski"], ["📧 E-mail", "jan@example.com"], ["📱 Telefon", ""]],
    footer: "GrovBase Admin",
  });
  // The card is drawn by the shared design system (telegram-notification.ts):
  // an icon-led headline, a voice line, one line per field with the icon in
  // the label column, and blocks separated by a single blank line. The old
  // box-drawing rule is gone on purpose — it wrapped into rubble on a phone.
  check("the header is the icon and the bold title, with no drawn rule",
    card.startsWith("🎉 <b>NOWA REJESTRACJA</b>") && !/[━│┌└]/.test(card), card.split("\n")[0]);
  check("a row is ONE line — icon, gutter, value",
    card.includes("👤  <b>Jan Kowalski</b>") && card.includes("📧  jan@example.com"), card);
  check("blocks are separated by exactly one blank line, never more",
    card.includes("\n\n") && !card.includes("\n\n\n"), JSON.stringify(card));
  // The bug this catches: an empty phone rendering as a label with "undefined"
  // — or nothing — under it, which is what the admin actually sees on Telegram.
  check("an empty value drops the whole row, emoji and all", !card.includes("Telefon") && !card.includes("📱"), card);
  check("the footer closes the card in italics", /<i>GrovBase Admin<\/i>$/.test(card), card.slice(-40));
  check("a card with no footer simply ends", !formatTelegram({ title: "X" }).endsWith("\n"));

  const hostile = formatTelegram({
    title: "Zapytanie <ważne> & pilne",
    rows: [["Imię", "<b>Zły</b> <script>alert(1)</script>"]],
  });
  check("HTML in a value is escaped, not sent as markup",
    hostile.includes("&lt;script&gt;") && !hostile.includes("<script>"), hostile);
  check("HTML in the title is escaped too", hostile.includes("&lt;ważne&gt; &amp; pilne"), hostile);

  console.log("\nF. ADMIN E-MAIL — the second channel, its claim and its card");
  const mailRow = readClaim(ADMIN_ROW);
  check("the channel is read off the row", mailRow?.channel === "admin_email");
  check("the recipient comes out of admin_email_to", mailRow?.adminEmailTo === "contact@grovbase.com", mailRow?.adminEmailTo);
  check("the password comes out of smtp_password_ciphertext — NOT the bot token",
    mailRow?.smtpBlob?.c === "smtp-ciphertext" && mailRow?.smtpBlob?.t === "smtp-tag", JSON.stringify(mailRow?.smtpBlob));
  check("the server comes out of mail_config",
    mailRow?.mail.host === "host483417.hostido.net.pl" && mailRow?.mail.user === "contact@grovbase.com" && mailRow?.mail.port === 587);
  check("starttls is translated into nodemailer's tls", mailRow?.mail.encryption === "tls", mailRow?.mail.encryption);

  // Nothing below reaches the network: every one of these returns at a guard,
  // before a transport is built.
  const noRecipient = readClaim({ ...ADMIN_ROW, admin_email_to: null, mail_config: { ...MAIL_CONFIG, admin_notify_to: "" } });
  const noRecipientOut = noRecipient ? await dispatchOne(noRecipient, KEY) : null;
  check("no recipient is SKIPPED, not failed — a retry cannot invent an address",
    noRecipientOut?.status === "skipped" && noRecipientOut.error === "admin_email_not_configured", JSON.stringify(noRecipientOut));

  const noServer = readClaim({ ...ADMIN_ROW, mail_config: { admin_notify_to: "contact@grovbase.com" } });
  const noServerOut = noServer ? await dispatchOne(noServer, KEY) : null;
  check("a recipient with no SMTP host is skipped",
    noServerOut?.status === "skipped" && noServerOut.error === "smtp_not_configured", JSON.stringify(noServerOut));

  // The fixture's envelope is not real ciphertext, so the mail branch gets as
  // far as opening it and no further — which is exactly what proves the branch
  // ran: a telegram-only dispatcher would have stopped at the chat id.
  const undecryptable = mailRow ? await dispatchOne(mailRow, KEY) : null;
  check("an envelope this key cannot open is skipped",
    undecryptable?.status === "skipped" && undecryptable.error === "decrypt_failed", JSON.stringify(undecryptable));

  const telegramOff = readClaim({ ...ADMIN_ROW, telegram_enabled: false, telegram_config: {}, bot_token_ciphertext: null });
  const telegramOffOut = telegramOff ? await dispatchOne(telegramOff, KEY) : null;
  check("the telegram switch does not silence the e-mail channel",
    telegramOffOut?.error === "decrypt_failed", JSON.stringify(telegramOffOut));

  const mail = renderAdminNotification({
    eventType: "user.registered",
    occurredAt: "Data: 15.01.2026, 12:43",
    title: "NOWA REJESTRACJA",
    icon: "🎉",
    rows: [["👤 Użytkownik", '<img src=x onerror="alert(1)">'], ["📱 Telefon", ""]],
  });
  check("the subject is derived from the event type", mail.subject === "🎉 Nowa rejestracja — GrovBase", mail.subject);
  check("the waitlist event has its own subject",
    renderAdminNotification({ eventType: "waitlist.signup", occurredAt: "", title: "NOWY ZAPIS", rows: [] }).subject
      === "📝 Nowy zapis na listę — GrovBase");
  check("an unknown event falls back to its own headline",
    renderAdminNotification({ eventType: "system.error", occurredAt: "", title: "BŁĄD SYSTEMU", icon: "🚨", rows: [] }).subject
      === "🚨 BŁĄD SYSTEMU — GrovBase");
  // A subject is a header: a CR/LF in a title typed by a stranger would be a
  // header injection, not a formatting quirk.
  check("a newline can never reach the subject line",
    !/[\r\n]/.test(renderAdminNotification({ eventType: "x", occurredAt: "", title: "A\r\nBcc: evil@example.com", rows: [] }).subject));

  check("an empty row never reaches the card", !mail.html.includes("Telefon") && !mail.text.includes("Telefon"));
  check("a hostile name cannot inject markup",
    mail.html.includes("&lt;img") && !mail.html.includes('onerror="alert(1)"')
    // The ONLY real <img> allowed is the brand logo from our own origin.
    && (mail.html.match(/<img/g) ?? []).every(() => true)
    && /<img src="https:\/\/grovbase\.com\/brand\//.test(mail.html)
    && (mail.html.match(/<img/g) ?? []).length === 1);
  check("the plain-text alternative is always emitted",
    mail.text.includes("NOWA REJESTRACJA") && mail.text.includes("Użytkownik:")
    && mail.text.endsWith("grovbase.com · © GrovBase"), mail.text.slice(-60));
  check("the timestamp is printed as given", mail.html.includes("Data: 15.01.2026, 12:43"));
  check("the CTA is an absolute URL built with absoluteUrl()",
    mail.html.includes(`href="${absoluteUrl("/admin/users")}"`) && mail.text.includes(absoluteUrl("/admin/users")));
  check("an unknown event still lands somewhere useful",
    renderAdminNotification({ eventType: "x", occurredAt: "", title: "T", rows: [] }).html.includes(`href="${absoluteUrl("/admin")}"`));
  check("a javascript: href is refused and falls back to the panel",
    !renderAdminNotification({ eventType: "x", occurredAt: "", title: "T", rows: [], ctaHref: "javascript:alert(1)" }).html.includes("javascript:"));
  // No <script>, no stylesheet, no image — an admin's own notification has
  // nothing to load from anywhere and nothing to measure.
  // No <script>, no stylesheet; the one image is our own logo (the shared card
  // shows it by design since the light layout), and nothing else loads.
  check("the card carries no script, no stylesheet and no foreign image",
    !/<script|<link/i.test(mail.html)
    && (mail.html.match(/<img\b/gi) ?? []).length === 1
    && mail.html.includes('src="https://grovbase.com/brand/'));
  check("the brand gradient keeps a solid bgcolor for Outlook",
    mail.html.includes('bgcolor="#D628CF"') && /linear-gradient\((?:90deg|135deg),#D628CF,#F950E1\)/.test(mail.html), mail.html.match(/linear[^)]*\)/)?.[0]);

  console.log(failures === 0 ? "\nAll communications tests passed.\n" : `\n${failures} test(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
