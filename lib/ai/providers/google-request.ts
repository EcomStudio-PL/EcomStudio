import type { AiModelRecord, GenerationRequest } from "../types";

/**
 * THE GEMINI IMAGE REQUEST — built in ONE place.
 *
 * The adapter sends exactly this body, the admin dry-run shows exactly this
 * body (with the image bytes replaced by their fingerprint), and the tests pin
 * it. There is no second Gemini implementation: Retusz, Moda, the generator
 * and every Workflow image step reach Google through this function.
 *
 * What it sends and nothing else:
 *   · the reference images as inlineData, in the order given, FIRST — the
 *     order of Google's own Nano Banana Pro edit sample (image, then the
 *     instruction) and the order this adapter has always used;
 *   · then ONE text part — `req.prompt`, verbatim. Nothing is prepended or
 *     appended here; whatever the model should read is already in the prompt.
 *   · responseModalities IMAGE, plus the size and ratio actually chosen:
 *       aspectRatio — omitted for "auto" with a reference attached, so an
 *                     edit keeps the input photo's own shape (Gemini's
 *                     documented default) instead of a ratio GrovBase picked;
 *       imageSize   — the chosen size, whenever the model offers sizes at all.
 * No systemInstruction, no thinking override, no sampling knobs: the model's
 * own defaults apply.
 */

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type GeminiImageBody = {
  contents: { role: "user"; parts: GeminiPart[] }[];
  generationConfig: {
    responseModalities: ["IMAGE"];
    imageConfig: { aspectRatio?: string; imageSize?: string };
  };
};

export type GeminiImagePlan = {
  /** An edit carries the source image(s); a generation carries none. */
  operation: "IMAGE_EDIT" | "IMAGE_GENERATION";
  /** The ratio sent, or null when none is (the input photo's shape wins). */
  aspectRatio: string | null;
  /** The size sent, or null when none is (the model's default). */
  imageSize: string | null;
  body: GeminiImageBody;
};

type ModelShape = Pick<AiModelRecord, "supported_resolutions">;
type RequestShape = Pick<GenerationRequest, "prompt" | "aspectRatio" | "resolution" | "referenceImages">;

/** The size to send: the chosen one, when the model offers any choice of
 *  size (an explicit "1K" included). A model that only knows one size (the
 *  2.5 flash image model) is never sent the field. */
export function geminiImageSize(model: ModelShape, resolution: string | null | undefined): string | null {
  const sizes = model.supported_resolutions ?? [];
  if (!resolution || !sizes.includes(resolution)) return null;
  return sizes.some((s) => s !== "1K") ? resolution : null;
}

export function buildGeminiImageRequest(model: ModelShape, req: RequestShape): GeminiImagePlan {
  const edit = req.referenceImages.length > 0;
  const aspectRatio = req.aspectRatio === "auto" ? null : req.aspectRatio;
  const imageSize = geminiImageSize(model, req.resolution ?? null);
  const imageConfig: GeminiImageBody["generationConfig"]["imageConfig"] = {};
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (imageSize) imageConfig.imageSize = imageSize;
  return {
    operation: edit ? "IMAGE_EDIT" : "IMAGE_GENERATION",
    aspectRatio,
    imageSize,
    body: {
      contents: [{
        role: "user",
        parts: [
          ...req.referenceImages.map((r) => ({ inlineData: { mimeType: r.mime, data: r.base64 } })),
          { text: req.prompt },
        ],
      }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig },
    },
  };
}
