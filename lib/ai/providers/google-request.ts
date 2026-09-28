import type { AiModelRecord, AspectRatio, GenerationRequest } from "../types";

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

/**
 * The output shapes Gemini's image models officially accept in
 * imageConfig.aspectRatio (Gemini 3 Pro Image, 2.5 Flash Image; 3.1 Flash
 * Image adds extreme panoramas this platform does not offer). Listed from
 * square outwards so an exact tie in resolveOriginalAspectRatio keeps the
 * less extreme shape.
 */
export const GEMINI_IMAGE_ASPECT_RATIOS: readonly AspectRatio[] = [
  "1:1", "5:4", "4:5", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9",
];

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
type RequestShape = Pick<GenerationRequest, "prompt" | "aspectRatio" | "resolution" | "referenceImages" | "promptFirst">;

/** The size to send: the chosen one, when the model offers any choice of
 *  size (an explicit "1K" included). A model that only knows one size (the
 *  2.5 flash image model) is never sent the field. */
export function geminiImageSize(model: ModelShape, resolution: string | null | undefined): string | null {
  const sizes = model.supported_resolutions ?? [];
  if (!resolution || !sizes.includes(resolution)) return null;
  return sizes.some((s) => s !== "1K") ? resolution : null;
}

/**
 * THE IMAGE TO KEEP FROM A GEMINI RESPONSE — the final render, never a draft.
 *
 * Gemini 3 Pro Image thinks before it draws, and thinking cannot be switched
 * off. Its response can carry up to two INTERIM images ("thought images",
 * `thought: true`) before the final one — Google's own Nano Banana Pro sample
 * skips them (`if part.thought: continue`) before reading `inline_data`. The
 * old reader took the FIRST inlineData part, which is a composition draft
 * whenever the model produced one: a different framing, a changed element, a
 * wrong colour — a lottery the provider never meant to hand out.
 *
 * Rule: the LAST inlineData part that is not a thought. A response with only
 * thought images has no final render and is treated as empty (the run is
 * refunded), never "the best draft we have".
 */
export type GeminiResponsePart = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } };
export type GeminiResponse = {
  candidates?: { finishReason?: string; content?: { parts?: GeminiResponsePart[] } }[];
};
export type GeminiPick = {
  image: { mimeType: string; data: string } | null;
  /** Image parts in the response, drafts included. */
  imageParts: number;
  /** Interim (thought) images the response carried and were NOT kept. */
  thoughtImages: number;
  finishReason: string | null;
};

export function pickGeminiFinalImage(json: GeminiResponse): GeminiPick {
  const cand = json.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const images = parts.filter((p) => p.inlineData?.data);
  const finals = images.filter((p) => p.thought !== true);
  const last = finals[finals.length - 1]?.inlineData;
  return {
    image: last?.data ? { mimeType: last.mimeType || "image/png", data: last.data } : null,
    imageParts: images.length,
    thoughtImages: images.length - finals.length,
    finishReason: cand?.finishReason ?? null,
  };
}

export function buildGeminiImageRequest(model: ModelShape, req: RequestShape): GeminiImagePlan {
  const edit = req.referenceImages.length > 0;
  const aspectRatio = req.aspectRatio === "auto" ? null : req.aspectRatio;
  const imageSize = geminiImageSize(model, req.resolution ?? null);
  const imageConfig: GeminiImageBody["generationConfig"]["imageConfig"] = {};
  const images: GeminiPart[] = req.referenceImages.map((r) => ({ inlineData: { mimeType: r.mime, data: r.base64 } }));
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (imageSize) imageConfig.imageSize = imageSize;
  return {
    operation: edit ? "IMAGE_EDIT" : "IMAGE_GENERATION",
    aspectRatio,
    imageSize,
    body: {
      contents: [{
        role: "user",
        // promptFirst (Retusz): Google's single-image edit example —
        // [prompt, image]. Otherwise the images first, then the prompt.
        parts: req.promptFirst
          ? [{ text: req.prompt }, ...images]
          : [...images, { text: req.prompt }],
      }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig },
    },
  };
}
