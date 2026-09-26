/** The reasons a seller can attach to a 👍 or 👎. The database accepts exactly
 *  these (generation_feedback_submit, migration 0126) and drops anything else. */
export const LIKE_REASONS = ["good_fidelity", "good_scene", "good_style"] as const;
export const DISLIKE_REASONS = [
  "wrong_product", "bad_scene", "bad_composition", "bad_colors", "too_artificial", "other",
] as const;
