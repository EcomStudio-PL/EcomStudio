/**
 * TWO IDENTICAL GENERATION REQUESTS MUST COST ONE GENERATION.
 *
 * WHAT WENT WRONG (P1-25). The generation ledger key was `job:${job.id}`,
 * built from a row the same request had just inserted — so it was unique by
 * construction. Two identical POSTs to /api/generate, /api/fashion or
 * /api/retusz produced two keys, two charges and two provider calls, and the
 * unique index the ledger arbitrates on had nothing to arbitrate. The tool
 * route already did this correctly: derive the key from what the request
 * MEANS. This is the same rule for generations.
 *
 * AND (P1-11) the concepts double-click guard could never fire. It read
 * `concept.last_job_id`, which is written only after runGeneration returns and
 * only on success — by the time the column named a job, that job was finished,
 * so "is a job still running?" was never true. Two parallel POSTs both passed.
 *
 * WHY A KEY IS NOT ENOUGH ON ITS OWN, and why these tests do not stop here:
 * a derived key only helps if the product actually uses it, and if the
 * refusal it produces reaches the customer in words the panels already speak.
 * `duplicate_request` is not in any dictionary; `already_running` is, in all
 * three, and both call sites already render it as "still going" rather than as
 * a failure. So the translation of one to the other is part of the fix and is
 * pinned here.
 *
 * Run: npm run test:genkey
 */
import { readFileSync } from "fs";
import { join } from "path";
import { generationIdempotencyKey } from "../lib/server/generation";

const ROOT = process.cwd();
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const BASE = {
  modelId: "m-1", prompt: "a red shoe on white", aspectRatio: "1:1",
  resolution: "1K" as string | null, quality: null as string | null,
  quantity: 2, cost: 6,
  productId: "p-1" as string | null,
  productContext: "\n\nPRODUKT: Buty sportowe",
  conceptId: null as string | null,
  promptId: null as string | null, parentJobId: null as string | null,
  operation: null as string | null,
  referencePaths: ["a/1.jpg", "a/2.jpg"], inspirationPaths: [] as string[],
  markedImagePath: null as string | null,
};
const WS = "ws-1";
const T = 1_700_000_000_000; // a fixed clock: Date.now() would make this flaky

console.log("A. THE KEY IS THE REQUEST'S MEANING");

check("two identical requests derive one key",
  generationIdempotencyKey(WS, BASE, T) === generationIdempotencyKey(WS, BASE, T));

check("another workspace never collides with this one",
  generationIdempotencyKey(WS, BASE, T) !== generationIdempotencyKey("ws-2", BASE, T));

/** Every field that changes what the customer gets, or what they pay. If any
 *  of these stopped affecting the key, two DIFFERENT runs would collide and
 *  the second would be refused as a duplicate — a customer unable to generate. */
const MUST_MATTER: Array<[string, Partial<typeof BASE>]> = [
  ["a different model", { modelId: "m-2" }],
  ["a different prompt", { prompt: "a blue shoe on white" }],
  ["a different aspect ratio", { aspectRatio: "4:5" }],
  ["a different resolution", { resolution: "2K" }],
  ["a different quality", { quality: "high" }],
  ["a different quantity", { quantity: 3 }],
  ["a different price", { cost: 9 }],
  ["a different product", { productId: "p-2" }],
  // THE ONE THE FIRST VERSION MISSED. The generator's normal path carries no
  // product row at all — the seller types free text, it is concatenated into
  // the fidelity instructions and it changes the image. Without it, two
  // requests describing DIFFERENT products derived the same key and the second
  // was refused as a duplicate of a run the seller never made.
  ["a different product description", { productContext: "\n\nPRODUKT: Kubek ceramiczny" }],
  ["a description appearing where there was none", { productContext: "" }],
  ["a different concept", { conceptId: "c-1" }],
  ["a different source prompt", { promptId: "pr-1" }],
  ["a different parent job", { parentJobId: "j-9" }],
  ["a different operation", { operation: "retusz" }],
  ["different reference images", { referencePaths: ["a/1.jpg", "a/3.jpg"] }],
  ["different inspirations", { inspirationPaths: ["i/1.jpg"] }],
  ["a different marked image", { markedImagePath: "m/1.png" }],
];
for (const [label, patch] of MUST_MATTER) {
  check(`${label} is a different run`,
    generationIdempotencyKey(WS, BASE, T) !== generationIdempotencyKey(WS, { ...BASE, ...patch }, T),
    "this field does not reach the key, so two different runs would collide");
}

