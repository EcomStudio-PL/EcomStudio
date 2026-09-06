/**
 * QUICK SIGNUP + WELCOME BONUS — the logic tests.
 *
 * Pure functions and the server module's pure half, bundled like the other
 * suites (server-only stub, no network, no database). What is NOT here is the
 * claim transaction itself: that lives in Postgres and is verified against the
 * real database, because a mock of a row lock proves nothing about a row lock.
 */
import { fullNameIssue, splitFullName } from "@/lib/auth-validation";
import {
  BONUS_PLACEHOLDERS, DEFAULT_QUESTIONS, formatCountdown, remainingParts,
  remainingPhrase, renderPlaceholders, validateAnswers,
  type SurveyQuestion,
} from "@/lib/welcome-bonus";
import { copyFor, toView, type OfferRow } from "@/lib/server/welcome-bonus";
import { BONUS_DEFAULTS, EMPTY_COPY } from "@/lib/welcome-bonus";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 200)}`}`);
  if (!cond) failures += 1;
}

console.log("\nA. ONE NAME FIELD, TWO COLUMNS");
{
  const cases: [string, string, string][] = [
    ["Jan Kowalski", "Jan", "Kowalski"],
    // Multi-part surnames survive: the naive split(" ")[1] would drop half.
    ["Anna Maria Nowak-Kowalska", "Anna", "Maria Nowak-Kowalska"],
    ["Piet van der Berg", "Piet", "van der Berg"],
    ["  Ewa   Zając  ", "Ewa", "Zając"],
    ["Cher", "Cher", ""],
    ["", "", ""],
  ];
  for (const [input, first, last] of cases) {
    const got = splitFullName(input);
    check(`"${input}" → "${first}" / "${last}"`,
      got.firstName === first && got.lastName === last, `${got.firstName} / ${got.lastName}`);
  }
  check("an empty name is rejected", fullNameIssue("   ") === "required");
  check("a single letter is rejected", fullNameIssue("J") === "name_short");
  check("a real name passes", fullNameIssue("Jan Kowalski") === null);
  check("a one-word name passes", fullNameIssue("Cher") === null);
}

console.log("\nB. SURVEY VALIDATION — the server decides what counts as answered");
{
  const questions = DEFAULT_QUESTIONS.map((q) => ({ ...q, options: [...q.options] }));
  const required = questions[0]!.key;

  const missing = validateAnswers(questions, {});
  check("a required question left blank blocks the claim",
    missing.ok === false && missing.missing === required, JSON.stringify(missing));

  const ok = validateAnswers(questions, { [required]: ["google"] });
  check("answering the required question is enough", ok.ok === true);

  // An option that is not on the list cannot be smuggled into the profile.
  const forged = validateAnswers(questions, { [required]: ["google", "'; drop table--"] });
  check("unknown option values are dropped, not stored",
    forged.ok === true && forged.ok && JSON.stringify(forged.clean[required]) === JSON.stringify(["google"]),
    forged.ok && JSON.stringify(forged.clean));

  // A single-select cannot become a multi-select by sending an array.
  const many = validateAnswers(questions, { [required]: ["google", "youtube", "facebook"] });
  check("SINGLE_SELECT keeps exactly one answer",
    many.ok === true && many.ok && many.clean[required]!.length === 1, many.ok && JSON.stringify(many.clean));

  // An answer to a question that is switched off never reaches the database.
  const off: SurveyQuestion[] = questions.map((q, i) => (i === 1 ? { ...q, enabled: false } : q));
  const disabled = validateAnswers(off, { [required]: ["google"], [questions[1]!.key]: ["allegro"] });
  check("answers to disabled questions are ignored",
    disabled.ok === true && disabled.ok && !(questions[1]!.key in disabled.clean));

  const multi = validateAnswers(questions, {
    [required]: ["google"], [questions[1]!.key]: ["allegro", "etsy", "shopify"],
  });
  check("MULTI_SELECT keeps every valid pick",
    multi.ok === true && multi.ok && multi.clean[questions[1]!.key]!.length === 3);
}

console.log("\nC. PLACEHOLDERS — a whitelist, not a template engine");
{
  const values = { credits: 150, hours: 72, first_name: "Jan" };
  check("known tokens resolve",
    renderPlaceholders("Odbierz {{credits}} kredytów", values) === "Odbierz 150 kredytów");
  check("several tokens in one line",
    renderPlaceholders("{{first_name}}: {{credits}} / {{hours}}h", values) === "Jan: 150 / 72h");
  check("whitespace inside the braces is tolerated",
    renderPlaceholders("{{ credits }}", values) === "150");
  // An unknown token is left visible ON PURPOSE: a typo should look like a
  // typo, not silently render someone else's data or an empty string.
  check("an unknown token is left exactly as typed",
    renderPlaceholders("{{password}} {{email}}", values) === "{{password}} {{email}}");
  check("a missing value leaves its token alone",
    renderPlaceholders("{{first_name}}", { credits: 1 }) === "{{first_name}}");
  check("nothing is executed — braces around code stay text",
    renderPlaceholders("{{constructor}} {{__proto__}}", values) === "{{constructor}} {{__proto__}}");
  check("the whitelist is the four documented tokens",
    JSON.stringify([...BONUS_PLACEHOLDERS]) === JSON.stringify(["credits", "hours", "first_name", "expires_at"]));
}

