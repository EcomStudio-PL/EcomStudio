/**
 * THE SECRET STORE — regression guard for the outage this rewrite exists to end.
 *
 * WHAT HAPPENED. Every operator-managed credential — the mailbox password, the
 * Telegram token, the Turnstile key, every AI provider key — was AES ciphertext
 * sealed with APP_ENCRYPTION_KEY from the deploy environment. Production lost
 * that variable, and the failure was not "mail stops sending":
 *
 *   the admin could not TYPE a new password. The field was disabled.
 *
 * The one action that would have ended the outage was the one action the outage
 * prevented. Secrets now live in Supabase Vault and writing one needs an admin
 * session and nothing else — but "nothing else" is a property that a single
 * well-meaning `disabled={...}` can take away again, silently, and typecheck
 * perfectly while doing it. So it is pinned here, as a grep, deliberately.
 *
 * Alongside it: the mail transport rules. Production was configured with IMAP
 * on port 587 with SSL/TLS — a combination that cannot connect, because 587 is
 * the SMTP submission port. That is now refused in the form and in the action,
 * and the exact broken configuration is a test case below.
 *
 * Run: npm run test:secrets
 */
process.env.APP_ENCRYPTION_KEY = "d".repeat(64); // throwaway, never a real one

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { imapAdvice, smtpAdvice, IMAP_PRESET, SMTP_PRESET, validPort } from "../lib/mail/transport";
import { secretName } from "../lib/server/secret-store";
import { providerSecretName, VAULT_SENTINEL } from "../lib/server/provider-credentials";
import { encryptWith } from "../lib/server/crypto";
import { resolveSecrets } from "../lib/server/integrations";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

