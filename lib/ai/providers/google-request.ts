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
type RequestShape = Pick<GenerationRequest, "prompt" | "aspectRatio" | "resolution" | "referenceImages" | "promptFirst" | "strictSingleImage">;

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
  /** Candidates in the response (only the first is ever read). */
  candidates: number;
  /** Every part of the first candidate, as flags only — no text, no bytes. */
  parts: { text: boolean; thought: boolean; inlineData: boolean; mimeType: string | null }[];
  /** Index in `parts` of the image kept, or null when none was. */
  pickedPartIndex: number | null;
};

export function pickGeminiFinalImage(json: GeminiResponse): GeminiPick {
  const cand = json.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  let picked: number | null = null;
  parts.forEach((p, i) => { if (p.inlineData?.data && p.thought !== true) picked = i; });
  const images = parts.filter((p) => p.inlineData?.data);
  const finals = images.filter((p) => p.thought !== true);
  const last = picked === null ? undefined : parts[picked]?.inlineData;
  return {
    image: last?.data ? { mimeType: last.mimeType || "image/png", data: last.data } : null,
    imageParts: images.length,
    thoughtImages: images.length - finals.length,
    finishReason: cand?.finishReason ?? null,
    candidates: json.candidates?.length ?? 0,
    parts: parts.map((p) => ({
      text: typeof p.text === "string", thought: p.thought === true,
      inlineData: Boolean(p.inlineData?.data), mimeType: p.inlineData?.mimeType ?? null,
    })),
    pickedPartIndex: picked,
  };
}

/**
 * The Retusz request contract, on a built body: exactly one user content with
 * exactly [ { text === req.prompt }, { inlineData === the one input image } ],
 * top-level keys contents + generationConfig only, generationConfig keys
 * responseModalities + imageConfig only, imageConfig ⊆ {aspectRatio, imageSize}.
 * Returns the first violation, or null.
 */
