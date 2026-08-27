import "server-only";

/**
 * MASTER PROMPT — the one deterministic template GrovBase sends to image
 * models. Assembled by PLAIN CODE: master scenery + fixed product-fidelity
 * guard + (only when the scene includes people) the fixed human-realism
 * block + the product name + the scene description from the planner.
 *
 * No negative prompt. No dynamic rule lists. No LLM ever rewrites,
 * summarises or "improves" the assembled prompt — the planner's entire
 * contribution is the scene description, nothing else.
 */

export const PROMPT_TEMPLATE_VERSION = 3;

const MASTER_SCENERY = `Stwórz zdjęcie reklamowe.

Sceneria:
Scena ma mieć świeży i kontrastowy klimat, jak na profesjonalnej fotografii reklamowej. Światło ma być jasne, dzienne, z wyraźnymi cieniami i realistycznymi refleksami. Kolorystyka ma być czysta, wyrazista i premium. Otoczenie ma wyglądać luksusowo, zadbanie i realistycznie. Ultra realistic, 8k, cinematic daylight, sharp focus, realistic materials, premium commercial photography.`;

const MASTER_FIDELITY = `Odwzoruj produkt zgodnie ze zdjęciami referencyjnymi. Zachowaj rzeczywisty kształt, proporcje, kolory, materiały, elementy, przyciski, porty, nadruki oraz liczbę elementów zestawu. Nie zmieniaj konstrukcji produktu. Produkt ma wyglądać jak rzeczywisty fotografowany egzemplarz, nie jak render 3D. Nie dodawaj napisów poza napisami rzeczywiście występującymi na produkcie.`;

const MASTER_HUMANS = `Ludzie muszą wyglądać całkowicie fotorealistycznie: naturalna faktura skóry, pory, drobne przebarwienia, naturalne włosy, poprawna anatomia dłoni i palców, bez plastikowego wyglądu.`;

export function composeFinalPrompt(input: {
  productName: string;
  sceneDescription: string;
  humanPresence: boolean;
}): string {
  return [
    MASTER_SCENERY,
    MASTER_FIDELITY,
    ...(input.humanPresence ? [MASTER_HUMANS] : []),
    `Produkt: ${input.productName.trim()}.`,
    `Scena: ${input.sceneDescription.trim()}`,
  ].join("\n\n");
}

/** Every stored prompt must be the master template verbatim plus its two
 *  dynamic lines — never a bare fragment, never a rewritten variant. */
export function validateFinalPrompt(prompt: string): boolean {
  return prompt.startsWith(MASTER_SCENERY)
    && prompt.includes(MASTER_FIDELITY)
    && /Produkt: .+\./.test(prompt)
    && /Scena: [\s\S]{20,}/.test(prompt);
}

/** Exposed for tests and the admin debug view. */
export const MASTER_PREFIX = MASTER_SCENERY;