async function main() {

/* ── A. NOTHING MAY DISABLE A CREDENTIAL FIELD ──────────────────────────────
 * The forms that take a secret, and the rule that the server's state is never
 * allowed to make one read-only. `smtp_same_as_imap` is the sole exception and
 * it is the ADMIN'S OWN CHOICE, made two fields higher up on the same screen. */
console.log("A. EVERY CREDENTIAL FIELD STAYS EDITABLE");

const SECRET_FORMS = [
  "components/admin/mail-integration-form.tsx",
  "components/admin/telegram-integration-form.tsx",
  "components/admin/captcha-integration-form.tsx",
  "components/admin/provider-card.tsx",
  "components/admin/email-settings-form.tsx",
];
/** The ONLY thing allowed to make a credential field read-only: the admin's
 *  own "use the same credentials as IMAP" choice, made on the same screen. */
const ADMIN_CHOICE = /^v\.smtp_same_as_imap$/;
/** Anything the server decides about its own configuration. A field that this
 *  gates is a field that goes dead exactly when it is needed. */
const SERVER_STATE = /\b(encryptionReady|encryptionAvailable|secretsState|keyMissing|serverReady|canGenerate)\b/;

/** Comments explain history and sometimes quote the code being removed, so
 *  they are stripped before anything here is treated as live code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

for (const file of SECRET_FORMS) {
  const src = stripComments(readFileSync(file, "utf8"));

  const gated = [...src.matchAll(/disabled=\{([^}]*)\}/g)]
    .map((m) => m[1]!.trim()).filter((d) => SERVER_STATE.test(d));
  check(`${file}: nothing at all is disabled by server key state`, gated.length === 0, gated.join(" | "));

  // Now the credential fields specifically. Every <SecretInput> is located and
  // the element enclosing it is checked: a wrapper carrying `disabled` makes
  // the input inside it read-only just as surely as the prop would.
  let checked = 0;
  for (const m of src.matchAll(/<SecretInput\b/g)) {
    checked++;
    const before = src.slice(0, m.index!);
    // The nearest enclosing element that could disable anything.
    const open = before.lastIndexOf("<fieldset");
    const closed = before.lastIndexOf("</fieldset>");
    if (open < 0 || open < closed) continue; // not inside a fieldset at all
    const tag = src.slice(open, src.indexOf(">", open) + 1);
    const dis = /disabled=\{([^}]*)\}/.exec(tag);
    check(`${file}: the secret field is gated only by the admin's own choice`,
      !dis || ADMIN_CHOICE.test(dis[1]!.trim()), tag.trim());
  }
  check(`${file}: has a credential field to protect (${checked})`, checked > 0);
}

/* ── B. THE SECRET NEVER TRAVELS TO THE BROWSER ───────────────────────────── */
console.log("\nB. NO PLAINTEXT LEAVES THE SERVER");

const CLIENT_FILES = walk("components").concat(walk("app").filter((f) => !f.includes("/actions/")));
const clientReaders: string[] = [];
for (const f of CLIENT_FILES) {
  const src = readFileSync(f, "utf8");
  if (!src.startsWith('"use client"')) continue;
  // secret_read and readSecret(s) are the only functions that yield plaintext.
  // A client component must never reach either.
  if (/\brpc\(\s*["'`]secret_read["'`]/.test(src) || /\breadSecrets?\s*\(/.test(src)) clientReaders.push(f);
}
check(`no client component reads a secret (${CLIENT_FILES.length} files scanned)`,
  clientReaders.length === 0, clientReaders.join(", "));

// The one view the admin panel renders must carry booleans and timestamps only.
const integrations = readFileSync("lib/server/integrations.ts", "utf8");
const viewType = integrations.slice(integrations.indexOf("export type IntegrationView"),
  integrations.indexOf("/** The secret names each integration owns"));
check("IntegrationView exposes hasSecret booleans, never a value",
  /hasSecret: Record<string, boolean>/.test(viewType) && !/secrets:/.test(viewType), viewType.slice(0, 200));

/* ── C. THE HOSTIDO CONFIGURATION FROM THE SCREENSHOTS ─────────────────────
 * IMAP · host483417.hostido.net.pl · port 587 · SSL/TLS. This is what
 * production was actually set to, and it is why "Testuj IMAP" timed out. */
console.log("\nC. THE BROKEN PRODUCTION CONFIGURATION IS REFUSED");

const broken = imapAdvice(587, true);
check("IMAP on 587 is an error, not a warning", broken?.level === "error", JSON.stringify(broken));
check("and it says WHICH protocol owns that port",
  broken?.key === "comm.hint.imapSmtpPort", JSON.stringify(broken));

check("IMAP 587 without TLS is still refused — the port is the problem",
  imapAdvice(587, false)?.level === "error");
check("IMAP 25 and 465 are refused too (also SMTP)",
  imapAdvice(25, false)?.level === "error" && imapAdvice(465, true)?.level === "error");

/* ── D. THE COMBINATIONS THAT WORK ARE ACCEPTED SILENTLY ──────────────────── */
console.log("\nD. THE FOUR VALID COMBINATIONS PASS CLEAN");

check("IMAP 993 + SSL/TLS", imapAdvice(993, true) === null);
check("IMAP 143 + STARTTLS (no implicit TLS)", imapAdvice(143, false) === null);
check("SMTP 587 + STARTTLS", smtpAdvice(587, "starttls") === null);
check("SMTP 465 + SSL/TLS", smtpAdvice(465, "ssl") === null);

check("IMAP 993 without TLS is refused", imapAdvice(993, false)?.level === "error");
check("IMAP 143 WITH implicit TLS is refused", imapAdvice(143, true)?.level === "error");
check("SMTP 587 + SSL is refused", smtpAdvice(587, "ssl")?.level === "error");
check("SMTP 465 + STARTTLS is refused", smtpAdvice(465, "starttls")?.level === "error");
check("SMTP on an IMAP port is refused", smtpAdvice(993, "ssl")?.level === "error");
check("plaintext SMTP warns but does not block",
  smtpAdvice(2525, "none")?.level === "warn", JSON.stringify(smtpAdvice(2525, "none")));
check("an unusual but plausible port only warns",
  imapAdvice(1143, true)?.level === "warn", JSON.stringify(imapAdvice(1143, true)));
check("an impossible port number is an error",
  imapAdvice(0, true)?.level === "error" && smtpAdvice(70000, "starttls")?.level === "error");
check("validPort agrees at both edges",
  validPort(1) && validPort(65535) && !validPort(0) && !validPort(65536) && !validPort(2.5));

/* ── E. THE PRESETS ARE THE COMBINATIONS THAT PASS ────────────────────────── */
console.log("\nE. THE ONE-CLICK PRESETS PRODUCE VALID CONFIGURATIONS");

check("the IMAP preset is accepted by its own validator",
  imapAdvice(IMAP_PRESET.port, IMAP_PRESET.secure) === null,
  JSON.stringify(IMAP_PRESET));
check("the SMTP preset is accepted by its own validator",
  smtpAdvice(SMTP_PRESET.port, SMTP_PRESET.encryption) === null,
  JSON.stringify(SMTP_PRESET));
check("the presets are Hostido's documented values (993/587)",
  IMAP_PRESET.port === 993 && SMTP_PRESET.port === 587);

/* ── F. THE SERVER REFUSES WHAT THE FORM REFUSES ──────────────────────────── */
console.log("\nF. THE SAVE ACTION ENFORCES THE SAME RULES");

const action = readFileSync("app/actions/integrations.ts", "utf8");
check("saveMailIntegrationAction calls imapAdvice", /imapAdvice\(config\.imap_port/.test(action));
check("saveMailIntegrationAction calls smtpAdvice", /smtpAdvice\(config\.smtp_port/.test(action));
check("and both share the form's module, so they cannot drift",
  /from "@\/lib\/mail\/transport"/.test(action));

/* ── G. ONE STORE, AND ONE NAMING CONVENTION ──────────────────────────────── */
console.log("\nG. ONE STORE FOR EVERY OPERATOR-MANAGED SECRET");

check("mail secrets are named grovbase.mail.*",
  secretName("mail", "imap_password") === "grovbase.mail.imap_password");
check("provider keys share the same convention",
  providerSecretName("abc-123") === "grovbase.provider.abc-123");

// No credential-writing path may seal its own secret any more. Content
// encrypted at rest (prompt bodies, knowledge hints, engine rules) is a
// different thing and stays as it is — these are the CREDENTIAL paths.
const CREDENTIAL_WRITERS = [
  "app/actions/credentials.ts",
  "lib/server/provider-credentials.ts",
  "lib/server/secret-store.ts",
];
for (const f of CREDENTIAL_WRITERS) {
  const src = readFileSync(f, "utf8");
  check(`${f}: does not encrypt a credential itself`, !/\bencryptSecret\s*\(/.test(src));
}

check("the vault sentinel is not mistakable for base64 ciphertext",
  VAULT_SENTINEL === "vault" && VAULT_SENTINEL.length < 8);

/* ── H. THE RE-ENCRYPT ROUND TRIP IS GONE ──────────────────────────────────
 * Four send paths used to re-seal a password they already held, purely to
 * satisfy SmtpConfig's ciphertext shape — which is why testing SMTP, sending a
 * login code, mailing an admin notification and sending an auth e-mail all
 * died together when one deploy variable went missing. */
console.log("\nH. NO SEND PATH RE-ENCRYPTS A PASSWORD IT ALREADY HOLDS");

const SEND_PATHS = [
  "app/actions/integrations.ts", "lib/server/auth-mail.ts",
  "lib/server/login-security.ts", "lib/server/notify.ts",
];
for (const f of SEND_PATHS) {
  const src = readFileSync(f, "utf8");
  const reseals = /const sealed = encryptSecret\(password\)/.test(src);
  check(`${f}: hands the plaintext straight to the transport`, !reseals);
}
const mailer = readFileSync("lib/server/mailer.ts", "utf8");
check("SmtpConfig accepts a plaintext password", /password\?: string \| null;/.test(mailer));
check("and the transport prefers it over the legacy ciphertext",
  mailer.indexOf("const direct = cfg.password?.trim();") < mailer.indexOf("if (!cfg.ciphertext"));

/* ── I. THE DEAD ADVICE IS GONE FROM THE PRODUCT ──────────────────────────
 * "Restore APP_ENCRYPTION_KEY in your deploy environment" is no longer the
 * remedy for anything an operator can see, so it must not be on a screen. */
console.log("\nI. THE PANEL NEVER SENDS THE OPERATOR TO A DEPLOY PLATFORM");

for (const loc of ["pl", "en", "de"]) {
  const dict = readFileSync(`lib/i18n/dictionaries/${loc}.json`, "utf8");
  check(`${loc}.json: no user-facing string names APP_ENCRYPTION_KEY`,
    !dict.includes("APP_ENCRYPTION_KEY"));
  check(`${loc}.json: no user-facing string tells the admin to edit env vars`,
    !/zmiennych środowiskowych produkcji|environment variables on the server|Umgebungsvariablen der Produktion/.test(dict));
}

/* ── J. EVERY KEY THE CODE ASKS FOR ACTUALLY EXISTS ───────────────────────── */
console.log("\nJ. NO TRANSLATION KEY RESOLVES TO ITSELF");

const dicts = Object.fromEntries(["pl", "en", "de"].map((l) =>
  [l, JSON.parse(readFileSync(`lib/i18n/dictionaries/${l}.json`, "utf8")) as Record<string, Record<string, unknown>>]));

/** makeT resolves "a.b.c" by walking, then by flat key — mirror both. */
function has(dict: Record<string, Record<string, unknown>>, key: string): boolean {
  const parts = key.split(".");
  let node: unknown = dict;
  for (const p of parts) {
    if (typeof node !== "object" || node === null) { node = undefined; break; }
    node = (node as Record<string, unknown>)[p];
  }
  if (typeof node === "string") return true;
  // Flat form: "comm" -> "err.imap"
  const head = parts[0]!;
  const rest = parts.slice(1).join(".");
  const section = dict[head];
  return typeof section === "object" && section !== null && typeof section[rest] === "string";
}

// Every key this rewrite introduced, plus the ones its error maps point at.
const NEW_KEYS = [
  "comm.secretUnreadable", "comm.err.secretWrite", "comm.err.encryptionRead",
  "comm.hint.imapSmtpPort", "comm.hint.imap993NeedsTls", "comm.hint.imap143NoTls",
  "comm.hint.imapUnusual", "comm.hint.smtpImapPort", "comm.hint.smtp465NeedsSsl",
  "comm.hint.smtp587NeedsStarttls", "comm.hint.smtpPlaintext", "comm.hint.smtpUnusual",
  "comm.hint.useImapPreset", "comm.hint.useSmtpPreset",
  "admin.secretWriteFailed", "admin.secretHint", "admin.tools.source.vault",
];
for (const loc of ["pl", "en", "de"]) {
  const missing = NEW_KEYS.filter((k) => !has(dicts[loc]!, k));
  check(`${loc}.json has every new key (${NEW_KEYS.length})`, missing.length === 0, missing.join(", "));
}

// And the keys the error map claims to translate.
const cards = readFileSync("components/admin/integration-cards.tsx", "utf8");
const mapped = [...cards.matchAll(/:\s*"((?:comm|admin)\.[^"]+)"/g)].map((m) => m[1]!);
for (const loc of ["pl", "en", "de"]) {
  const missing = [...new Set(mapped)].filter((k) => !has(dicts[loc]!, k));
  check(`${loc}.json resolves every mapped error code (${new Set(mapped).size})`,
    missing.length === 0, missing.join(", "));
}

/* ── J2. THE STEP VOCABULARY IS COMPLETE AND SAFE ─────────────────────────
 * The per-step test result is a fixed vocabulary of ids and codes. A code the
 * dictionaries do not know would render as a raw key on an admin's screen —
 * which is the same failure as printing a driver message, just uglier. */
console.log("\nJ2. EVERY TEST-STEP LABEL RESOLVES");

const STEP_IDS = ["settings", "connect", "tls", "auth", "mailbox"];
const STEP_CODES = [
  // Everything classifyProbe can return...
  "dns", "refused", "timeout", "reset", "tls_mismatch", "tls_cert", "auth", "generic",
  // ...plus what classifyMailError adds on the login step, and the settings step.
  "port_mismatch", "tls", "network", "not_configured", "send_failed",
];
for (const loc of ["pl", "en", "de"]) {
  const missing = [
    ...STEP_IDS.map((id) => `comm.step.${id}`), "comm.step.notRun",
    ...STEP_CODES.map((c) => `comm.stepErr.${c}`),
  ].filter((k) => !has(dicts[loc]!, k));
  check(`${loc}.json labels every step and step error (${STEP_IDS.length + STEP_CODES.length + 1})`,
    missing.length === 0, missing.join(", "));
}

// classifyProbe's returns must all be in that list — a code added to the
// classifier without a label is exactly how a raw key reaches a screen.
const probeSrc = readFileSync("lib/server/mail-probe.ts", "utf8");
const classifier = probeSrc.slice(probeSrc.indexOf("export function classifyProbe"));
const returned = [...classifier.matchAll(/return "([a-z_]+)";/g)].map((m) => m[1]!);
const unlabelled = returned.filter((c) => !STEP_CODES.includes(c));
check(`classifyProbe returns only labelled codes (${returned.length})`,
  unlabelled.length === 0, unlabelled.join(", "));

// And the classifier must DISCARD the driver text rather than pass it through.
check("classifyProbe never returns the driver's own message",
  !/return raw|return m\b|\.slice\(/.test(classifier), classifier.slice(0, 120));

/* ── K. THE DELETED KEYS ARE NOT STILL REFERENCED ─────────────────────────── */
console.log("\nK. NOTHING STILL ASKS FOR A DELETED KEY");

const GONE = ["comm.encryptionMissing", "comm.encryptionRotated"];
const allSrc = walk("app").concat(walk("components"), walk("lib").filter((f) => !f.includes("dictionaries")));
const stale: string[] = [];
for (const f of allSrc) {
  const src = readFileSync(f, "utf8");
  for (const k of GONE) if (src.includes(`"${k}"`)) stale.push(`${f} -> ${k}`);
}
check(`no source references a removed key (${allSrc.length} files scanned)`,
  stale.length === 0, stale.join(", "));

/* ── L. THE VAULT WINS, AND A SUPERSEDED CIPHERTEXT IS NOT AN ERROR ───────
 *
 * THE BUG THIS SECTION EXISTS FOR. An operator saved a new mailbox password in
 * the panel. It went to the vault, the inbox opened on it and listed mail —
 * while "Sprawdź nowe wiadomości", one button away on the same screen,
 * answered that the saved password could not be read. Both were telling the
 * truth about different things: the poller read the ROW's ciphertext, which was
 * the superseded password sealed with a key this deployment no longer has, and
 * never asked the vault at all.
 *
 * The rule is one sentence — the vault answers first, and the legacy bag is
 * consulted only for fields it did not answer — and the fix was to have exactly
 * one implementation of it. The three cases below are the ones that were, and
 * must stay, distinguishable. */
console.log("\nL. VAULT FIRST, LEGACY ONLY AS FALLBACK");

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
/** A legacy envelope nothing in this process can open: sealed with KEY_B while
 *  the deployment holds KEY_A. That is a rotated key, exactly. */
function sealedWith(keyHex: string, value: string) {
  const e = encryptWith(keyHex, value);
  return { c: e.ciphertext, i: e.iv, t: e.authTag };
}

process.env.GROVBASE_INTEGRATIONS_ENCRYPTION_KEY = "";
process.env.APP_ENCRYPTION_KEY = KEY_A;

// CASE A — the vault has it, the legacy copy is unopenable. The vault wins and
// NOTHING is reported as unreadable: the operator has already done the only
// thing they could do, and telling them to do it again is the bug.
const caseA = resolveSecrets(
  { imap_password: "from-vault" },
  { imap_password: sealedWith(KEY_B, "old-password") },
);
check("A: the credential comes from the vault", caseA.secrets.imap_password === "from-vault");
check("A: the verdict is ok, not decrypt", caseA.state === "ok", caseA.state);
check("A: nothing is reported unreadable", caseA.unreadable.length === 0, caseA.unreadable.join(","));

// CASE B — no vault copy and the legacy one cannot be opened. This IS the
// warning case, and it has to name the field rather than the row.
const caseB = resolveSecrets({}, { imap_password: sealedWith(KEY_B, "old-password") });
check("B: no credential is produced", caseB.secrets.imap_password === undefined);
check("B: the verdict is decrypt", caseB.state === "decrypt", caseB.state);
check("B: the unopenable field is named", caseB.unreadable.join(",") === "imap_password");

// B2 — same shape with no key on the server at all. Different cause, different
// sentence, same "cannot be read" outcome.
process.env.APP_ENCRYPTION_KEY = "";
const caseB2 = resolveSecrets({}, { imap_password: sealedWith(KEY_B, "old-password") });
check("B2: no key on the server reads as key_missing", caseB2.state === "key_missing", caseB2.state);
check("B2: and still names the field", caseB2.unreadable.join(",") === "imap_password");
// …and the vault copy survives a server with no key, which is the entire point
// of migration 0078.
const caseB3 = resolveSecrets({ imap_password: "from-vault" }, { imap_password: sealedWith(KEY_B, "x") });
check("B3: a vault credential works with no encryption key at all",
  caseB3.secrets.imap_password === "from-vault" && caseB3.state === "ok");
process.env.APP_ENCRYPTION_KEY = KEY_A;

// CASE C — both exist and both are readable. The vault still wins, because the
// freshly typed password is the one the operator meant.
const caseC = resolveSecrets(
  { imap_password: "from-vault" },
  { imap_password: sealedWith(KEY_A, "legacy-but-openable") },
);
check("C: the vault beats a perfectly readable legacy value",
  caseC.secrets.imap_password === "from-vault");
check("C: and the row stays ok", caseC.state === "ok" && caseC.unreadable.length === 0);

// D — a field the vault does NOT answer for still falls back, so a deployment
// that has re-entered only one of two credentials keeps the other one working.
const caseD = resolveSecrets(
  { imap_password: "from-vault" },
  { imap_password: sealedWith(KEY_B, "old"), smtp_password: sealedWith(KEY_A, "legacy-smtp") },
);
check("D: the untouched field is still read from the legacy bag",
  caseD.secrets.smtp_password === "legacy-smtp" && caseD.secrets.imap_password === "from-vault");
check("D: and the row is ok, because everything resolved", caseD.state === "ok", caseD.state);

/* ── L2. ONE IMPLEMENTATION, NOT THREE ───────────────────────────────────
 * The rule above is only worth anything if every credential path goes through
 * it. Each of these three used to open a ciphertext by hand. */
console.log("\nL2. EVERY CREDENTIAL PATH USES IT");

const mailActions = readFileSync("app/actions/mail.ts", "utf8");
check("the mail poller resolves through the shared function",
  /resolveSecrets\(/.test(mailActions));
check("and asks the vault before the row",
  /readSecrets\(supabase, \[name\]\)/.test(mailActions));
check("the poller no longer carries its own key resolution",
  !/function integrationsKeyHex/.test(mailActions));

const integrationsSrc = readFileSync("lib/server/integrations.ts", "utf8");
check("the panel's per-card verdict comes from the same function",
  /secretsState: resolveSecrets\(\{\}, legacyOnly\)\.state/.test(integrationsSrc));
check("there is no second bag-opening helper left",
  !/function bagState/.test(integrationsSrc));

const notifySrc = readFileSync("lib/server/notify.ts", "utf8");
check("the notification dispatcher reads the vault once per batch",
  /readSecrets\(supabase, \[TELEGRAM_TOKEN_SECRET, SMTP_PASSWORD_SECRET\]\)/.test(notifySrc));
check("a vault credential counts as configured even with no ciphertext on the row",
  /!vault\.botToken && !row\.blob/.test(notifySrc) && /!vault\.smtpPassword && !row\.smtpBlob/.test(notifySrc));

/* ── L3. THE WARNING NAMES ITS CHANNEL ───────────────────────────────────
 * One unnamed banner across three integrations is how a legacy Telegram token
 * came to read as "your mailbox password is unreadable" on a screen where the
 * mailbox was connected and listing mail. */
console.log("\nL3. THE STALE-SECRET WARNING IS ATTRIBUTABLE");

check("the banner is built from the per-integration verdict",
  /secretsState === "key_missing" \|\| \w+\.secretsState === "decrypt"/.test(cards));
check("and names the channels it concerns",
  /t\("comm\.secretUnreadable", \{ channels:/.test(cards));
check("the toast for a single channel does NOT reuse the banner's copy",
  !/encryption_unavailable: "comm\.secretUnreadable"/.test(cards));
for (const loc of ["pl", "en", "de"]) {
  const dict = dicts[loc]!;
  const banner = (dict.comm as Record<string, unknown>)?.secretUnreadable;
  check(`${loc}: the banner copy takes the channel list`,
    typeof banner === "string" && banner.includes("{channels}"), String(banner).slice(0, 40));
}
}

function report() {
  console.log(failures === 0 ? "\nAll secret-store tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().then(report).catch((e) => {
  console.error("secret-store tests crashed:", e);
  process.exit(1);
});
