import "server-only";
import type { AiModelRecord, GenerationRequest, GenerationResult, ImageProviderAdapter, ProviderCredential } from "../types";
import { ProviderError } from "../types";

/** Google Gemini image generation (gemini-2.5-flash-image family) via the
 *  REST generateContent endpoint. Reference images go inline as base64;
 *  the model returns inline base64 images. One image per call — quantity
 *  is handled by sequential calls so a partial failure can still refund. */
export const googleAdapter: ImageProviderAdapter = {
  slug: "google",
  capabilities: { resolutions: [], maxQuantity: 4, supportsReferenceImages: true },

  async generate(model: AiModelRecord, req: GenerationRequest, cred: ProviderCredential): Promise<GenerationResult> {
    const base = cred.baseUrl?.replace(/\/$/, "") || "https://generativelanguage.googleapis.com";
    const url = `${base}/v1beta/models/${model.model_identifier}:generateContent?key=${encodeURIComponent(cred.apiKey)}`;

    const parts: Record<string, unknown>[] = [
      ...req.referenceImages.map((r) => ({ inlineData: { mimeType: r.mime, data: r.base64 } })),
      { text: `${req.prompt}\n\n${req.productLock.fidelityInstructions}` },
    ];

    // Gemini 3 image models accept an explicit output size; the 2.5 flash
    // image model only knows aspect ratio.
    const imageConfig: Record<string, unknown> = { aspectRatio: req.aspectRatio };
    if (req.resolution && (model.supported_resolutions ?? []).includes(req.resolution) && req.resolution !== "1K") {
      imageConfig.imageSize = req.resolution;
    }

    const images: GenerationResult["images"] = [];
    for (let i = 0; i < req.quantity; i++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig,
          },
        }),
        signal: AbortSignal.timeout(90_000),
      }).catch((e) => {
        throw new ProviderError(e?.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable", true);
      });
      if (res.status === 401 || res.status === 403) throw new ProviderError("provider_auth_failed");
      if (res.status === 429) throw new ProviderError("provider_rate_limited", true);
      if (!res.ok) throw new ProviderError("provider_error", res.status >= 500);
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
      };
      const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (!inline?.data) throw new ProviderError("provider_empty_result");
      images.push({ base64: inline.data, mime: inline.mimeType || "image/png" });
    }
    return { images };
  },
};
