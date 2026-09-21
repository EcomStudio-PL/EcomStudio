/**
 * PLAN CAPABILITIES — SAVING A PLAN MUST NEVER BLANK THE CENNIK.
 *
 * THE REGRESSION THIS PINS. `subscription_plans.features` is a capability BAG
 * — {products: 500, workspace_members: 5, priority_queue: true} — and that is
 * what production holds on all four plans and what /plan renders. The admin
 * editor, though, flattened it into a textarea and saved back a string[]. An
 * operator opening the Pro plan to change its price, changing nothing else,
 * and pressing Save replaced the bag with an array of sentences, and the
 * pricing page silently lost every capability row for that tier.
 *
 * Nothing threw. No test failed. The page just stopped saying what you get.
 *
 * So this file asserts the write path, not the rendering:
 *
 *   A. the parser agrees on one canonical shape
 *   B. a save round-trips a real production bag unchanged
 *   C. a save that arrives with the OLD string[] shape is refused, and the
 *      stored bag survives
 *   D. the admin editor no longer contains the textarea-to-array code
 *   E. the reader and the editor use the same parser, so they cannot drift
 *   F. the i18n copy no longer describes the format that never worked
 *   G. annual billing quotes a STORED price or is not offered at all
 *
 * Run: npm run test:plancaps
 */
import { readFileSync } from "fs";
import {
  parsePlanCapabilities, writableCapabilities, capabilityNumber, capabilityFlag,
  KNOWN_NUMERIC_CAPABILITIES, KNOWN_FLAG_CAPABILITIES, UNLIMITED,
  type PlanCapabilities,
} from "../lib/plans/capabilities";
import { annualBillingAvailable, annualMonthlyCents, annualSavingPct } from "../lib/plans/pricing";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * THE FOUR ROWS PRODUCTION ACTUALLY HOLDS, read from PROD on 2026-09-21.
 * Not an illustration — these are the values the cennik renders today, and a
 * change that cannot round-trip them is a change that breaks the live page.
 */
const PROD_PLANS: Record<string, PlanCapabilities> = {
  free:    { products: 5,   workspace_members: 1 },
  starter: { products: 50,  workspace_members: 2 },
  pro:     { products: 500, workspace_members: 5, priority_queue: true },
  agency:  { products: UNLIMITED, workspace_members: UNLIMITED, priority_queue: true, operator_mode: true },
};

/** The legacy shape the editor used to send: sentences, one per textarea line. */
const LEGACY_ARRAY = ["Nielimitowane produkty", "5 miejsc w zespole", "Priorytet w kolejce"];

/**
 * THE SAVE PATH, as `savePlanFullAction` performs it — the same two lines,
 * so this test exercises the real decision rather than a description of it.
 * Returns what the column becomes, given what the form sent and what was
 * stored. `null` from `writableCapabilities` means "leave the column alone",
 * which for an UPDATE is the stored value.
 */
function saveUpdate(sent: unknown, stored: unknown): unknown {
  const next = writableCapabilities(sent, stored);
  return next === null ? stored : next;
}
function saveInsert(sent: unknown): unknown {
  return writableCapabilities(sent, null) ?? {};
}

