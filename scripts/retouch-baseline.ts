/**
 * INDEPENDENT GEMINI BASELINE — the minimal Retusz request written by hand
 * from Google's own image-editing example for the Interactions API
 * (google-gemini/cookbook quickstarts/Get_Started_Nano_Banana.ipynb, 2026-09:
 * `client.interactions.create(model=…, input=[{"type":"text",…},
 * {"type":"image","data":…,"mime_type":…}], response_modalities=[…])`), with
 * `store: false` (interactions are stored by default — gemini-skills
 * `gemini-api-dev`):
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   { "model": "gemini-3-pro-image",
 *     "input": [ { "type": "text", "text": PROMPT },
 *                { "type": "image", "data": BASE64, "mime_type": MIME } ],
 *     "response_modalities": ["image"],
 *     "store": false }
 *
 * No image size, no aspect ratio, no system instruction, no tools, no
 * previous interaction. On purpose this file imports NOTHING from the
 * application — no builder, no adapter, no runGeneration, no prompt engine.
 * It is the "A" the forensic test compares GrovBase's real HTTP body ("B")
 * against; if it shared code with production it would share its mistakes.
 */

export const BASELINE_MODEL = "gemini-3-pro-image";
export const BASELINE_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export type BaselineInput = {
  /** The published prompt, exactly. */
  prompt: string;
  /** The original file, exactly as uploaded. */
  image: Buffer;
  mimeType: string;
};

export function baselineBody(input: BaselineInput): string {
  return JSON.stringify({
    model: BASELINE_MODEL,
    input: [
      { type: "text", text: input.prompt },
      { type: "image", data: input.image.toString("base64"), mime_type: input.mimeType },
    ],
    response_modalities: ["image"],
    store: false,
  });
}
