/**
 * CONCEPT ENGINE — deterministic tests: shot-count clamping, the encrypted
 * prompt round trip (with a throwaway key), retake variation rotation and
 * the guarantee that a variation never rewrites the concept itself.
 * Run: npm run test:concepts
 */
process.env.APP_ENCRYPTION_KEY = "a".repeat(64); // throwaway key for the round trip

import { clampShots, decryptConceptPayload, encryptConceptPayload, MAX_SHOTS, MIN_SHOTS } from "../lib/server/prompt-engine";
import { variationInstruction } from "../lib/server/concept-generation";
import { synthesizeConcepts, diversityViolations } from "../lib/ai/engine/scenes";
import { retryDelayMs } from "../lib/server/provider-router";
import type { ImageAnalysis, SceneConcept } from "../lib/ai/engine/types";

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

console.log("\nD. EXACT COUNT — the diversity filter can reject, never shrink the order");
const analysis = (n: number): ImageAnalysis => ({
  image_number: n, view: "front", full_product: true, product_count: 1, occlusion: "none",
  product_quality: "sharp", color_reference: true, material_reference: true,
  scale_reference: false, dimension_reference: false, branding_visibility: "clear",
  text_visibility: "clear", usage_reference: false, background_complexity: "clean",
  critical_features: [], scene_reference_only: false, primary_candidate_score: 90 - n,
  roles: ["PRIMARY_GEOMETRY"], observed_color: "gray", observed_button_count: 0, variant_hint: null,
});
const existing: SceneConcept[] = [{
  scene_type: "product_in_use", title: "Use", customer_title: "W użyciu", customer_description: "x",
  scene_description: "s", environment: "kitchen", camera_distance: "medium", camera_angle: "eye",
  lighting: "soft", human_presence: true, human_interaction: "grip", product_placement: "p",
  physical_contact: "c", product_orientation: "front", marketing_purpose: "m",
  required_views: ["front"], primary_reference: 1, supporting_references: [], product_specific_negatives: [],
}];
for (const missing of [1, 3, 5]) {
  const synth = synthesizeConcepts(existing, missing, "gray kettle", [analysis(1), analysis(2), analysis(3)], "pl");
  check(`synthesizes exactly ${missing} replacement(s)`, synth.length === missing);
  const all = [...existing, ...synth];
  check(`no diversity collisions at +${missing}`, diversityViolations(all).length === 0);
}
const synth2 = synthesizeConcepts(existing, 2, "gray kettle", [analysis(1), analysis(2), analysis(3)], "pl");
check("synthesized cards speak Polish", synth2.every((c) => /produktu|packshot|główne|hero|Skala|Budowa|Detal/i.test(c.customer_title)));
check("synthesized concepts carry references", synth2.every((c) => c.primary_reference >= 1 && c.supporting_references.length >= 1));
check("synthesized concepts need no unavailable views", synth2.every((c) => c.required_views.length === 0));

console.log("\nE. RETRY PACING — backoff grows, Retry-After wins");
const d1 = retryDelayMs(1), d2 = retryDelayMs(2), d3 = retryDelayMs(3);
check("backoff grows with attempts", d1 < d2 && d2 < d3, `${Math.round(d1)} < ${Math.round(d2)} < ${Math.round(d3)}`);
check("Retry-After takes precedence", Math.abs(retryDelayMs(1, 21000) - 21000) < 600);
check("delays are capped", retryDelayMs(10, 300000) <= 30600);

console.log(failures === 0 ? "\nALL CONCEPT TESTS PASSED\n" : `\n${failures} test(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
