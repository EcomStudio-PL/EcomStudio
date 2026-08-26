/**
 * CONCEPT ENGINE v3 — deterministic tests: shot-count clamping, the encrypted
 * prompt round trip (throwaway key), the ONE master template (identical
 * prefix for every product, conditional human block, no negative prompt),
 * exact-count synthesis, retake variation and dual pricing.
 * Run: npm run test:concepts
 */
process.env.APP_ENCRYPTION_KEY = "a".repeat(64); // throwaway key for the round trip

import { candidatePoolSize, clampShots, decryptConceptPayload, encryptConceptPayload, MAX_SHOTS, MIN_SHOTS } from "../lib/server/prompt-engine";
import { variationInstruction, originCost } from "../lib/server/concept-generation";
import type { UsableModel } from "../lib/ai/router";
import { synthesizeScenes, diversityViolations, clampRefs, type PlannedScene } from "../lib/ai/engine/scenes";
import { composeFinalPrompt, validateFinalPrompt, MASTER_PREFIX } from "../lib/ai/engine/template-prompt";
import { retryDelayMs } from "../lib/server/provider-router";

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
check("candidate pool over-provisions by two", candidatePoolSize(5) === 7 && candidatePoolSize(7) === 9);
check("candidate pool caps at twelve", candidatePoolSize(10) === 12);

console.log("\nB. MASTER TEMPLATE — one deterministic prompt, no negative, no rewriting");
const scenes = {
  kettle: "Czajnik stoi na drewnianym blacie kuchennym obok filiżanki i deski z cytrynami. Z dzióbka unosi się delikatna para. Ujęcie 3/4 na wysokości blatu.",
  chair: "Fotel stoi w jasnym salonie przy oknie, obok mały stolik z książką. Perspektywa z poziomu siedziska, lekko z boku.",
  trap: "Łapka stoi na podłodze w stodole z widocznym bydłem w tle. W stronę łapki biegnie mysz i szczur. Perspektywa z poziomu podłogi.",
};
const p1 = composeFinalPrompt({ productName: "Czajnik elektryczny Retro", sceneDescription: scenes.kettle, humanPresence: false });
const p2 = composeFinalPrompt({ productName: "Fotel biurowy Ergo", sceneDescription: scenes.chair, humanPresence: false });
const p3 = composeFinalPrompt({ productName: "Łapka na myszy", sceneDescription: scenes.trap, humanPresence: false });
const prefixOf = (s: string) => s.slice(0, s.indexOf("Produkt:"));
check("three products share the IDENTICAL master prefix", prefixOf(p1) === prefixOf(p2) && prefixOf(p2) === prefixOf(p3));
check("prompt starts with the master scenery", p1.startsWith(MASTER_PREFIX) && p1.startsWith("Stwórz zdjęcie reklamowe."));
check("fidelity guard is always present", [p1, p2, p3].every((p) => p.includes("Odwzoruj produkt zgodnie ze zdjęciami referencyjnymi.")));
check("product line lands after the template", p1.includes("Produkt: Czajnik elektryczny Retro."));
check("scene line is the planner's text verbatim", p1.endsWith(`Scena: ${scenes.kettle}`));
const ph = composeFinalPrompt({ productName: "Suszarka", sceneDescription: "Na blacie kobieta z mężem kroją pieczarki, które zaraz będą suszyć w suszarce. Perspektywa od góry 3/4.", humanPresence: true });
check("human block appears ONLY with people in frame", ph.includes("fotorealistycznie") && !p1.includes("fotorealistycznie"));
check("no negative-prompt vocabulary in the final prompt", [p1, p2, p3, ph].every((p) => !/negative|negatyw|AVOID/i.test(p)));
check("validator accepts assembled prompts", [p1, p2, p3, ph].every((p) => validateFinalPrompt(p)));
check("validator rejects a bare fragment", !validateFinalPrompt("szara sofa w salonie"));
check("validator rejects a rewritten template", !validateFinalPrompt(p1.replace("Sceneria:", "Klimat:")));

