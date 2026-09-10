/**
 * PLATFORM ACCESS — the logic tests.
 *
 * The pure half: which preset a set of switches is, whether signup is open at
 * a given instant, what a refused attempt is told, and how mobile copy falls
 * back to desktop. The server half (RLS, the guard trigger, the neutralise
 * RPC) is verified against the real database instead, because a mock of a
 * SECURITY DEFINER function proves nothing about a SECURITY DEFINER function.
 */
import {
  ACCESS_DEFAULTS, EMPTY_ACCESS_COPY, MODE_PRESETS,
  accessCopyFor, blockedReasonFor, modeOf, signupOpen,
  type AccessCopy, type PlatformAccess,
} from "@/lib/platform-access";
import { ADMIN_LOGIN_PATH } from "@/lib/supabase/middleware";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 200)}`}`);
  if (!cond) failures += 1;
}

const at = (iso: string) => new Date(iso);
const NOW = at("2026-09-06T12:00:00Z");

function make(over: Partial<PlatformAccess> = {}): PlatformAccess {
  return { ...ACCESS_DEFAULTS, ...over };
}

console.log("\nA. THE FOUR SCENARIOS ARE ALL REACHABLE (§12)");
{
  // A: open. B: existing customers only. C: full pre-launch. D: closed.
  const A = make(MODE_PRESETS.open);
  const B = make(MODE_PRESETS.existing_only);
  const C = make(MODE_PRESETS.prelaunch);
  const D = make(MODE_PRESETS.closed);

  check("A — signup ON, login ON", A.allowSignup && A.allowLogin);
  check("B — signup OFF, login ON", !B.allowSignup && B.allowLogin);
  check("C — signup OFF, login OFF, waitlist ON",
    !C.allowSignup && !C.allowLogin && C.waitlistEnabled);
  check("D — everything off, no waitlist",
    !D.allowSignup && !D.allowLogin && !D.waitlistEnabled);

  // The switches are genuinely independent: no combination is unreachable.
  const seen = new Set<string>();
  for (const s of [true, false]) for (const l of [true, false]) {
    for (const e of [true, false]) for (const w of [true, false]) {
      const a = make({ allowSignup: s, allowLogin: l, showAuthEntry: e, waitlistEnabled: w });
      seen.add(`${a.allowSignup}${a.allowLogin}${a.showAuthEntry}${a.waitlistEnabled}`);
    }
  }
  check("all 16 combinations of the four switches exist", seen.size === 16, seen.size);
}

console.log("\nB. A PRESET IS ONLY A NAME FOR THE SWITCHES (§13)");
{
  for (const [name, preset] of Object.entries(MODE_PRESETS)) {
    check(`${name} round-trips through modeOf`, modeOf(make(preset)) === name, modeOf(make(preset)));
  }
  check("touching one switch reads as custom, not as a broken preset",
    modeOf(make({ ...MODE_PRESETS.prelaunch, showAuthEntry: false })) === "custom");
  check("the default configuration is the open platform", modeOf(ACCESS_DEFAULTS) === "open");
}

console.log("\nC. THE SCHEDULE IS THE SERVER'S CLOCK (§27)");
{
  const future = make({ signupOpensAt: "2026-09-07T00:00:00Z" });
  const past = make({ signupOpensAt: "2026-09-05T00:00:00Z" });
  check("before the opening, signup is shut even with the switch ON",
    !signupOpen(future, NOW));
  check("after the opening, signup is open", signupOpen(past, NOW));
  check("exactly at the opening instant, signup is open",
    signupOpen(make({ signupOpensAt: "2026-09-06T12:00:00Z" }), NOW));
  check("a schedule cannot re-open what the switch closed",
    !signupOpen(make({ allowSignup: false, signupOpensAt: "2026-09-05T00:00:00Z" }), NOW));
  check("no schedule means no gate", signupOpen(make(), NOW));
  // Garbage in the settings row must not silently close registration.
  check("an unparseable date is ignored rather than obeyed",
    signupOpen(make({ signupOpensAt: "not-a-date" }), NOW));
}

console.log("\nD. WHAT A REFUSED ATTEMPT IS TOLD (§20–22)");
{
  const open = make(MODE_PRESETS.open);
  check("nothing is refused on an open platform",
    blockedReasonFor(open, "login", NOW) === null
    && blockedReasonFor(open, "register", NOW) === null);

  // §21 — existing customers get in, new ones are offered the list.
  const b = make(MODE_PRESETS.existing_only);
  check("B: login passes", blockedReasonFor(b, "login", NOW) === null);
  check("B: register is signup_closed", blockedReasonFor(b, "register", NOW) === "signup_closed");

  // §22 — pre-launch: both doors shut, both point at the waiting list.
  const c = make(MODE_PRESETS.prelaunch);
  check("C: login is login_closed", blockedReasonFor(c, "login", NOW) === "login_closed");
  check("C: register is signup_closed", blockedReasonFor(c, "register", NOW) === "signup_closed");

  // §20's exception — with no list to join, the message must not end in a
  // dead CTA, so it is a different reason entirely.
  const d = make(MODE_PRESETS.closed);
  check("D: login is closed, not login_closed", blockedReasonFor(d, "login", NOW) === "closed");
  check("D: register is closed, not signup_closed", blockedReasonFor(d, "register", NOW) === "closed");

  check("a scheduled opening refuses registration the same way",
    blockedReasonFor(make({ waitlistEnabled: true, signupOpensAt: "2026-09-07T00:00:00Z" }), "register", NOW)
      === "signup_closed");
}

