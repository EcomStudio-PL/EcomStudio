/**
 * INDEPENDENT GEMINI BASELINE — a minimal generateContent request written by
 * hand from Google's REST documentation for image editing
 * (ai.google.dev/gemini-api/docs/image-generation, "Image editing"):
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   { "contents": [{ "role": "user", "parts": [ { "text": … }, { "inlineData": { "mimeType": …, "data": … } } ] }],
 *     "generationConfig": { "responseModalities": ["IMAGE"], "imageConfig": { "aspectRatio"?: …, "imageSize": … } } }
 *
 * On purpose this file imports NOTHING from the application — no request
 * builder, no adapter, no runGeneration, no prompt engine. It is the "A" the
 * forensic test compares GrovBase's real HTTP body ("B") against; if it
 * shared code with production it would share production's mistakes.
 */

export const BASELINE_MODEL = "gemini-3-pro-image";
export const BASELINE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${BASELINE_MODEL}:generateContent`;

export type BaselineInput = {
  /** The published prompt, exactly. */
  prompt: string;
  /** The original file, exactly as uploaded. */
  image: Buffer;
  mimeType: string;
  imageSize: "1K" | "2K" | "4K";
  /** Omitted for "Oryginalny". */
  aspectRatio?: string;
};

export function baselineBody(input: BaselineInput): string {
  const imageConfig: Record<string, string> = {};
  if (input.aspectRatio) imageConfig.aspectRatio = input.aspectRatio;
  imageConfig.imageSize = input.imageSize;
  return JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        { text: input.prompt },
        { inlineData: { mimeType: input.mimeType, data: input.image.toString("base64") } },
      ],
    }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig },
  });
}
