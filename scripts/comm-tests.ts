/**
 * COMMUNICATIONS — deterministic tests for the parts that must never be wrong
 * and need no mail server: the error scrubber (a leaked bot token or password
 * would end up in a database column and on an admin's screen), the secret
 * merge semantics (keep / replace / delete — "keep" is what protects a working
 * password from an untouched form field), the derived dispatch token and the
 * reader for a claimed outbox row — that one takes `unknown`, so a mismatch
 * between it and the RPC's column names typechecks perfectly and silently
 * stops every Telegram message.
 * Run: npm run test:comm
 */
process.env.APP_ENCRYPTION_KEY = "b".repeat(64); // throwaway key for the round trip

import { decryptWith } from "../lib/server/crypto";
import { dispatchToken, mergeSecrets, safeError } from "../lib/server/integrations";
import { dispatchOne, readClaim } from "../lib/server/notify";

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
   notification_dispatch_claim in 0052_communications.sql. Keep them in step. */
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
  telegram_enabled: true,
  telegram_config: { chat_id: "-1001234567890", channel_name: "GrovBase" },
  bot_token_ciphertext: { c: "ciphertext", i: "iv", t: "tag" },
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

  console.log(failures === 0 ? "\nAll communications tests passed.\n" : `\n${failures} test(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
