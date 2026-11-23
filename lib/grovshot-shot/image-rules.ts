/**
 * GROVBASE SHOT — WHICH FLAG RULES REACH THE IMAGE MODEL (23.11.2026).
 *
 * The audit of 23.11.2026: the active knowledge base (v4.2) had 13 flags with
 * full rules for the text steps but NO image block, and prompt B passed a
 * flag on only when it had a block AND was on a short list that did not even
 * name `ekran`, `drabinka`, `kojec` or `raczki`. So the rules that decide the
 * LCD layout, the number of steps, the panels of a pen or the spikes on both
 * shoes never reached Nano Banana Pro in words — only Claude read them.
 *
 * The knowledge base now carries one SHORT image block per flag ("#### Blok
 * do promptu", its first paragraph — kb.ts) and this table says which of them
 * the image model receives, in which module and in which shot pattern:
 *
 *   critical  geometry or legible content the photos must keep (always in,
 *             ahead of the scene: [REGUŁY PRODUKTU]);
 *   geometry  construction / material the model tends to "normalise";
 *   scene     how the scene behaves around the product (in [SCENA]);
 *   excluded  measured to re-light or re-colour the product (13.11.2026:
 *             `swieci`, `elektronika`) — kept out until an A/B says otherwise.
 *
 * A flag this table does not name is not sent (`not_reviewed`): only blocks
 * someone looked at reach the image model. The whole rule text never does —
 * it stays with the text steps. Pure.
 */

export type ImageRuleRole = "critical" | "geometry" | "scene" | "excluded";
export type ImageRulePolicy = {
  role: ImageRuleRole;
  /** Also in a DETAIL shot (a close-up copied from one photo). */
  detail: boolean;
  /** Why an excluded flag stays out (recorded with the prompt). */
  reason?: string;
};

export const FLAG_IMAGE_POLICY: Readonly<Record<string, ImageRulePolicy>> = {
  // Legible content / count-bearing geometry: the four categories of the audit.
  ekran: { role: "critical", detail: true },
  drabinka: { role: "critical", detail: false },
  kojec: { role: "critical", detail: false },
  raczki: { role: "critical", detail: false },
  // Construction and material.
  siatka: { role: "geometry", detail: true },
  szklo: { role: "geometry", detail: true },
  miekki: { role: "geometry", detail: false },
  reczne_wielotrybowe: { role: "geometry", detail: false },
  meble_skladane: { role: "geometry", detail: false },
  wnetrze: { role: "geometry", detail: false },
  // The scene around the product (as prompt B kept them since 13.11).
  cieplo: { role: "scene", detail: false },
  mgielka: { role: "scene", detail: false },
  pastelowy: { role: "scene", detail: false },
  sezonowy: { role: "scene", detail: false },
  sezon_uzycia: { role: "scene", detail: false },
  dla_zwierzat: { role: "scene", detail: false },
  pasywny: { role: "scene", detail: false },
  // Re-light / re-colour the product (diagnosis of 13.11.2026).
  swieci: { role: "excluded", detail: false, reason: "recolor_risk" },
  elektronika: { role: "excluded", detail: false, reason: "recolor_risk" },
};

/** The categories whose image block must exist in a knowledge base that carries image blocks. */
export const CRITICAL_IMAGE_FLAGS = Object.entries(FLAG_IMAGE_POLICY).filter(([, p]) => p.role === "critical").map(([f]) => f);

/** One flag block, in words (whole sentences; the candidate v4.3 is ≤ 43). */
export const IMAGE_BLOCK_MAX_WORDS = 60;
/** All non-critical flag blocks of one shot together (≈ 3 blocks); critical ones are never dropped for length.
 *  A real card carries 1–3 flags and never meets it; it keeps a 13-flag card from burying the photos in text. */
export const IMAGE_RULES_MAX_WORDS = 90;

export const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** Sentences end at . ! ? followed by a capital letter — "ok. 3 m", "np. kubek" stay whole. */
const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ„"])/).map((x) => x.trim()).filter(Boolean);

