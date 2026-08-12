import "server-only";
import type { ReferenceImage } from "@/lib/ai/types";
import { callVisionJson, type VisionCredential } from "./vision";
import { IMAGE_VIEWS, REFERENCE_ROLES, type FeatureManifest, type ImageAnalysis, type SessionInput } from "./types";

/**
 * IMAGE ANALYSIS ENGINE + PRODUCT FEATURE MANIFEST.
 * One vision call analyses ALL numbered references together — per-image roles
 * need cross-image context (which one is the best primary, which is only a
 * usage infographic) and the manifest needs every angle at once to count
 * buttons, ports, items and accessories reliably.
 */

const S = {
  str: { type: "STRING" },
  bool: { type: "BOOLEAN" },
  int: { type: "INTEGER" },
  strArr: { type: "ARRAY", items: { type: "STRING" } },
} as const;

const IMAGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    image_number: S.int,
    view: { type: "STRING", enum: [...IMAGE_VIEWS] },
    full_product: S.bool,
    product_count: S.int,
    occlusion: { type: "STRING", enum: ["none", "partial", "heavy"] },
    product_quality: { type: "STRING", enum: ["sharp", "usable", "poor"] },
    color_reference: S.bool,
    material_reference: S.bool,
    scale_reference: S.bool,
    dimension_reference: S.bool,
    branding_visibility: { type: "STRING", enum: ["clear", "partial", "none"] },
    text_visibility: { type: "STRING", enum: ["clear", "partial", "none"] },
    usage_reference: S.bool,
    background_complexity: { type: "STRING", enum: ["clean", "moderate", "busy"] },
    critical_features: S.strArr,
    scene_reference_only: S.bool,
    primary_candidate_score: S.int,
    roles: { type: "ARRAY", items: { type: "STRING", enum: [...REFERENCE_ROLES] } },
  },
  required: [
    "image_number", "view", "full_product", "product_count", "occlusion",
    "product_quality", "critical_features", "scene_reference_only",
    "primary_candidate_score", "roles",
  ],
};

const MANIFEST_SCHEMA = {
  type: "OBJECT",
  properties: {
    identity: S.str,
    quantity: S.int,
    variant: S.str,
    primary_color: S.str,
    secondary_colors: S.strArr,
    geometry: {
      type: "OBJECT",
      properties: {
        shape: S.str, proportions: S.str, profile: S.str, curvature: S.str,
        major_components: S.strArr,
      },
      required: ["shape", "proportions", "major_components"],
    },
    materials: S.strArr,
    interfaces: {
      type: "OBJECT",
      properties: {
        buttons: S.int, buttons_detail: S.str, switches: S.int, ports: S.int,
        ports_detail: S.str, sockets: S.int, screens: S.int, leds: S.int,
        labels: S.strArr,
      },
      required: ["buttons", "switches", "ports", "screens", "labels"],
    },
    branding: {
      type: "OBJECT",
      properties: { logos: S.strArr, text: S.strArr, position: S.str },
      required: ["logos", "text"],
    },
    accessories: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: S.str, count: S.int, color: S.str },
        required: ["name", "count"],
      },
    },
    scale: {
      type: "OBJECT",
      properties: {
        dimensions: S.str,
        confidence: { type: "STRING", enum: ["high", "medium", "low"] },
        scale_reference: S.str,
      },
      required: ["confidence"],
    },
    critical_features: S.strArr,
  },
  required: [
    "identity", "quantity", "primary_color", "geometry", "materials",
    "interfaces", "branding", "accessories", "scale", "critical_features",
  ],
};

const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    images: { type: "ARRAY", items: IMAGE_SCHEMA },
    manifest: MANIFEST_SCHEMA,
  },
  required: ["images", "manifest"],
};

const SYSTEM = `You are the reference-analysis engine of a product photography platform.
You receive numbered product reference photos (image 1 = first attached image, in order) plus seller-provided text.
Your job: understand the MANUFACTURED PRODUCT exactly as it physically exists.

Rules:
- Analyse EVERY image. image_number is its 1-based position.
- COUNT things. Prefer "exactly 2 identical walkie-talkies" over "a walkie-talkie set". Count buttons, ports, screens, LEDs, items, accessories. If a count is not visible, use the seller text; if still unknown use 0 and do not invent.
- An image that shows only usage context, an infographic, a size chart or packaging render must get scene_reference_only=true — it may inspire scenes but must never redefine the product.
- primary_candidate_score (0-100) rates how well the image shows the product's full geometry and identity: full product, sharp, front or three-quarter view, low occlusion score highest.
- critical_features are identification-critical visual facts (colors, button layout, logo position, antenna count, port arrangement...).
- The manifest merges ALL images + seller text into one set of verifiable facts about the product. Never describe anything you cannot see or read in the provided material.
- quantity = how many identical main products form the sold unit (a 2-pack = 2).`;

export async function analyzeReferences(
  cred: VisionCredential,
  images: ReferenceImage[],
  info: SessionInput,
  model?: string
): Promise<{ images: ImageAnalysis[]; manifest: FeatureManifest }> {
  const user = [
    `Product name: ${info.productName}`,
    info.description ? `Seller description / marketplace listing:\n${info.description.slice(0, 4000)}` : "",
    info.extraInfo ? `Additional information:\n${info.extraInfo.slice(0, 2500)}` : "",
    `\nAttached: ${images.length} reference image(s), numbered 1..${images.length} in attachment order.`,
    `Return the per-image analysis for all ${images.length} images and the merged product feature manifest.`,
  ].filter(Boolean).join("\n");

  const out = await callVisionJson<{ images: ImageAnalysis[]; manifest: FeatureManifest }>({
    cred, images, system: SYSTEM, user, schema: ANALYSIS_SCHEMA, model,
  });

  // Defensive normalisation — the engine downstream relies on these shapes.
  const seen = new Set<number>();
  const perImage = (out.images ?? [])
    .filter((a) => {
      const n = Math.trunc(a.image_number);
      if (n < 1 || n > images.length || seen.has(n)) return false;
      seen.add(n);
      return true;
    })
    .sort((a, b) => a.image_number - b.image_number);
  return { images: perImage, manifest: out.manifest };
}
