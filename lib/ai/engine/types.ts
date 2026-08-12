/**
 * IMAGE ENGINE V2 — structured data flowing through the pipeline:
 * reference analysis → Product Feature Manifest → Product Lock →
 * scene strategy → 5 prompts. The SCENE is creative; the PRODUCT is not.
 */

export const IMAGE_VIEWS = [
  "front", "rear", "left", "right", "side", "top", "bottom",
  "three_quarter", "macro", "detail", "unknown",
] as const;
export type ImageView = (typeof IMAGE_VIEWS)[number];

export const REFERENCE_ROLES = [
  "MAIN_GEOMETRY", "FRONT_DETAIL", "SIDE_PROFILE", "BACK_DETAIL", "MATERIAL",
  "BUTTON_LAYOUT", "PORT_LAYOUT", "BRANDING", "DIMENSIONS", "SCALE",
  "ACCESSORIES", "USAGE", "COLOR", "MECHANISM", "SCENE_ONLY",
] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

/** Structured analysis of ONE uploaded reference image (1-based number). */
export type ImageAnalysis = {
  image_number: number;
  view: ImageView;
  full_product: boolean;
  product_count: number;
  occlusion: "none" | "partial" | "heavy";
  product_quality: "sharp" | "usable" | "poor";
  color_reference: boolean;
  material_reference: boolean;
  scale_reference: boolean;
  dimension_reference: boolean;
  branding_visibility: "clear" | "partial" | "none";
  text_visibility: "clear" | "partial" | "none";
  usage_reference: boolean;
  background_complexity: "clean" | "moderate" | "busy";
  critical_features: string[];
  /** Infographic / usage-only image — may inspire the scene but must NEVER redefine the product. */
  scene_reference_only: boolean;
  /** 0-100: how good this image is as the PRIMARY geometry/identity reference. */
  primary_candidate_score: number;
  roles: ReferenceRole[];
};

/** Countable, verifiable product facts. "exactly 2 identical walkie-talkies",
 *  not "a walkie-talkie set". */
export type FeatureManifest = {
  identity: string;
  quantity: number;
  variant: string | null;
  primary_color: string;
  secondary_colors: string[];
  geometry: {
    shape: string;
    proportions: string;
    profile: string;
    curvature: string;
    major_components: string[];
  };
  materials: string[];
  interfaces: {
    buttons: number;
    buttons_detail: string | null;
    switches: number;
    ports: number;
    ports_detail: string | null;
    sockets: number;
    screens: number;
    leds: number;
    labels: string[];
  };
  branding: {
    logos: string[];
    text: string[];
    position: string | null;
  };
  accessories: { name: string; count: number; color: string | null }[];
  scale: {
    dimensions: string | null;
    confidence: "high" | "medium" | "low";
    scale_reference: string | null;
  };
  critical_features: string[];
};

export type LockLevel = "HARD" | "STRONG" | "SOFT";
export type LockStrength = "STANDARD" | "STRONG" | "MAXIMUM";

/** Product Lock as data: constraints grouped by severity. Rendered into the
 *  master prompt AND stored on the session for auditability. */
export type ProductLock = {
  hard: string[];
  strong: string[];
  soft: string[];
};

export const SCENE_TYPES = [
  "product_hero", "premium_lifestyle", "product_in_use", "functional_demo",
  "closeup", "macro_detail", "scale_demo", "technical_detail", "benefit_shot",
  "marketplace_hero", "social_ad", "workspace_scene", "home_lifestyle",
  "outdoor_lifestyle", "gift_scene", "family_scene", "professional_use",
  "accessories_layout", "premium_packshot",
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export type SupportingReference = { image: number; role: ReferenceRole; reason: string };

/** One of the five scene concepts. Everything here is CREATIVE freedom —
 *  environment, light, composition, humans — never the product itself. */
export type SceneConcept = {
  scene_type: SceneType;
  title: string;
  scene_description: string;
  environment: string;
  camera_distance: "wide" | "medium" | "close" | "macro";
  camera_angle: string;
  lighting: string;
  human_presence: boolean;
  /** When a human appears: the EXACT grip/interaction, not "holding product". */
  human_interaction: string | null;
  product_placement: string;
  /** How the product physically touches the world (surface, hand, mount). */
  physical_contact: string;
  product_orientation: string;
  marketing_purpose: string;
  /** Views of the product this scene requires to be visible. */
  required_views: ImageView[];
  primary_reference: number;
  supporting_references: SupportingReference[];
  product_specific_negatives: string[];
};

export type SessionInput = {
  productName: string;
  description: string | null;
  extraInfo: string | null;
  style: string | null;
  aspectRatio: string;
};