console.log("\nB. THE WINDOW BOUNDS A RUN THAT ENDED IN NEITHER STATE");
// Migration 0101 releases the key at every terminal state, so this window is
// not what allows a re-run — it only stops an invocation killed at its ceiling
// from blocking that input forever.
check("the same request inside one window is the same submit",
  generationIdempotencyKey(WS, BASE, T) === generationIdempotencyKey(WS, BASE, T + 60_000));
check("the same request in the next window is a new submit",
  generationIdempotencyKey(WS, BASE, T) !== generationIdempotencyKey(WS, BASE, T + 5 * 60_000));

console.log("\nC. THE PRODUCT USES IT (a key nothing passes is not a key)");

const gen = readFileSync(join(ROOT, "lib/server/generation.ts"), "utf8");

check("the key is no longer built from the job row",
  !/idempotencyKey:\s*`job:\$\{/.test(gen),
  "`job:${job.id}` is unique per request — the ledger would have nothing to arbitrate");

/*
  AND THE CALL SITE ACTUALLY PASSES WHAT THE HELPER ASKS FOR.

  The permutations above prove the helper is sensitive to each field. They
  cannot prove the RUNNER hands that field over — a field dropped at the call
  site never reaches the helper, so no permutation of the helper's own inputs
  can turn red. That is precisely how `productDescription` went missing: it
  reached the provider and changed the image, and was absent from the key.

  So the resolved product text is checked where it is passed, not only where
  it is hashed.
*/
check("the runner passes the resolved product text into the key",
  /generationIdempotencyKey\([\s\S]{0,900}?\n\s*productContext,/.test(gen),
  "free-text product context changes the image, so it has to change the key");
check("startUsage is given the derived key",
  /generationJobId: job\.id, idempotencyKey,/.test(gen));
check("the key is derived before the charge",
  gen.indexOf("const idempotencyKey = generationIdempotencyKey(") < gen.indexOf("const usage = await startUsage("),
  "the key must exist before the ledger call that uses it");
check("a refused duplicate is reported in words the panels already have",
  /usage\.error === "duplicate_request" \? "already_running"/.test(gen),
  "duplicate_request is in no dictionary and would surface as a generic error");

const concept = readFileSync(join(ROOT, "lib/server/concept-generation.ts"), "utf8");
check("the concepts guard asks about the job's own prompt_id",
  /\.eq\("prompt_id", conceptId\)/.test(concept) && /\.in\("status", \["queued", "processing"\]\)/.test(concept),
  "last_job_id is written after the run finishes, so a guard on it can never fire");
check("the concepts guard no longer reads last_job_id to decide",
  !/if \(concept\.last_job_id\) \{/.test(concept),
  "that branch was the defect");

console.log("\nD. THE WORD IT REPORTS EXISTS IN EVERY LANGUAGE");
for (const locale of ["pl", "en", "de"]) {
  const dict = JSON.parse(readFileSync(join(ROOT, `lib/i18n/dictionaries/${locale}.json`), "utf8"));
  const value = dict?.studio?.err?.already_running;
  check(`studio.err.already_running exists in ${locale}`,
    typeof value === "string" && value.length > 0,
    "the refusal would fall back to a humanised key in front of a customer");
}

console.log(failures === 0 ? "\nAll generation idempotency tests passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