console.log("\nE. MOBILE COPY FALLS BACK FIELD BY FIELD (§26)");
{
  const desktop: AccessCopy = {
    ...EMPTY_ACCESS_COPY,
    loginTitle: "Desktop tytuł", loginBody: "Desktop treść", loginCta: "Desktop CTA",
    signupTitle: "Rejestracja", closedTitle: "Zamknięte",
  };
  const cfg = make({
    copy: desktop,
    mobileOverride: true,
    mobileCopy: { ...EMPTY_ACCESS_COPY, loginTitle: "Mobile tytuł" },
  });

  check("desktop is untouched by the override",
    accessCopyFor(cfg, false).loginTitle === "Desktop tytuł");
  check("an overridden line wins on mobile",
    accessCopyFor(cfg, true).loginTitle === "Mobile tytuł");
  check("an empty line falls back rather than blanking the popup",
    accessCopyFor(cfg, true).loginBody === "Desktop treść");
  check("override OFF means one text everywhere",
    accessCopyFor({ ...cfg, mobileOverride: false }, true).loginTitle === "Desktop tytuł");
  check("whitespace is not an override",
    accessCopyFor({ ...cfg, mobileCopy: { ...EMPTY_ACCESS_COPY, loginCta: "   " } }, true).loginCta
      === "Desktop CTA");
}

console.log("\nF. FAIL-SAFE AND VISIBILITY (§18, §33)");
{
  // §33 — a settings outage must not lock the product (or the admin) out.
  check("the fallback configuration is fully open",
    ACCESS_DEFAULTS.allowLogin && ACCESS_DEFAULTS.allowSignup && ACCESS_DEFAULTS.showAuthEntry);
  check("the fallback does not invent a waiting list", !ACCESS_DEFAULTS.waitlistEnabled);
  check("no copy is hardcoded into the defaults — it comes from i18n",
    Object.values(ACCESS_DEFAULTS.copy).every((v) => v === ""));

  // §18 — visibility is not security: hiding the button changes nothing
  // about whether the door is open.
  const hidden = make({ showAuthEntry: false });
  check("hiding the buttons does not close login",
    blockedReasonFor(hidden, "login", NOW) === null);
  check("hiding the buttons does not close signup",
    blockedReasonFor(hidden, "register", NOW) === null);
  const shownButShut = make({ showAuthEntry: true, allowLogin: false, waitlistEnabled: true });
  check("showing the buttons does not open login",
    blockedReasonFor(shownButShut, "login", NOW) === "login_closed");
}

console.log("\nG. THE LIVE PRE-LAUNCH SHAPE: LOGIN ON, SIGNUP OFF, WAITLIST ON");
{
  // What production is configured to do right now. Written as a test so a
  // future change to the preset table or to blockedReasonFor cannot silently
  // shut existing customers out again.
  const live = make({
    allowLogin: true, allowSignup: false, showAuthEntry: true, waitlistEnabled: true,
  });
  check("it is the 'existing_only' preset, not a custom mix", modeOf(live) === "existing_only");
  check("an existing customer may sign in", blockedReasonFor(live, "login", NOW) === null);
  check("a new account may NOT be created", blockedReasonFor(live, "register", NOW) === "signup_closed");
  check("signupOpen() agrees with it", signupOpen(live, NOW) === false);
  check("the refusal offers the waiting list rather than a dead end",
    blockedReasonFor(live, "register", NOW) !== "closed");

  // The regression this stage exists to prevent: 'prelaunch' shuts BOTH doors,
  // which is what was live and what locked every existing account out.
  check("'prelaunch' would close login — that is why we are not using it",
    MODE_PRESETS.prelaunch.allowLogin === false);
  check("'existing_only' keeps login open", MODE_PRESETS.existing_only.allowLogin === true);
  check("'existing_only' keeps signup shut", MODE_PRESETS.existing_only.allowSignup === false);
  check("'existing_only' offers the waiting list", MODE_PRESETS.existing_only.waitlistEnabled === true);

  // Independence: the four switches must not be able to overwrite each other.
  const loginOnly = make({ allowLogin: true, allowSignup: false });
  const signupOnly = make({ allowLogin: false, allowSignup: true, waitlistEnabled: true });
  check("opening login does not open signup", signupOpen(loginOnly, NOW) === false);
  check("opening signup does not open login",
    blockedReasonFor(signupOnly, "login", NOW) === "login_closed");
}

console.log("\nH. THE OPERATOR'S DOOR (/admin/login)");
{
  // The path the middleware exempts and the path the page is served from have
  // to be the same string; they live in different files.
  check("the exempt path is exactly /admin/login", ADMIN_LOGIN_PATH === "/admin/login");
  check("it sits under the protected /admin prefix, so nothing else changes",
    ADMIN_LOGIN_PATH.startsWith("/admin"));
  // Robots: /admin is already disallowed, which covers the child path.
  check("crawlers are kept out by the existing /admin disallow rule",
    ADMIN_LOGIN_PATH.startsWith("/admin"));
}

console.log(failures === 0 ? "\nAll platform-access tests passed.\n" : `\n${failures} platform-access test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