/** Whole sentences up to `max` words; the first sentence is kept whole (never cut mid-sentence). */
export function capWords(t: string, max: number): string {
  const out: string[] = [];
  let n = 0;
  for (const x of sentences(t)) {
    const w = words(x);
    if (out.length > 0 && n + w > max) break;
    out.push(x);
    n += w;
  }
  return out.join(" ");
}

export type IncludedImageRule = { flag: string; role: Exclude<ImageRuleRole, "excluded">; words: number; trimmed: boolean; text: string };
export type DroppedImageRule = {
  flag: string;
  reason: "not_reviewed" | "recolor_risk" | "not_for_detail" | "no_image_block_in_kb" | "flag_not_in_kb" | "budget" | string;
};
export type ImageRuleSelection = {
  /** Every flag of the card, in the card's order. */
  active: string[];
  included: IncludedImageRule[];
  dropped: DroppedImageRule[];
};

const ORDER: Record<Exclude<ImageRuleRole, "excluded">, number> = { critical: 0, geometry: 1, scene: 2 };

/**
 * The flag blocks one shot sends, in authority order (critical → geometry →
 * scene, then the card's own order), each capped to whole sentences, the
 * non-critical ones within a shared word budget; every flag left out is
 * recorded with its reason.
 */
export function selectImageRules(
  special: readonly { flag: string; block: string | null }[],
  flags: readonly string[],
  pattern: "full" | "detail",
): ImageRuleSelection {
  const active = [...new Set(flags)];
  const dropped: DroppedImageRule[] = [];
  const candidates: (IncludedImageRule & { at: number })[] = [];
  active.forEach((flag, at) => {
    const sp = special.find((s) => s.flag === flag);
    const policy = FLAG_IMAGE_POLICY[flag];
    if (!sp) { dropped.push({ flag, reason: "flag_not_in_kb" }); return; }
    if (!policy) { dropped.push({ flag, reason: "not_reviewed" }); return; }
    if (policy.role === "excluded") { dropped.push({ flag, reason: policy.reason ?? "excluded" }); return; }
    if (pattern === "detail" && !policy.detail) { dropped.push({ flag, reason: "not_for_detail" }); return; }
    const raw = (sp.block ?? "").replace(/\s+/g, " ").trim();
    if (!raw) { dropped.push({ flag, reason: "no_image_block_in_kb" }); return; }
    const text = capWords(raw, IMAGE_BLOCK_MAX_WORDS);
    candidates.push({ flag, role: policy.role, words: words(text), trimmed: text !== raw, text, at });
  });
  candidates.sort((a, b) => ORDER[a.role] - ORDER[b.role] || a.at - b.at);
  const included: IncludedImageRule[] = [];
  let budget = 0;
  for (const c of candidates) {
    if (c.role !== "critical" && budget + c.words > IMAGE_RULES_MAX_WORDS) { dropped.push({ flag: c.flag, reason: "budget" }); continue; }
    if (c.role !== "critical") budget += c.words;
    included.push({ flag: c.flag, role: c.role, words: c.words, trimmed: c.trimmed, text: c.text });
  }
  return { active, included, dropped };
}

/** For an admin's import check: what a knowledge base would send for its critical flags. */
export function imageBlockIssues(special: readonly { flag: string; block: string | null }[]): { code: string; detail: string }[] {
  const out: { code: string; detail: string }[] = [];
  const carries = special.some((s) => Boolean(s.block));
  for (const flag of CRITICAL_IMAGE_FLAGS) {
    const sp = special.find((s) => s.flag === flag);
    if (sp && !sp.block) out.push({ code: carries ? "image_block_missing" : "image_blocks_absent", detail: flag });
  }
  for (const s of special) {
    if (s.block && words(s.block) > IMAGE_BLOCK_MAX_WORDS) out.push({ code: "image_block_too_long", detail: `${s.flag}: ${words(s.block)} słów (do modelu obrazu trafi ${IMAGE_BLOCK_MAX_WORDS})` });
  }
  return out;
}
