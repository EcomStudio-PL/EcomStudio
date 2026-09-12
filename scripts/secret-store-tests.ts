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
}

function report() {
  console.log(failures === 0 ? "\nAll secret-store tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().then(report).catch((e) => {
  console.error("secret-store tests crashed:", e);
  process.exit(1);
});
