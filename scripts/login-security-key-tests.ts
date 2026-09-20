/**
 * THE SECOND FACTOR MUST BE ABLE TO ISSUE A CODE ON THE DEPLOYMENT WE ACTUALLY RUN.
 *
 * WHAT THIS EXISTS TO CATCH, in the exact shape it happened.
 *
 * On 2026-09-13 production's proof-of-server moved to GROVBASE_SERVER_KEY and
 * the two legacy key variables were deleted. `lib/server/server-token.ts` had
 * already been taught the new name; `lib/server/login-security.ts` had its own
 * private resolver that read ONLY the legacy names, so from that moment
 * `loginSecurityToken()` returned null in production.
 *
 * Nothing reported it. A missing key was folded into "can we send mail", and
 * `enforceLoginSecurity` fails OPEN on that — so the entire second factor was
 * silently off for six days while the admin panel showed it enabled. When the
 * two questions were finally separated and a missing key was made to fail
 * CLOSED, the same null became a lockout: the step-up page appeared, the timer
 * ran, and no code could ever be issued, because `openOrReuseChallenge` returns
 * before it opens a challenge or sends mail. Nobody could log in, including the
 * admin.
 *
 * So a test that only asked "was sendSecurityCode called" would have passed
 * throughout, in both the silent-bypass week and the lockout. This file
 * therefore runs the real chain — real secret resolution, real token
 * derivation, the real sha256 comparison the database performs, the real
 * challenge lifecycle, the real code generation and mail rendering — and stops
 * only at the SMTP socket. Two modules are aliased at build time and nothing
 * else: the mailer (records instead of sending) and the Vault-backed SMTP read.
 *
 * THE INVARIANT, stated once: the step-up must be able to issue a code on a
 * deployment whose ONLY configured secret is GROVBASE_SERVER_KEY. That is
 * production. It is section B, and against the pre-fix code it fails.
 *
 * Run: npm run test:loginkey
 */
import { createHash } from "crypto";
import {
  loginSecurityToken,
  openOrReuseChallenge,
  verifyChallengeCode,
  stepUpDispatchReady,
  LOGIN_SECURITY_DEFAULTS,
  hashCode,
  type LoginSecuritySettings,
} from "@/lib/server/login-security";
import { dispatchToken, serverSecret } from "@/lib/server/integrations";
/*
  THE TEST CONTROLS ARE IMPORTED BY THEIR REAL PATH, not through the alias.

  esbuild rewrites "@/lib/server/mailer" and "@/lib/server/integrations" to
  these two files for this bundle, so the code under test and these imports
  resolve to the SAME module instance and the recorder sees the real calls.
  Importing them through the alias instead would compile and run, but `tsc`
  resolves the alias to the genuine modules — which export no test helpers —
  so the typecheck would fail on a file that works. Same module either way;
  only this spelling is honest to both tools.
*/
import {
  deliveries,
  __reset as resetMailer,
  __failNextWith,
} from "./stubs/login-security-mailer";
import {
  __smtpConfigured,
  __smtpNotConfigured,
  __vaultUnavailable,
} from "./stubs/login-security-integrations";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 220)}`}`);
  if (!cond) failures += 1;
}

const KEY_NAMES = [
  "GROVBASE_SERVER_KEY",
  "GROVBASE_INTEGRATIONS_ENCRYPTION_KEY",
  "APP_ENCRYPTION_KEY",
] as const;

function clearKeys(): void {
  for (const n of KEY_NAMES) delete process.env[n];
}

/* ── a database that behaves like the real one ───────────────────────────────
 * The part that matters is login_security_token_ok: the SECURITY DEFINER
 * functions accept a caller ONLY when sha256(token) equals the hash stored in
 * app_settings.login_security_dispatch. That comparison is what the production
 * deployment was failing, so it is reproduced exactly rather than assumed. */
type ChallengeRow = {
  id: string;
  user_id: string;
  device_hash: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: number;
  used_at: number | null;
  created_at: number;
};

