/**
 * THE RESEND BUTTON — the two rules that decide whether a phone can send five
 * e-mails for one intent, exercised directly.
 *
 * What is NOT here: Supabase, SMTP, or the challenge row. Those are the
 * server's, and the server refuses a second code while one is alive
 * (login_challenge_start → status "live"). What this file proves is the part
 * that used to be wrong: the CLIENT sending more than once, and the button
 * telling the truth about what it is doing.
 */
import { createGate } from "@/lib/single-flight";
import { mmss, resendView } from "@/lib/auth/resend";
import { LOGIN_SECURITY_DEFAULTS } from "@/lib/server/login-security";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { makeT } from "@/lib/i18n/t";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 200)}`}`);
  if (!cond) failures += 1;
}

console.log("\nA. FIVE TAPS, ONE REQUEST");
{
  const gate = createGate();
  let sends = 0;
  let release: (() => void) | null = null;
  const send = () => gate.run(async () => {
    sends += 1;
    await new Promise<void>((r) => { release = r; });
  });

  // Five taps in one tick, exactly as a thumb produces them.
  const taps = [send(), send(), send(), send(), send()];
  check("the request went out ONCE", sends === 1, `sends=${sends}`);
  check("the gate is closed while the send is in flight", gate.busy);

  release!();
  const ran = await Promise.all(taps);
  check("only the first tap reports that it ran",
    ran.filter(Boolean).length === 1, JSON.stringify(ran));
  check("the gate reopens when the send settles", !gate.busy);

  // ...and the NEXT tap, after the first finished, is a real send again.
  const second = send();
  check("a later tap sends again", sends === 2, `sends=${sends}`);
  release!();
  await second;
}

console.log("\nB. A FAILED SEND DOES NOT LOCK THE BUTTON FOREVER");
{
  const gate = createGate();
  let sends = 0;
  const boom = () => gate.run(async () => { sends += 1; throw new Error("smtp down"); });
  let threw = false;
  await boom().catch(() => { threw = true; });
  check("the failure is not swallowed by the gate", threw);
  check("the gate reopened after the failure", !gate.busy);
  await gate.run(async () => { sends += 1; });
  check("the user can try again", sends === 2, `sends=${sends}`);
}

console.log("\nC. WHAT THE BUTTON SAYS");
{
  const t = makeT(pl as Record<string, unknown>);

  const idle = resendView({ sending: false, expired: false, cooldown: 0 });
  check("idle: enabled, offers a send", !idle.disabled && !idle.loading
    && t(idle.labelKey) === "Wyślij kod ponownie", t(idle.labelKey));

  const sending = resendView({ sending: true, expired: false, cooldown: 0 });
  check("sending: disabled", sending.disabled);
  check("sending: shows a spinner", sending.loading);
  check("sending: says so", t(sending.labelKey) === "Wysyłanie…", t(sending.labelKey));

  // 114 s, not 59: the wait is now the live code's own remaining lifetime, and
  // the screen shows the SAME number on both lines.
  const cooling = resendView({ sending: false, expired: false, cooldown: 114 });
  check("a live code: disabled", cooling.disabled);
  check("a live code: labelled with mm:ss",
    t(cooling.labelKey, { time: cooling.time! }) === "Wyślij kod ponownie za 01:54",
    t(cooling.labelKey, { time: cooling.time! }));
  check("and it reads exactly like the expiry line, because it is the same clock",
    t("security.expiresIn", { time: mmss(114) }) === "Kod wygaśnie za 01:54"
    && cooling.time === mmss(114), cooling.time);
  check("a live code: no spinner", !cooling.loading);

  // Expired wins over a leftover wait. In the app the two cannot disagree
  // (cooldown is derived from the same deadline), but the priority order is
  // what stops a stale number from disabling the only way forward.
  const expired = resendView({ sending: false, expired: true, cooldown: 45 });
  check("an EXPIRED code can be replaced even if a stale wait is passed in", !expired.disabled);
  check("...and the label changes to a new code",
    t(expired.labelKey) === "Wyślij nowy kod", t(expired.labelKey));

  // A send in flight wins over everything, including an expired code — one
  // request is one request.
  check("sending beats expired", resendView({ sending: true, expired: true, cooldown: 0 }).disabled);
}