export function retouchContractViolation(
  body: GeminiImageBody,
  req: Pick<GenerationRequest, "prompt" | "referenceImages">,
): string | null {
  const keys = (o: object) => Object.keys(o).sort().join(",");
  if (keys(body) !== "contents,generationConfig") return "top_level_fields";
  if (body.contents.length !== 1) return "contents_count";
  const c = body.contents[0]!;
  if (c.role !== "user") return "role";
  if (req.referenceImages.length !== 1) return "input_image_count";
  const texts = c.parts.filter((p) => "text" in p);
  const images = c.parts.filter((p) => "inlineData" in p);
  if (c.parts.length !== 2 || texts.length !== 1 || images.length !== 1) return "parts_count";
  if (!("text" in c.parts[0]!) || !("inlineData" in c.parts[1]!)) return "parts_order";
  if ((c.parts[0] as { text: string }).text !== req.prompt) return "prompt_mismatch";
  const img = (c.parts[1] as { inlineData: { mimeType: string; data: string } }).inlineData;
  if (img.data !== req.referenceImages[0]!.base64 || img.mimeType !== req.referenceImages[0]!.mime) return "image_mismatch";
  if (keys(body.generationConfig) !== "imageConfig,responseModalities") return "generation_config_fields";
  if (JSON.stringify(body.generationConfig.responseModalities) !== '["IMAGE"]') return "response_modalities";
  if (Object.keys(body.generationConfig.imageConfig).some((k) => k !== "aspectRatio" && k !== "imageSize")) return "image_config_fields";
  return null;
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

/* ── RETUSZ: the Interactions API ────────────────────────────────────────── */

/**
 * RETUSZ GOES THROUGH THE INTERACTIONS API — one stateless call.
 *
 * Google's current primary API for Gemini (gemini-skills `gemini-api-dev`,
 * 2026-09; the Nano Banana cookbook edits images through
 * `client.interactions.create`). Retusz is the only caller; every other tool
 * keeps generateContent above.
 *
 * The body is the minimum the official image-editing example sends:
 *   model               gemini-3-pro-image
 *   input               [ {type:"text", text: PROMPT}, {type:"image", data, mime_type} ]
 *                       — the cookbook's order for an edit: the instruction,
 *                       then the photo
 *   response_modalities ["image"] — "if you only want an image" (cookbook)
 *   store               false — interactions are STORED by default; false
 *                       opts out and makes previous_interaction_id impossible
 * and, LAST (so every byte before it is the pre-2K/4K request unchanged):
 *   response_format     {type:"image", image_size: "2K"|"4K", aspect_ratio?}
 *                       — the official image output config (SDK 2.25
 *                       ImageResponseFormat). aspect_ratio is OMITTED for
 *                       "Oryginalny" (the photo's own shape); otherwise the
 *                       ratio the customer picked, never a derived one.
 * Nothing else: no previous_interaction_id, system_instruction,
 * generation_config, tools, safety_settings or labels. The size and ratio
 * never enter the prompt.
 */
export const INTERACTIONS_PATH = "/v1beta/interactions";
/** REST revision the official migration checklist says to send
 *  (`Api-Revision`; the same value is google-genai's GOOGLE_GENAI_API_REVISION). */
export const INTERACTIONS_API_REVISION = "2026-05-20";

/** The output sizes Retusz may request — the customer picks one; 1K is not
 *  offered and is never sent. */
export const RETOUCH_IMAGE_SIZES = ["2K", "4K"] as const;

export type RetouchResponseFormat = { type: "image"; image_size: string; aspect_ratio?: string };

export type RetouchInteractionBody = {
  model: string;
  input: [{ type: "text"; text: string }, { type: "image"; data: string; mime_type: string }];
  response_modalities: ["image"];
  store: false;
  response_format?: RetouchResponseFormat;
};

type RetouchRequestShape = Pick<GenerationRequest, "prompt" | "referenceImages"> & Partial<Pick<GenerationRequest, "resolution" | "aspectRatio">>;

const isRetouchSize = (s: unknown): s is string => (RETOUCH_IMAGE_SIZES as readonly unknown[]).includes(s);

export function buildRetouchInteraction(
  model: Pick<AiModelRecord, "model_identifier">,
  req: RetouchRequestShape,
): RetouchInteractionBody {
  const image = req.referenceImages[0];
  const body: RetouchInteractionBody = {
    model: model.model_identifier,
    input: [
      { type: "text", text: req.prompt },
      { type: "image", data: image?.base64 ?? "", mime_type: image?.mime ?? "" },
    ],
    response_modalities: ["image"],
    store: false,
  };
  // The output config, appended after `store`: the chosen size, and the
  // chosen ratio unless "Oryginalny" (auto) — then the field is absent.
  if (isRetouchSize(req.resolution)) {
    body.response_format = req.aspectRatio && req.aspectRatio !== "auto"
      ? { type: "image", image_size: req.resolution, aspect_ratio: req.aspectRatio }
      : { type: "image", image_size: req.resolution };
  }
  return body;
}

/**
 * The Retusz contract, checked on the body AS SERIALISED (the string about to
 * be sent, parsed back): exactly {model, input, response_modalities, store}
 * plus — only when a 2K/4K size was chosen — `response_format`, store false,
 * input exactly [the prompt byte for byte, the one image byte for byte].
 * response_format must be exactly {type:"image", image_size: the chosen size}
 * plus aspect_ratio === the chosen ratio (one of the official ones), or no
 * aspect_ratio for "Oryginalny". A ratio that cannot be sent is a violation,
 * never silently dropped. Returns the first violation, or null.
 */
export function retouchInteractionViolation(
  body: Record<string, unknown>,
  req: RetouchRequestShape,
  modelIdentifier: string,
): string | null {
  const sized = isRetouchSize(req.resolution);
  const ratio = req.aspectRatio && req.aspectRatio !== "auto" ? req.aspectRatio : null;
  const fields = sized ? "input,model,response_format,response_modalities,store" : "input,model,response_modalities,store";
  if (Object.keys(body).sort().join(",") !== fields) return "top_level_fields";
  if (body.model !== modelIdentifier) return "model";
  if (body.store !== false) return "store";
  if (JSON.stringify(body.response_modalities) !== '["image"]') return "response_modalities";
  if (ratio && !sized) return "aspect_ratio";
  if (sized) {
    const rf = body.response_format;
    if (!rf || typeof rf !== "object" || Array.isArray(rf)) return "response_format";
    const f = rf as Record<string, unknown>;
    if (Object.keys(f).sort().join(",") !== (ratio ? "aspect_ratio,image_size,type" : "image_size,type")) return "response_format";
    if (f.type !== "image") return "response_format";
    if (f.image_size !== req.resolution) return "image_size";
    if (ratio && (f.aspect_ratio !== ratio || !GEMINI_IMAGE_ASPECT_RATIOS.includes(ratio as AspectRatio))) return "aspect_ratio";
  }
  if (req.referenceImages.length !== 1) return "input_image_count";
  const input = body.input;
  if (!Array.isArray(input) || input.length !== 2) return "input_count";
  const [text, image] = input as Record<string, unknown>[];
  if (text?.type !== "text" || image?.type !== "image") return "input_order";
  if (Object.keys(text).sort().join(",") !== "text,type") return "text_fields";
  if (Object.keys(image).sort().join(",") !== "data,mime_type,type") return "image_fields";
  if (text.text !== req.prompt) return "prompt_mismatch";
  if (image.data !== req.referenceImages[0]!.base64 || image.mime_type !== req.referenceImages[0]!.mime) return "image_mismatch";
  return null;
}

/**
 * The image to keep from an interaction — the official SDK's `output_image`
 * rule (google-genai 2.25 / @google/genai 2.24): walking the steps back to the
 * last `user_input`, the LAST `image` inside a `model_output` step. Interim
 * images live in `thought` steps and are never kept. A response without a
 * final image is empty (the run is refunded).
 */
export type InteractionResponse = {
  status?: string;
  steps?: { type?: string; content?: { type?: string; data?: string; mime_type?: string; text?: string }[]; summary?: { type?: string }[] }[];
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
};
export type InteractionPick = {
  image: { mimeType: string; data: string } | null;
  status: string | null;
  steps: { type: string; content: { type: string; mimeType: string | null }[] }[];
  /** [step index, content index] of the image kept. */
  picked: [number, number] | null;
  /** Images seen in model_output steps, and in thought steps (never kept). */
  outputImages: number;
  thoughtImages: number;
};

export function pickInteractionFinalImage(json: InteractionResponse): InteractionPick {
  const steps = json.steps ?? [];
  let picked: [number, number] | null = null;
  for (let i = steps.length - 1; i >= 0 && !picked; i--) {
    const step = steps[i]!;
    if (step.type === "user_input") break;
    if (step.type !== "model_output" || !step.content) continue;
    for (let j = step.content.length - 1; j >= 0; j--) {
      if (step.content[j]?.type === "image" && step.content[j]?.data) { picked = [i, j]; break; }
    }
  }
  const content = picked ? steps[picked[0]]!.content![picked[1]]! : null;
  let outputImages = 0, thoughtImages = 0;
  for (const s of steps) {
    if (s.type === "model_output") outputImages += (s.content ?? []).filter((c) => c.type === "image").length;
    if (s.type === "thought") thoughtImages += (s.summary ?? []).filter((c) => c.type === "image").length;
  }
  return {
    image: content?.data ? { mimeType: content.mime_type || "image/png", data: content.data } : null,
    status: json.status ?? null,
    steps: steps.map((s) => ({
      type: s.type ?? "?",
      content: [...(s.content ?? []), ...(s.summary ?? [])].map((c) => ({ type: c.type ?? "?", mimeType: (c as { mime_type?: string }).mime_type ?? null })),
    })),
    picked,
    outputImages,
    thoughtImages,
  };
}