console.log("\nD. THE CLOCK IS THE SERVER'S — status and countdown");
{
  const now = new Date("2026-09-06T12:00:00Z");
  const row = (over: Partial<OfferRow>): OfferRow => ({
    id: "o1", user_id: "u1", campaign_version: 1, reward_amount: 150,
    eligible_at: "2026-09-05T12:00:00Z", expires_at: "2026-09-08T12:00:00Z",
    claimed_at: null, status: "ELIGIBLE", ...over,
  });

  const live = toView(row({}), now);
  check("an open offer reports ELIGIBLE with the real seconds left",
    live.status === "ELIGIBLE" && live.secondsLeft === 48 * 3600, live.secondsLeft);
  check("the amount comes from the OFFER, not from today's config",
    toView(row({ reward_amount: 150 }), now).amount === 150);

  const past = toView(row({ expires_at: "2026-09-06T11:59:59Z" }), now);
  check("a window that ran out is EXPIRED with zero left",
    past.status === "EXPIRED" && past.secondsLeft === 0);

  const done = toView(row({ claimed_at: "2026-09-06T10:00:00Z" }), now);
  check("a claimed offer stays CLAIMED even inside its window", done.status === "CLAIMED");

  // §8 — the same stored row read a second later gives a second less. Nothing
  // about a reload, or a device clock, can move the deadline.
  const later = toView(row({}), new Date(now.getTime() + 60_000));
  check("a refresh a minute later loses exactly a minute, never resets",
    later.secondsLeft === live.secondsLeft - 60, `${live.secondsLeft} → ${later.secondsLeft}`);

  check("countdown formats as hh:mm:ss", formatCountdown(71 * 3600 + 42 * 60 + 18) === "71:42:18");
  check("a finished countdown is 00:00:00", formatCountdown(-5) === "00:00:00");
  const parts = remainingParts(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  check("parts split into d/h/m/s", parts.d === 2 && parts.h === 3 && parts.m === 4 && parts.s === 5);
}

console.log("\nE. §55 — how long is left, in words");
{
  check(">24h reads in days", remainingPhrase(50 * 3600).key === "bonus.leftDays");
  check("<24h reads in hours and minutes", remainingPhrase(18 * 3600 + 24 * 60).key === "bonus.leftHours");
  check("<1h reads in minutes", remainingPhrase(42 * 60).key === "bonus.leftMinutes");
  check("a finished offer says so", remainingPhrase(0).key === "bonus.leftNone");
  const hours = remainingPhrase(18 * 3600 + 24 * 60);
  check("the hour phrasing carries both numbers", hours.values.h === 18 && hours.values.m === 24);
  // Never "0 min left" while the offer is technically still open.
  check("under a minute still reads as one minute", remainingPhrase(20).values.m === 1);
}

console.log("\nF. MOBILE COPY — override per FIELD, never all-or-nothing");
{
  const base = {
    ...BONUS_DEFAULTS,
    copy: { ...EMPTY_COPY, modalTitle: "Desktop title", cta: "Desktop CTA" },
    mobileCopy: { ...EMPTY_COPY, modalTitle: "Mobile title" },
  };
  check("override off → mobile reads the desktop copy",
    copyFor({ ...base, mobileOverride: false }, true).modalTitle === "Desktop title");
  const on = copyFor({ ...base, mobileOverride: true }, true);
  check("override on → the overridden field wins", on.modalTitle === "Mobile title");
  check("…and an empty override falls back rather than blanking the screen",
    on.cta === "Desktop CTA", on.cta);
  check("desktop is never affected by the mobile copy",
    copyFor({ ...base, mobileOverride: true }, false).modalTitle === "Desktop title");
}

console.log("\nG. DEFAULTS — the campaign the brief describes");
{
  check("150 credits, 72 hours, active", BONUS_DEFAULTS.amount === 150
    && BONUS_DEFAULTS.hours === 72 && BONUS_DEFAULTS.active === true);
  check("the acquisition question is the required one",
    DEFAULT_QUESTIONS[0]!.key === "acquisition_source"
    && DEFAULT_QUESTIONS[0]!.required === true
    && DEFAULT_QUESTIONS[0]!.type === "SINGLE_SELECT");
  check("everything else is optional",
    DEFAULT_QUESTIONS.slice(1).every((q) => !q.required));
  check("the three optional questions are multi-select",
    DEFAULT_QUESTIONS.slice(1).every((q) => q.type === "MULTI_SELECT"));
  check("no default copy is hardcoded into the config — it comes from i18n",
    Object.values(BONUS_DEFAULTS.copy).every((v) => v === ""));
  // §34 as a data invariant: a bonus paid for a survey needs a survey.
  check("the default survey can actually be claimed (a required question exists)",
    DEFAULT_QUESTIONS.some((q) => q.enabled && q.required));
}

console.log(failures === 0 ? "\nAll onboarding tests passed.\n" : `\n${failures} onboarding test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