async function main() {
  console.log("A. ONE CANONICAL SHAPE");
  {
    for (const [slug, bag] of Object.entries(PROD_PLANS)) {
      check(`${slug} parses to itself`,
        JSON.stringify(parsePlanCapabilities(bag)) === JSON.stringify(bag));
    }
    check("an array is not a capability bag",
      Object.keys(parsePlanCapabilities(LEGACY_ARRAY)).length === 0);
    check("null is not a capability bag", Object.keys(parsePlanCapabilities(null)).length === 0);
    check("a string is not a capability bag", Object.keys(parsePlanCapabilities("5")).length === 0);

    // Values that are NOT numbers or booleans are dropped rather than coerced.
    // `Number("tak")` is NaN and `Boolean("false")` is true; either would be
    // silently wrong on a page that quotes prices.
    const mixed = parsePlanCapabilities({ products: "500", ok: true, n: 3, nested: { a: 1 }, nil: null });
    check("a numeric string is dropped, not coerced", !("products" in mixed));
    check("a nested object is dropped", !("nested" in mixed));
    check("null is dropped", !("nil" in mixed));
    check("booleans and numbers survive", mixed.ok === true && mixed.n === 3);
    check("NaN and Infinity are not capabilities",
      Object.keys(parsePlanCapabilities({ a: NaN, b: Infinity })).length === 0);

    // Forwards compatibility: a capability can exist in the database before
    // any screen renders it. Pruning here would make deploy order destructive.
    const unknownKey = parsePlanCapabilities({ workspace_members: 5, api_access: true });
    check("an unknown capability is KEPT, not pruned", unknownKey.api_access === true);

    check("capabilityNumber reads numbers and only numbers",
      capabilityNumber(PROD_PLANS.pro, "workspace_members") === 5
      && capabilityNumber(PROD_PLANS.pro, "priority_queue") === null
      && capabilityNumber(PROD_PLANS.pro, "absent") === null);
    check("-1 is unlimited, and is a number not a null",
      capabilityNumber(PROD_PLANS.agency, "products") === UNLIMITED);
    check("capabilityFlag is true only for a real true",
      capabilityFlag(PROD_PLANS.pro, "priority_queue")
      && !capabilityFlag(PROD_PLANS.free, "priority_queue")
      && !capabilityFlag({ x: 1 }, "x"));
  }

  console.log("\nB. A SAVE ROUND-TRIPS THE STORED BAG");
  {
    for (const [slug, bag] of Object.entries(PROD_PLANS)) {
      // What the fixed editor sends: the bag it loaded, edited or not.
      check(`${slug} survives an unchanged save`,
        JSON.stringify(saveUpdate({ ...bag }, bag)) === JSON.stringify(bag));
    }
    // A real edit still lands.
    const edited = saveUpdate({ ...PROD_PLANS.pro, workspace_members: 8 }, PROD_PLANS.pro);
    check("raising a capability is written",
      (edited as PlanCapabilities).workspace_members === 8);
    // Withdrawing a capability is expressible — false and 0 are values, not absence.
    const withdrawn = saveUpdate({ ...PROD_PLANS.pro, priority_queue: false }, PROD_PLANS.pro);
    check("a capability can be switched off",
      (withdrawn as PlanCapabilities).priority_queue === false);
    check("switching off is not the same as blanking",
      (withdrawn as PlanCapabilities).workspace_members === 5);
    // An unknown key the editor cannot render rides along.
    const withExtra = { ...PROD_PLANS.pro, api_access: true };
    check("an unknown capability survives an admin save",
      (saveUpdate({ ...withExtra }, withExtra) as PlanCapabilities).api_access === true);
  }

  console.log("\nC. THE OLD SHAPE CANNOT BLANK A PLAN");
  {
    // THE EXACT BUG. The editor sends string[]; the stored bag must survive.
    const after = saveUpdate(LEGACY_ARRAY, PROD_PLANS.pro);
    check("a string[] save leaves the stored bag untouched",
      JSON.stringify(after) === JSON.stringify(PROD_PLANS.pro));
    check("an empty array does not blank the bag",
      JSON.stringify(saveUpdate([], PROD_PLANS.pro)) === JSON.stringify(PROD_PLANS.pro));
    check("an empty bag does not blank a non-empty one",
      JSON.stringify(saveUpdate({}, PROD_PLANS.pro)) === JSON.stringify(PROD_PLANS.pro));
    check("null does not blank the bag",
      JSON.stringify(saveUpdate(null, PROD_PLANS.pro)) === JSON.stringify(PROD_PLANS.pro));
    check("undefined does not blank the bag",
      JSON.stringify(saveUpdate(undefined, PROD_PLANS.pro)) === JSON.stringify(PROD_PLANS.pro));
    check("a string does not blank the bag",
      JSON.stringify(saveUpdate("Priorytet w kolejce", PROD_PLANS.pro)) === JSON.stringify(PROD_PLANS.pro));
    // A plan that legitimately has no capabilities may stay that way.
    check("an empty bag over an empty bag is allowed",
      JSON.stringify(saveUpdate({}, {})) === "{}");
    // INSERT has nothing to fall back on and must never write NULL or an array.
    check("an insert with a bag writes the bag",
      JSON.stringify(saveInsert(PROD_PLANS.free)) === JSON.stringify(PROD_PLANS.free));
    check("an insert with a string[] writes an empty bag, never the array",
      JSON.stringify(saveInsert(LEGACY_ARRAY)) === "{}");
    check("an insert never writes null", saveInsert(null) !== null);
  }

  console.log("\nD. THE EDITOR NO LONGER BUILDS AN ARRAY");
  {
    const src = codeOnly(read("components/admin/plan-manager.tsx"));
    check("no textarea-to-array serialisation remains",
      !/features:\s*featuresText/.test(src) && !/split\("\\n"\)/.test(src),
      "the split(newline) -> map(trim) -> filter(Boolean) write is gone");
    check("the editor holds a bag in state", /parsePlanCapabilities\(/.test(src));
    check("the bag is what is sent to the action", /features:\s*caps\b/.test(src));
    check("every known numeric capability has a field",
      KNOWN_NUMERIC_CAPABILITIES.every(() => /KNOWN_NUMERIC_CAPABILITIES\.map\(/.test(src)));
    check("every known flag capability has a checkbox",
      /KNOWN_FLAG_CAPABILITIES\.map\(/.test(src));
    check("-1 is reachable from the number field", /min=\{UNLIMITED\}/.test(src),
      "a min of 0 would make 'unlimited' untypable");

    // /admin is served a SCOPED dictionary (P0-03). An editor label borrowed
    // from the `plans` namespace renders a humanised fallback there while
    // looking perfectly correct in the source — so every label this editor
    // names must be an `admin.` key.
    const labels = src.match(/CAPABILITY_LABEL[\s\S]*?\};/)?.[0] ?? "";
    check("every capability label lives in the admin namespace",
      labels.includes("admin.cap.") && !/"(?!admin\.)[a-z]+\./.test(labels),
      labels.replace(/\s+/g, " "));

    const action = codeOnly(read("app/actions/admin.ts"));
    check("the action types features as a bag, not string[]",
      /features:\s*PlanCapabilities/.test(action) && !/features:\s*string\[\]/.test(action));
    check("the action consults the stored row before writing",
      /writableCapabilities\(/.test(action)
      && /from\("subscription_plans"\)\.select\("features"\)/.test(action));
    check("a refused bag omits the column entirely on update",
      /features === null \? \{\} : \{ features:/.test(action),
      "spreading {} leaves the stored value in place");
  }

  console.log("\nE. READER AND WRITER SHARE ONE PARSER");
  {
    const page = codeOnly(read("app/(app)/plan/page.tsx"));
    check("/plan parses with the shared parser", /parsePlanCapabilities\(p\.features\)/.test(page));
    check("/plan no longer hand-rolls the shape check",
      !/typeof p\.features === "object"/.test(page));
    const board = codeOnly(read("components/plan/pricing-board.tsx"));
    check("the board's card type is the shared type",
      /capabilities:\s*PlanCapabilities/.test(board));
    // The board reads exactly the keys the editor can write. A key it reads
    // that no field writes is a row that is always empty.
    for (const key of [...KNOWN_NUMERIC_CAPABILITIES, ...KNOWN_FLAG_CAPABILITIES]) {
      if (key === "products") continue; // shown via `limits`, not a board row
      check(`the board reads ${key}`, board.includes(`capabilities.${key}`));
    }
  }

  console.log("\nF. THE COPY DESCRIBES THE REAL FORMAT");
  {
    // The old strings promised "one per line, each line becomes a bullet" —
    // a bullet list the plan card never rendered. Copy that describes a
    // format nobody implements is how the two halves drifted apart.
    const wrong = [/jedna na lini/i, /one per line/i, /eins pro Zeile/i,
      /stanie się punktem/i, /becomes a bullet/i, /wird ein Punkt/i];
    for (const locale of ["pl", "en", "de"] as const) {
      const dict = JSON.parse(read(`lib/i18n/dictionaries/${locale}.json`));
      const admin = dict.admin as Record<string, string>;
      const text = `${admin.featuresLabel} ${admin.featuresHint}`;
      check(`${locale}: the line-per-feature promise is gone`,
        !wrong.some((re) => re.test(text)), text);
      check(`${locale}: every capability field has a label`,
        typeof admin["cap.products"] === "string"
        && typeof admin["cap.members"] === "string"
        && typeof admin["cap.unlimitedHint"] === "string"
        && typeof admin["cap.extra"] === "string");
      check(`${locale}: the unlimited convention is explained`,
        admin["cap.unlimitedHint"].includes("-1"));
    }
    // Three dictionaries that agree word for word mean one was never written.
    const hints = (["pl", "en", "de"] as const).map((l) =>
      (JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).admin as Record<string, string>)["cap.unlimitedHint"]);
    check("the three locales are genuinely translated",
      new Set(hints.map((h) => h.replace(/-1/g, "").trim())).size === 3, hints.join(" | "));
  }

  console.log("\nG. ANNUAL BILLING IS A STORED PRICE OR IT IS NOT ON OFFER");
  {
    // Production today: four plans, `annual_price_cents = 0` on all of them.
    const PROD = [
      { priceCents: 0, annualPriceCents: 0 },      // free
      { priceCents: 4900, annualPriceCents: 0 },   // starter
      { priceCents: 14900, annualPriceCents: 0 },  // pro
      { priceCents: 39900, annualPriceCents: 0 },  // agency
    ];
    check("with no annual prices stored, annual billing is NOT offered",
      !annualBillingAvailable(PROD));
    check("and there is no saving to advertise", annualSavingPct(PROD) === 0);

    // Half-priced catalogues cannot power a toggle that switches all columns.
    const partial = [...PROD.slice(0, 2), { priceCents: 14900, annualPriceCents: 149000 }, PROD[3]];
    check("one plan with an annual price is not enough", !annualBillingAvailable(partial));

    // The day real prices land, the offer turns on with no code change.
    const decided = [
      { priceCents: 0, annualPriceCents: 0 },
      { priceCents: 4900, annualPriceCents: 49000 },
      { priceCents: 14900, annualPriceCents: 149000 },
      { priceCents: 39900, annualPriceCents: 399000 },
    ];
    check("a full annual catalogue turns the offer on", annualBillingAvailable(decided));
    check("the free plan does not block the offer", annualBillingAvailable(decided));
    check("the monthly equivalent is the stored total over twelve",
      annualMonthlyCents(decided[2]) === Math.round(149000 / 12));
    check("a plan with no annual price falls back to its monthly price, not a discount",
      annualMonthlyCents({ priceCents: 14900, annualPriceCents: 0 }) === 14900);

    // Ten-for-twelve is 16.67% -> 17 on every one of these, but the badge must
    // be derived, not asserted: a catalogue with uneven savings shows the
    // smallest, because one badge sits above all four columns.
    check("the badge quotes the real saving", annualSavingPct(decided) === 17);
    const uneven = [
      { priceCents: 4900, annualPriceCents: 58800 },   // 0% — twelve months exactly
      { priceCents: 14900, annualPriceCents: 149000 }, // 17%
    ];
    check("an uneven catalogue advertises the SMALLEST saving, never the best",
      annualSavingPct(uneven) === 0);
    check("an annual price above twelve months never advertises a negative saving",
      annualSavingPct([{ priceCents: 4900, annualPriceCents: 70000 }]) === 0);

    // The invented coefficient must be gone from the markup.
    const board = codeOnly(read("components/plan/pricing-board.tsx"));
    check("the ten-for-twelve coefficient is gone",
      !/ANNUAL_MONTHS_PAID/.test(board) && !/ANNUAL_PCT/.test(board),
      "the annual price was `priceCents * 10 / 12`, a discount invented in the component");
    check("the board prices annually from the stored total",
      /annualMonthlyCents\(p\)/.test(board));
    check("the toggle is rendered only when annual billing is available",
      /\{annualAvailable && \(/.test(board));
    check("a zero saving renders no badge", /annualPct > 0 && \(/.test(board));
    check("the figures follow annualOn, not the raw toggle state",
      /const annualOn = annual && annualAvailable/.test(board)
      && /annual=\{annualOn\}/.test(board));

    const page = codeOnly(read("app/(app)/plan/page.tsx"));
    check("/plan passes the stored annual price through",
      /annualPriceCents:\s*p\.annual_price_cents/.test(page));
  }

  console.log(failures === 0
    ? "\nAll plan capability tests passed."
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("plan capability tests crashed:", e); process.exit(1); });
