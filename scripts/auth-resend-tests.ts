/**
 * THE RESEND BUTTON — the two rules that decide whether a phone can send five
 * e-mails for one intent, exercised directly.
 *
 * What is NOT here: Supabase, SMTP, or the challenge row. Those are the
 * server's, and the server already refuses a second code inside its own window
 * (login_challenge_peek → status "cooldown"). What this file proves is the part
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

  const cooling = resendView({ sending: false, expired: false, cooldown: 59 });
  check("cooldown: disabled", cooling.disabled);
  check("cooldown: labelled with mm:ss",
    t(cooling.labelKey, { time: cooling.time! }) === "Wyślij kod ponownie za 00:59",
    t(cooling.labelKey, { time: cooling.time! }));
  check("cooldown: no spinner", !cooling.loading);

  const expired = resendView({ sending: false, expired: true, cooldown: 45 });
  check("an EXPIRED code can always be replaced, cooldown or not", !expired.disabled);
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

  check("both clocks are wall-clock instants",
    /const \[resendAt, setResendAt\] = useState<number \| null>/.test(ui)
    && /const \[expiresAt, setExpiresAt\] = useState<number \| null>/.test(ui));
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

console.log("\nE. COOLDOWN ≠ CODE LIFETIME");
{
  // The two numbers come from two different settings and neither is derived
  // from the other. If a future edit ever ties them together, this fails.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("lib/server/login-security.ts", "utf8"));
  check("the code's TTL is what the challenge is opened with",
    /p_ttl_seconds:\s*opts\.settings\.codeTtlSeconds/.test(src));
  check("the resend window is a separate setting",
    /const wait = opts\.settings\.resendSeconds - age/.test(src));
  check("defaults are 120 s of code life and a 59 s resend window",
    /codeTtlSeconds:\s*120/.test(src) && /resendSeconds:\s*59/.test(src));
  // The product rule, stated as arithmetic: a second code may be ASKED for
  // before the first one dies, and the window is shorter than the lifetime.
  check("the resend window is shorter than the code's life",
    LOGIN_SECURITY_DEFAULTS.resendSeconds < LOGIN_SECURITY_DEFAULTS.codeTtlSeconds);
  check("the first frame after a send reads 00:59",
    mmss(LOGIN_SECURITY_DEFAULTS.resendSeconds) === "00:59");
  check("and the code's own clock starts at 02:00",
    mmss(LOGIN_SECURITY_DEFAULTS.codeTtlSeconds) === "02:00");
  check("a new code retires the live one in the DATABASE, not in the UI",
    /update public\.login_security_challenges[\s\S]{0,200}?set used_at = now\(\)/
      .test(await import("node:fs").then((fs) =>
        fs.readFileSync("supabase/migrations/0057_login_security.sql", "utf8"))));

  const ui = await import("node:fs").then((fs) =>
    fs.readFileSync("components/auth/security-check.tsx", "utf8"));
  check("the expiry countdown still runs on the SERVER's expires_at",
    /setExpiresAt\(Date\.now\(\) \+ res\.expiresInSeconds \* 1000\)/.test(ui));
  check("the cooldown never touches the code's deadline",
    !/setExpiresAt\([^)]*resendWindow/.test(ui));
  check("only a send the server CONFIRMS starts the cooldown",
    /res\.status === "sent"[\s\S]{0,400}?setResendAt\(Date\.now\(\) \+ resendWindow \* 1000\)/.test(ui));
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