class FakeDb {
  settings = new Map<string, Record<string, unknown>>();
  challenges: ChallengeRow[] = [];
  /** Set false to model a non-admin session, which migration 0107 refuses. */
  callerIsAdmin = true;
  now = Date.now();
  private seq = 0;

  tokenOk(token: unknown): boolean {
    const stored = this.settings.get("login_security_dispatch")?.hash;
    if (typeof stored !== "string" || stored === "") return false;
    const given = createHash("sha256").update(String(token ?? "")).digest("hex");
    return given === stored;
  }

  live(user: string, device: string): ChallengeRow | null {
    return this.challenges.find(
      (c) => c.user_id === user && c.device_hash === device && c.used_at === null && c.expires_at > this.now,
    ) ?? null;
  }

  client() {
    const db = this;
    return {
      from(table: string) {
        return {
          select() {
            return {
              eq(_col: string, key: string) {
                return {
                  async maybeSingle() {
                    if (table !== "app_settings") return { data: null, error: null };
                    // 0107: a non-admin cannot read the private dispatch row.
                    if (!db.callerIsAdmin && key === "login_security_dispatch") {
                      return { data: null, error: null };
                    }
                    const value = db.settings.get(key);
                    return { data: value ? { value } : null, error: null };
                  },
                };
              },
            };
          },
          async upsert(row: { key: string; value: Record<string, unknown> }) {
            if (!db.callerIsAdmin) return { error: { code: "42501", message: "permission denied" } };
            db.settings.set(row.key, row.value);
            return { error: null };
          },
        };
      },
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === "login_challenge_peek") {
          if (!db.tokenOk(args.p_token)) return { data: null, error: null };
          const row = db.live(String(args.p_user), String(args.p_device_hash));
          if (!row) return { data: null, error: null };
          return {
            data: {
              age_seconds: Math.floor((db.now - row.created_at) / 1000),
              expires_in_seconds: Math.floor((row.expires_at - db.now) / 1000),
            },
            error: null,
          };
        }
        if (name === "login_challenge_open") {
          // The real function returns NULL on a bad token, it does not raise.
          if (!db.tokenOk(args.p_token)) return { data: null, error: null };
          // Spend any live challenge so only one code is ever valid.
          for (const c of db.challenges) {
            if (c.user_id === args.p_user && c.device_hash === args.p_device_hash
                && c.used_at === null && c.expires_at > db.now) {
              c.used_at = db.now;
            }
          }
          const ttl = Math.max(30, Number(args.p_ttl_seconds ?? 120));
          const row: ChallengeRow = {
            id: `ch_${++db.seq}`,
            user_id: String(args.p_user),
            device_hash: String(args.p_device_hash),
            code_hash: String(args.p_code_hash),
            attempts: 0,
            max_attempts: Math.max(1, Number(args.p_max_attempts ?? 5)),
            expires_at: db.now + ttl * 1000,
            used_at: null,
            created_at: db.now,
          };
          db.challenges.push(row);
          return { data: row.id, error: null };
        }
        if (name === "login_challenge_verify") {
          if (!db.tokenOk(args.p_token)) return { data: { ok: false, reason: "forbidden" }, error: null };
          const row = db.live(String(args.p_user), String(args.p_device_hash));
          if (!row) return { data: { ok: false, reason: "expired" }, error: null };
          if (row.code_hash !== String(args.p_code_hash)) {
            row.attempts += 1;
            return {
              data: { ok: false, reason: "mismatch", attempts_left: Math.max(0, row.max_attempts - row.attempts) },
              error: null,
            };
          }
          row.used_at = db.now;
          return { data: { ok: true }, error: null };
        }
        return { data: null, error: null };
      },
    };
  }
}

type Client = Parameters<typeof openOrReuseChallenge>[0];

const SETTINGS: LoginSecuritySettings = { ...LOGIN_SECURITY_DEFAULTS };

function opts(db: FakeDb, force = false) {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    email: "seller@example.test",
    deviceHash: "device-hash-aaa",
    ipHash: "ip-hash-bbb",
    label: "Chrome · Windows",
    reason: "new_device" as const,
    settings: SETTINGS,
    force,
  };
}

