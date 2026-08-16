/**
 * CONCEPT ENGINE — deterministic tests: shot-count clamping, the encrypted
 * prompt round trip (with a throwaway key), retake variation rotation and
 * the guarantee that a variation never rewrites the concept itself.
 * Run: npm run test:concepts
 */
process.env.APP_ENCRYPTION_KEY = "a".repeat(64); // throwaway key for the round trip

import { clampShots, decryptConceptPayload, encryptConceptPayload, MAX_SHOTS, MIN_SHOTS } from "../lib/server/prompt-engine";
import { variationInstruction } from "../lib/server/concept-generation";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("A. SHOT COUNT — the seller picks 5-10, everything else is clamped");
check("default is 5", clampShots(undefined) === 5);
check("below range clamps up", clampShots(1) === MIN_SHOTS && clampShots(-3) === MIN_SHOTS);
check("above range clamps down", clampShots(50) === MAX_SHOTS);
check("valid values pass through", clampShots(7) === 7 && clampShots(10) === 10);
check("garbage becomes the default", clampShots("abc") === 5 && clampShots(NaN) === 5);

console.log("\nB. HIDDEN PROMPT — encrypt → store → decrypt round trip");
const prompt = "TASK\nCreate one professional advertising photograph…\n\nPRODUCT LOCK\n- exact colors";
const negative = "extra fingers; invented logos";
const sealed = encryptConceptPayload(prompt, negative);
check("ciphertext is not the plaintext", !sealed.ciphertext.includes("PRODUCT LOCK"));
const opened = decryptConceptPayload({ prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag });
check("round trip restores the prompt", opened?.prompt === prompt);
check("round trip restores the negative", opened?.negative === negative);
check("missing columns decrypt to null", decryptConceptPayload({ prompt_encrypted: null, prompt_iv: null, prompt_tag: null }) === null);
check("tampered ciphertext decrypts to null", decryptConceptPayload({
  prompt_encrypted: sealed.ciphertext.slice(0, -4) + "AAAA", prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
}) === null);

console.log("\nC. RETAKE VARIATION — controlled, rotating, never a new scene");
const takes = [1, 2, 3, 4, 5].map((n) => variationInstruction(n));
check("consecutive retakes vary differently", new Set(takes.slice(0, 4)).size === 4);
check("the rotation wraps", takes[4] === takes[0]);
check("every variation forbids changing the concept", takes.every((v) => v.includes("Do not change the scene concept")));
check("variation is additive, not a replacement", takes.every((v) => v.startsWith("TAKE VARIATION")));

console.log(failures === 0 ? "\nALL CONCEPT TESTS PASSED\n" : `\n${failures} test(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
