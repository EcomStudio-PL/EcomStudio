/**
 * QUICK SIGNUP + WELCOME BONUS — the logic tests.
 *
 * Pure functions and the server module's pure half, bundled like the other
 * suites (server-only stub, no network, no database). What is NOT here is the
 * claim transaction itself: that lives in Postgres and is verified against the
 * real database, because a mock of a row lock proves nothing about a row lock.
 */
import { fullNameIssue, splitFullName } from "@/lib/auth-validation";
import { readFileSync } from "node:fs";
import {
  BONUS_PLACEHOLDERS, DEFAULT_QUESTIONS, LEGACY_COMBINED_SOURCE, OTHER_VALUE,
  formatCountdown, otherDetailKey, remainingParts, remainingPhrase,
  renderPlaceholders, splitLegacyOptions, validateAnswers,
  type SurveyQuestion,
} from "@/lib/welcome-bonus";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
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



console.log("\nZ1. THE {150} THAT REACHED PRODUCTION");
{
  // Two placeholder engines ran over the same string: t() interpolates {key},
  // the copy is written in {{key}}, so t() ate the inner braces and left the
  // outer pair — "Odbierz {150} darmowych kredytów" on the real modal.
  //
  // The rule that prevents it coming back: the DEFAULT copy is fetched raw and
  // rendered by renderPlaceholders alone. Nothing may pass values to t() for
  // these keys.
  const modal = readFileSync("components/onboarding/welcome-bonus-modal.tsx", "utf8");
  check("the fallback copy is read without t()-interpolation",
    !/t\(fallbackKey,\s*[{v]/.test(modal),
    "t(fallbackKey, values) double-renders {{credits}} into {150}");
  check("renderPlaceholders is the engine that runs",
    (modal.match(/renderPlaceholders\(/g) ?? []).length >= 2);

  // And the engine itself still resolves the token it is given.
  const rendered = renderPlaceholders("Odbierz {{credits}} darmowych kredytów", { credits: 150 });
  check("{{credits}} resolves to a bare number", rendered === "Odbierz 150 darmowych kredytów", rendered);
  check("no braces survive", !/[{}]/.test(rendered), rendered);
  for (const [loc, d] of [["pl", pl], ["en", en], ["de", de]] as const) {
    const b = (d as unknown as { bonus: Record<string, string> }).bonus;
    for (const key of ["modalTitle", "cta", "successTitle"]) {
      const out = renderPlaceholders(b[key], { credits: 150, hours: 72, first_name: "Jan" });
      check(`${loc}.bonus.${key} renders clean`, !/[{}]/.test(out), out);
    }
  }
}

console.log("\nZ2. TIKTOK AND INSTAGRAM ARE TWO ANSWERS");
{
  const source = DEFAULT_QUESTIONS.find((q) => q.key === "acquisition_source")!;
  const values = source.options.map((o) => o.value);
  check("tiktok is its own option", values.includes("tiktok"));
  check("instagram is its own option", values.includes("instagram"));
  check("the combined chip is gone from the defaults", !values.includes(LEGACY_COMBINED_SOURCE));

  // A campaign saved before the split is unpacked on read …
  const legacy = splitLegacyOptions([
    { value: "google" }, { value: LEGACY_COMBINED_SOURCE }, { value: "other" },
  ]);
  check("a stored combined option becomes two",
    legacy.map((o) => o.value).join(",") === "google,tiktok,instagram,other",
    legacy.map((o) => o.value).join(","));
  check("splitting twice does not duplicate",
    splitLegacyOptions(legacy).filter((o) => o.value === "tiktok").length === 1);
  check("an already-split list is untouched",
    splitLegacyOptions([{ value: "tiktok" }, { value: "instagram" }]).length === 2);

  // … and ANSWERS already recorded against the old value keep their label, so
  // last month's analytics still read as words rather than as a raw key.
  for (const [loc, d] of [["pl", pl], ["en", en], ["de", de]] as const) {
    const opt = (d as unknown as { bonus: { opt: Record<string, Record<string, string>> } })
      .bonus.opt.acquisition_source;
    check(`${loc}: tiktok has a label`, typeof opt.tiktok === "string" && opt.tiktok !== "");
    check(`${loc}: instagram has a label`, typeof opt.instagram === "string" && opt.instagram !== "");
    check(`${loc}: the legacy answer still has a label`,
      typeof opt[LEGACY_COMBINED_SOURCE] === "string" && opt[LEGACY_COMBINED_SOURCE] !== "");
  }
}

console.log("\nZ3. \"INNE\" MUST SAY WHAT");
{
  const questions: SurveyQuestion[] = [
    { key: "acquisition_source", type: "SINGLE_SELECT", required: true, enabled: true,
      options: [{ value: "google" }, { value: OTHER_VALUE }] },
    { key: "sales_channels", type: "MULTI_SELECT", required: false, enabled: true,
      options: [{ value: "allegro" }, { value: OTHER_VALUE }] },
  ];

  // Required question answered "Inne", box empty → refused, and named.
  const empty = validateAnswers(questions, { acquisition_source: [OTHER_VALUE] }, {});
  check("an empty detail is refused", empty.ok === false);
  check("the refusal names the field",
    empty.ok === false && empty.missing === otherDetailKey("acquisition_source"),
    empty.ok === false ? empty.missing : "");
  check("whitespace is not an answer",
    validateAnswers(questions, { acquisition_source: [OTHER_VALUE] }, { acquisition_source: "   " }).ok === false);

  // Filled in → stored under its OWN key, so the option column stays groupable.
  const filled = validateAnswers(questions, { acquisition_source: [OTHER_VALUE] },
    { acquisition_source: "podcast o e-commerce" });
  check("a filled detail passes", filled.ok === true);
  check("the option column keeps only the option",
    filled.ok === true && filled.clean.acquisition_source.join() === OTHER_VALUE);
  check("the sentence lands in its own row",
    filled.ok === true && filled.clean.acquisition_source_other?.[0] === "podcast o e-commerce");

  // An OPTIONAL question stays optional …
  check("an optional question may still be skipped entirely",
    validateAnswers(questions, { acquisition_source: ["google"] }, {}).ok === true);
  // … but once it is answered "Inne", the box is required there too.
  check("an optional question answered Inne still needs the detail",
    validateAnswers(questions,
      { acquisition_source: ["google"], sales_channels: [OTHER_VALUE] }, {}).ok === false);

  // A detail for a question that was NOT answered "Inne" is not smuggled in.
  const stray = validateAnswers(questions, { acquisition_source: ["google"] },
    { acquisition_source: "ignore me" });
  check("a stray detail is dropped",
    stray.ok === true && stray.clean.acquisition_source_other === undefined);

  // Long text is cut to what the column accepts rather than failing the claim.
  const long = validateAnswers(questions, { acquisition_source: [OTHER_VALUE] },
    { acquisition_source: "x".repeat(400) });
  check("a very long sentence is trimmed, not rejected",
    long.ok === true && long.clean.acquisition_source_other[0].length === 120);

  for (const [loc, d] of [["pl", pl], ["en", en], ["de", de]] as const) {
    const b = (d as unknown as { bonus: { otherLabel: Record<string, string>; errMissingDetail: string } }).bonus;
    check(`${loc}: every question has an "Inne" prompt`,
      DEFAULT_QUESTIONS.every((q) => typeof b.otherLabel[q.key] === "string" && b.otherLabel[q.key] !== ""));
    check(`${loc}: the missing-detail error has words`,
      typeof b.errMissingDetail === "string" && b.errMissingDetail !== "");
  }
}

console.log(failures === 0 ? "\nAll onboarding tests passed.\n" : `\n${failures} onboarding test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