/** The code that actually reached the transport, dug out of the rendered mail
 *  rather than taken on trust from the function that generated it. */
function codeFromLastMail(): string | null {
  const last = deliveries[deliveries.length - 1];
  if (!last) return null;
  const m = last.text.replace(/\s+/g, "").match(/(\d{6})/)
    ?? last.html.replace(/<[^>]+>/g, "").replace(/\s+/g, "").match(/(\d{6})/);
  return m ? m[1]! : null;
}

async function main() {
  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\nA. ONE RESOLVER, SHARED WITH THE REST OF THE SERVER");
  {
    clearKeys();
    process.env.GROVBASE_SERVER_KEY = "a-long-random-proof-of-server-value-32+";
    check("serverSecret() reads GROVBASE_SERVER_KEY", serverSecret() !== null);
    check("and the step-up derives a token from the SAME secret",
      loginSecurityToken() !== null,
      "null here is the 2026-09-20 lockout: the step-up cannot issue or verify a code");
    check("stepUpDispatchReady() agrees", stepUpDispatchReady());

    // Domain separation: same secret, two tokens that must never be swapped.
    check("the login token is NOT the notification dispatch token",
      loginSecurityToken() !== dispatchToken());

    // It must follow the secret, or it is reading something else.
    const first = loginSecurityToken();
    process.env.GROVBASE_SERVER_KEY = "a-different-long-random-proof-of-server";
    check("rotating the secret rotates the token", loginSecurityToken() !== first);

    clearKeys();
    check("no secret at all means no token", loginSecurityToken() === null);
    check("and stepUpDispatchReady() reports it", !stepUpDispatchReady());
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\nB. THE PRODUCTION DEPLOYMENT CAN ISSUE A CODE");
  console.log("   (only GROVBASE_SERVER_KEY set — this is the regression)");
  {
    clearKeys();
    process.env.GROVBASE_SERVER_KEY = "a-long-random-proof-of-server-value-32+";
    resetMailer();
    __smtpConfigured();
    const db = new FakeDb();
    // The row starts STALE, exactly as production was: a hash published on
    // 2026-09-06 from a key that no longer exists anywhere.
    db.settings.set("login_security_dispatch", { hash: "0".repeat(64) });

    const r = await openOrReuseChallenge(db.client() as unknown as Client, opts(db));

    check("the challenge was OPENED", db.challenges.length === 1,
      `challenges=${db.challenges.length}`);
    check("the stale dispatch hash was republished from the live secret",
      db.settings.get("login_security_dispatch")?.hash
        === createHash("sha256").update(String(loginSecurityToken())).digest("hex"));
    check("openOrReuseChallenge reports 'sent'", r.status === "sent", JSON.stringify(r));
    check("EXACTLY ONE mail reached the transport", deliveries.length === 1,
      `deliveries=${deliveries.length}`);

    const d = deliveries[0];
    check("it went to the signed-in address", d?.to === "seller@example.test", d?.to);
    check("the transport got a complete SMTP identity",
      Boolean(d && d.smtp.host && d.smtp.port && d.smtp.user && d.smtp.password
              && d.identity.from_email),
      "host/port/user/password/from must all be present");

    const code = codeFromLastMail();
    check("the mail carries a real 6-digit code", /^\d{6}$/.test(code ?? ""), String(code));
    check("and it is the code the challenge stored",
      Boolean(code) && db.challenges[0]?.code_hash === hashCode(code!));
    check("the code is not in the subject line", !/\d{6}/.test(d?.subject ?? ""), d?.subject);

    // ...and the round trip actually completes.
    const ok = await verifyChallengeCode(db.client() as unknown as Client, {
      userId: opts(db).userId, deviceHash: opts(db).deviceHash, ipHash: opts(db).ipHash,
      label: opts(db).label, code: code!,
    });
    check("THE EMAILED CODE COMPLETES THE LOGIN", ok.ok === true, JSON.stringify(ok));
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\nC. NO SERVER KEY — FAIL CLOSED, AND SAY SO");
  {
    clearKeys();
    resetMailer();
    __smtpConfigured();
    const db = new FakeDb();
    db.settings.set("login_security_dispatch", { hash: "0".repeat(64) });

    const r = await openOrReuseChallenge(db.client() as unknown as Client, opts(db));
    check("no challenge is opened", db.challenges.length === 0);
    check("NO mail is sent", deliveries.length === 0);
    check("the caller is told it failed", r.status === "error", JSON.stringify(r));
    check("it does NOT report success", (r.status as string) !== "sent");

    // And the login cannot be completed by any code.
    const v = await verifyChallengeCode(db.client() as unknown as Client, {
      userId: opts(db).userId, deviceHash: opts(db).deviceHash, ipHash: opts(db).ipHash,
      label: opts(db).label, code: "123456",
    });
    check("and no code can finish the login", v.ok === false, JSON.stringify(v));
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\nD. SMTP / VAULT DOWN — LOGIN MUST NOT SUCCEED");
  {
    process.env.GROVBASE_SERVER_KEY = "a-long-random-proof-of-server-value-32+";

    // D1 — the mailbox is not configured.
    resetMailer();
    __smtpNotConfigured();
    let db = new FakeDb();
    db.settings.set("login_security_dispatch", { hash: "0".repeat(64) });
    let r = await openOrReuseChallenge(db.client() as unknown as Client, opts(db));
    check("not configured → status 'not_configured'", r.status === "not_configured", JSON.stringify(r));
    check("not configured → no mail claimed", deliveries.length === 0);
    check("not configured → never reports 'sent'", (r.status as string) !== "sent");

    // D2 — Vault itself is unreachable (the read throws).
    resetMailer();
    __vaultUnavailable();
    db = new FakeDb();
    db.settings.set("login_security_dispatch", { hash: "0".repeat(64) });
    let threw = false;
    try {
      r = await openOrReuseChallenge(db.client() as unknown as Client, opts(db));
    } catch { threw = true; r = { status: "error" }; }
    check("vault down → the caller does not get 'sent'",
      threw || (r.status as string) !== "sent", JSON.stringify(r));
    check("vault down → no mail is recorded", deliveries.length === 0);

    // D3 — the transport itself refuses the message.
    resetMailer();
    __smtpConfigured();
    __failNextWith("ECONNREFUSED");
    db = new FakeDb();
    db.settings.set("login_security_dispatch", { hash: "0".repeat(64) });
    r = await openOrReuseChallenge(db.client() as unknown as Client, opts(db));
    check("transport refused → status 'error', not 'sent'", r.status === "error", JSON.stringify(r));
    check("transport refused → nothing was delivered", deliveries.length === 0);
    __failNextWith(null);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\nE. THE RULES AROUND THE CODE STILL HOLD");
  {
    process.env.GROVBASE_SERVER_KEY = "a-long-random-proof-of-server-value-32+";
    resetMailer();
    __smtpConfigured();
    const db = new FakeDb();
    db.settings.set("login_security_dispatch", { hash: "0".repeat(64) });
    const client = db.client() as unknown as Client;

    await openOrReuseChallenge(client, opts(db));
    const firstCode = codeFromLastMail()!;
    check("one click → one mail", deliveries.length === 1);

    // A reload inside the window reuses the code and sends nothing more.
    const again = await openOrReuseChallenge(client, opts(db));
    check("a reload REUSES the live code", again.status === "reused", JSON.stringify(again));
    check("and sends no second mail", deliveries.length === 1, `deliveries=${deliveries.length}`);
    check("the countdown keeps the server's remaining time",
      (again.expiresInSeconds ?? 0) > 0 && (again.expiresInSeconds ?? 0) <= SETTINGS.codeTtlSeconds);

    // Resend inside the cooldown is refused.
    const early = await openOrReuseChallenge(client, opts(db, true));
    check("resend inside the cooldown is refused", early.status === "cooldown", JSON.stringify(early));
    check("and still no second mail", deliveries.length === 1);

    // Past the cooldown, a resend issues a NEW code and kills the old one.
    db.now += (SETTINGS.resendSeconds + 1) * 1000;
    const resent = await openOrReuseChallenge(client, opts(db, true));
    check("past the cooldown a resend sends", resent.status === "sent", JSON.stringify(resent));
    check("that is a second mail", deliveries.length === 2);
    const secondCode = codeFromLastMail()!;
    check("the new code differs from the old", secondCode !== firstCode);

    const stale = await verifyChallengeCode(client, {
      userId: opts(db).userId, deviceHash: opts(db).deviceHash, ipHash: opts(db).ipHash,
      label: opts(db).label, code: firstCode,
    });
    check("the PREVIOUS code no longer works", stale.ok === false, JSON.stringify(stale));

    const wrong = await verifyChallengeCode(client, {
      userId: opts(db).userId, deviceHash: opts(db).deviceHash, ipHash: opts(db).ipHash,
      label: opts(db).label, code: secondCode === "000000" ? "111111" : "000000",
    });
    check("a wrong code is rejected", wrong.ok === false);

    const good = await verifyChallengeCode(client, {
      userId: opts(db).userId, deviceHash: opts(db).deviceHash, ipHash: opts(db).ipHash,
      label: opts(db).label, code: secondCode,
    });
    check("the current code is accepted", good.ok === true, JSON.stringify(good));
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\nF. AN EXPIRED CODE IS REFUSED");
  {
    resetMailer();
    __smtpConfigured();
    const db = new FakeDb();
    db.settings.set("login_security_dispatch", { hash: "0".repeat(64) });
    const client = db.client() as unknown as Client;
    await openOrReuseChallenge(client, opts(db));
    const code = codeFromLastMail()!;
    db.now += (SETTINGS.codeTtlSeconds + 1) * 1000;
    const late = await verifyChallengeCode(client, {
      userId: opts(db).userId, deviceHash: opts(db).deviceHash, ipHash: opts(db).ipHash,
      label: opts(db).label, code,
    });
    check(`a code older than ${SETTINGS.codeTtlSeconds}s is refused`, late.ok === false, JSON.stringify(late));
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\nG. THE RESOLVER CANNOT QUIETLY FORK AGAIN");
  {
    // The defect was a SECOND, private key resolver in login-security.ts that
    // never learned the new variable name. Reading the source is the only way
    // to assert that it has not come back, because a fork that happens to
    // agree today would pass every behavioural test above.
    const fs = await import("fs");
    const src = fs.readFileSync("lib/server/login-security.ts", "utf8");
    check("login-security derives its token from serverSecret()",
      /loginSecurityToken[\s\S]{0,300}serverSecret\(\)/.test(src));

    // SCOPED TO THE TOKEN, deliberately. `ipSecret()` in the same file reads
    // LOGIN_IP_HASH_SECRET and falls back to APP_ENCRYPTION_KEY for the IP
    // HMAC — a different secret for a different job, and it must stay. The
    // defect was a second resolver for the PROOF-OF-SERVER value, so that is
    // what this asserts: between the token comment and the end of
    // loginSecurityToken(), no environment variable is read at all.
    const tokenRegion = src.slice(
      src.indexOf("── the dispatch token"),
      src.indexOf("/* ── the OTP"),
    );
    check("the token region reads no env var directly",
      tokenRegion.length > 0 && !/process\.env\./.test(tokenRegion),
      "a private resolver here is exactly what broke production on 2026-09-13");
    check("and it still resolves through the shared function",
      /serverSecret\(\)/.test(tokenRegion));

    // And the shared resolver must still accept the production variable.
    const tok = fs.readFileSync("lib/server/server-token.ts", "utf8");
    check("the shared resolver accepts GROVBASE_SERVER_KEY",
      /process\.env\.GROVBASE_SERVER_KEY/.test(tok));
  }

  console.log(failures === 0
    ? "\nAll login-security key tests passed."
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("login-security key tests crashed:", e); process.exit(1); });