console.log("\nD. mm:ss");
{
  check("60 → 01:00", mmss(60) === "01:00", mmss(60));
  check("59 → 00:59", mmss(59) === "00:59", mmss(59));
  check("9 → 00:09", mmss(9) === "00:09", mmss(9));
  check("0 → 00:00", mmss(0) === "00:00", mmss(0));
  check("a negative clock never renders as a minus", mmss(-4) === "00:00", mmss(-4));
  check("120 → 02:00", mmss(120) === "02:00", mmss(120));
}

console.log("\nE1. THE CLOCKS ARE DEADLINES, NOT COUNTERS");
{
  const ui = await import("node:fs").then((fs) =>
    fs.readFileSync("components/auth/security-check.tsx", "utf8"));

  check("the clock is a wall-clock instant",
    /const \[expiresAt, setExpiresAt\] = useState<number \| null>/.test(ui));
  check("nothing decrements a counter any more",
    !/setCooldown\(\(n\) =>/.test(ui) && !/n - 1/.test(ui));
  check("the time left is read from the clock on every render",
    /Math\.ceil\(\(at - now\) \/ 1000\)/.test(ui));
  check("coming back to the tab re-reads the clock",
    /visibilitychange/.test(ui) && /\"focus\"/.test(ui) && /pageshow/.test(ui));
  check("a send in flight always releases the button",
    /finally \{\s*setSending\(false\);/.test(ui));
  check("a failed REQUEST is not reported as a wrong code",
    /if \(!res\) \{ setError\(t\("security\.serverError"\)\); return; \}/.test(ui));
  check("the verify button says what it is doing",
    /t\("security\.verifying"\)/.test(ui));
  check("a full code submits once, and only when nothing is in flight",
    /if \(clean\.length === 6 && !busy\) void submit\(clean\);/.test(ui));
}

console.log("\nE. COOLDOWN *IS* THE CODE LIFETIME");
{
  /*
    THIS SECTION USED TO ASSERT THE OPPOSITE, and it is rewritten rather than
    deleted so the reversal is on the record.

    It was headed "COOLDOWN ≠ CODE LIFETIME" and pinned exactly what has now
    been retired: two settings (59 s against 120 s), neither derived from the
    other, with a comment promising to fail "if a future edit ever ties them
    together". That was a faithful guard for the old product decision — a
    person could ask for a second code from 00:59 while the first still
    verified. The decision changed deliberately (migration 0111): one code at
    a time, and a replacement only once it has expired. So the guard now pins
    the rule that replaced it, and the old assertions are quoted here so
    nobody reading a green run mistakes this for the behaviour it used to
    describe.
  */
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("lib/server/login-security.ts", "utf8"));
  check("the code's TTL is what the challenge is opened with",
    /p_ttl_seconds:\s*opts\.settings\.codeTtlSeconds/.test(src));
  // PROPERTY SHAPES, NOT THE WORD. A bare /resendSeconds/ over the file also
  // matches the comment that explains why the setting was removed — prose
  // failing a guard that the code passes is how a guard loses its meaning.
  // What must not come back is a FIELD: `resendSeconds:` (declared) or
  // `.resendSeconds` (read).
  check("there is no separate resend window left to disagree with it",
    !/resendSeconds\s*:/.test(src) && !/\.resendSeconds\b/.test(src),
    "a second setting is what let two clocks drift apart");
  check("the default code life is still 120 s", /codeTtlSeconds:\s*120/.test(src));
  check("and the code's own clock starts at 02:00",
    mmss(LOGIN_SECURITY_DEFAULTS.codeTtlSeconds) === "02:00");
  check("the settings type no longer carries a resend knob",
    !("resendSeconds" in LOGIN_SECURITY_DEFAULTS));
  check("a live code is refused a replacement, by the DATABASE",
    /status.*live[\s\S]{0,400}?expires_in_seconds/.test(
      await import("node:fs").then((fs) =>
        fs.readFileSync("supabase/migrations/0111_one_live_code_at_a_time.sql", "utf8"))));
  check("and the refusal is serialised, so two taps cannot both pass it",
    /pg_advisory_xact_lock/.test(await import("node:fs").then((fs) =>
      fs.readFileSync("supabase/migrations/0111_one_live_code_at_a_time.sql", "utf8"))));
  check("a new code retires the live one in the DATABASE, not in the UI",
    /update public\.login_security_challenges[\s\S]{0,200}?set used_at = now\(\)/
      .test(await import("node:fs").then((fs) =>
        fs.readFileSync("supabase/migrations/0057_login_security.sql", "utf8"))));

  const ui = await import("node:fs").then((fs) =>
    fs.readFileSync("components/auth/security-check.tsx", "utf8"));
  // The DEADLINE'S SOURCE, not one spelling of it. This used to pin the exact
  // literal `setExpiresAt(Date.now() + res.expiresInSeconds * 1000)`, which
  // broke the moment the assignment grew a ternary — while the property it
  // cared about was still true. What matters is that every deadline is built
  // from the server's number and from nothing the client invented.
  {
    const assignments = [...ui.matchAll(/setExpiresAt\(([\s\S]*?)\);/g)].map((m) => m[1]!);
    /*
      Three shapes are legitimate, and only three:
        · derived from the server's own number (expiresInSeconds / waitSeconds)
        · exactly `Date.now()` — the server answered {reason:'expired'} on a
          verify, so the deadline IS now; zero is a verdict, not an invention
        · `null` — unknown, which unlocks the field rather than locking it
      Anything else is the client deciding how long a code lives.
    */
    check("every deadline is computed from the SERVER's expires_at",
      assignments.length > 0
      && assignments.every((a) =>
        /res\.(expiresInSeconds|waitSeconds)/.test(a)
        || /^\s*Date\.now\(\)\s*$/.test(a)
        || /^\s*null\s*$/.test(a)),
      JSON.stringify(assignments.map((a) => a.replace(/\s+/g, " ").slice(0, 70))));
    check("and none of them invents a duration in the client",
      !assignments.some((a) => /\b(30|59|60|120|300)\b/.test(a)),
      "a hardcoded number here is a second clock by another name");
  }
  check("there is no second deadline in the component at all",
    !/resendAt/.test(ui) && !/resendWindow/.test(ui),
    "two useState deadlines are two clocks, and they drifted");
  check("the resend countdown is DERIVED from the expiry, not stored",
    /const cooldown = remaining \?\? 0;/.test(ui));
  /*
    THE STUCK-STATE GUARD. The deadline a successful resend replaces is in the
    PAST — that is precisely why the server allowed the resend. So a branch
    that skips the update leaves `expired` true: the input stays disabled and
    the person cannot type the code that has just landed in their inbox. The
    assignment must be unconditional, degrading to null (no countdown, field
    unlocked) rather than to a stale deadline (field locked).
  */
  check("a successful resend never leaves the OLD, already-passed deadline",
    /res\.status === "sent"[\s\S]{0,1200}?setExpiresAt\(\s*\n?\s*typeof res\.expiresInSeconds === "number" && res\.expiresInSeconds > 0/.test(ui)
    && /\?\s*Date\.now\(\) \+ res\.expiresInSeconds \* 1000\s*\n?\s*:\s*null,/.test(ui),
    "keeping a past deadline locks the input against the code that just arrived");
  check("a server refusal adopts the server's own remaining time",
    /res\.status === "cooldown"[\s\S]{0,300}?setExpiresAt\(Date\.now\(\) \+ res\.waitSeconds \* 1000\)/.test(ui));
  check("and it tells the person why, instead of silently re-arming",
    /security\.stillValid/.test(ui));
  check("every send goes through the gate",
    /await sendGate\.run\(/.test(ui) && (ui.match(/resendCodeAction\(\)/g) ?? []).length === 1);
  check("a verify goes through its own gate",
    /await verifyGate\.run\(/.test(ui) && (ui.match(/verifyCodeAction\(/g) ?? []).length === 1);
}

console.log("\nF. THE WORDS EXIST IN ALL THREE LANGUAGES");
{
  for (const [name, dict] of [["pl", pl], ["en", en], ["de", de]] as const) {
    const t = makeT(dict as Record<string, unknown>);
    for (const key of ["security.sending", "security.resendFailed", "security.resent",
      "security.resend", "security.newCode"]) {
      // A missing key comes back humanized ("Resend failed"), so the test is
      // that the text is real prose, not that it merely differs from the key.
      const value = t(key);
      check(`${name}: ${key} is translated`,
        value !== key && !/^[a-z][a-zA-Z]*\.[a-zA-Z]/.test(value) && value.length > 4, value);
    }
    const cooldownLabel = t("security.resendIn", { time: "00:59" });
    check(`${name}: the cooldown label interpolates the clock`,
      cooldownLabel.includes("00:59"), cooldownLabel);
  }
}

console.log(failures === 0 ? "\nAll resend tests passed.\n" : `\n${failures} resend test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