console.log("\nC. HIDDEN PROMPT — encrypt → store → decrypt round trip");
const sealed = encryptConceptPayload(p1, "");
check("ciphertext is not the plaintext", !sealed.ciphertext.includes("Sceneria"));
const opened = decryptConceptPayload({ prompt_encrypted: sealed.ciphertext, prompt_iv: sealed.iv, prompt_tag: sealed.authTag });
check("round trip restores the prompt", opened?.prompt === p1);
check("no negative rides along", opened?.negative === "");
check("missing columns decrypt to null", decryptConceptPayload({ prompt_encrypted: null, prompt_iv: null, prompt_tag: null }) === null);
check("tampered ciphertext decrypts to null", decryptConceptPayload({
  prompt_encrypted: sealed.ciphertext.slice(0, -4) + "AAAA", prompt_iv: sealed.iv, prompt_tag: sealed.authTag,
}) === null);

console.log("\nD. EXACT COUNT — synthesis fills every missing slot, diversity holds");
const existing: PlannedScene[] = [{
  title: "Poranek w kuchni", scene_description: scenes.kettle, human_presence: false, reference_indices: [1, 2],
}];
for (const missing of [1, 3, 5]) {
  const synth = synthesizeScenes(existing, missing, "szary czajnik", 3);
  check(`synthesizes exactly ${missing} scene(s)`, synth.length === missing);
  check(`no diversity collisions at +${missing}`, diversityViolations([...existing, ...synth]).length === 0);
}
const synth2 = synthesizeScenes(existing, 2, "szary czajnik", 3);
check("synthesized scenes speak Polish and name the product", synth2.every((s) => s.scene_description.includes("szary czajnik")));
check("synthesized scenes carry references", synth2.every((s) => s.reference_indices.length >= 1));
check("clampRefs repairs empty/invalid refs", clampRefs({ ...existing[0], reference_indices: [0, 99, 2, 2] }, 3).reference_indices.join() === "2"
  || clampRefs({ ...existing[0], reference_indices: [0, 99, 2, 2] }, 3).reference_indices.includes(2));

console.log("\nE. RETAKE VARIATION — controlled, rotating, never a new scene");
const takes = [1, 2, 3, 4, 5].map((n) => variationInstruction(n));
check("consecutive retakes vary differently", new Set(takes.slice(0, 4)).size === 4);
check("the rotation wraps", takes[4] === takes[0]);
check("every variation forbids changing the concept", takes.every((v) => v.includes("Nie zmieniaj koncepcji sceny")));

console.log("\nF. DUAL PRICING — custom pays base, EcomStudio adds the surcharge");
const fakeModel = {
  credit_cost: 4, pricing: { "1K": 4 }, supported_resolutions: ["1K"],
  ecom_surcharge_credits: 49,
} as unknown as UsableModel;
check("custom prompt pays the base price", originCost(fakeModel, "custom") === 4);
check("EcomStudio prompt adds the surcharge", originCost(fakeModel, "ecomstudio") === 53);
const negSurcharge = { ...fakeModel, ecom_surcharge_credits: -5 } as unknown as UsableModel;
check("negative surcharge never discounts", originCost(negSurcharge, "ecomstudio") === 4);

// The toolbar lets a seller pick 2K/4K where the engine offers it; the quote
// and the charge must both move, and an unsupported size must fall back the
// same way the generation path does rather than quoting a cheaper render.
const multiRes = {
  credit_cost: 4, pricing: { "1K": 4, "2K": 9, "4K": 20 },
  supported_resolutions: ["1K", "2K", "4K"], ecom_surcharge_credits: 49,
} as unknown as UsableModel;
check("2K costs the 2K price", originCost(multiRes, "custom", "2K") === 9);
check("4K adds the surcharge on the 4K price", originCost(multiRes, "ecomstudio", "4K") === 69);
check("an unsupported size falls back to the default", originCost(fakeModel, "custom", "4K") === 4);
check("no size means the model default", originCost(multiRes, "custom") === 4);

console.log("\nG. RETRY PACING — backoff grows, Retry-After wins");
const d1 = retryDelayMs(1), d2 = retryDelayMs(2), d3 = retryDelayMs(3);
check("backoff grows with attempts", d1 < d2 && d2 < d3, `${Math.round(d1)} < ${Math.round(d2)} < ${Math.round(d3)}`);
check("Retry-After takes precedence", Math.abs(retryDelayMs(1, 21000) - 21000) < 600);
check("delays are capped", retryDelayMs(10, 300000) <= 30600);

console.log(failures === 0 ? "\nALL CONCEPT TESTS PASSED\n" : `\n${failures} test(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
