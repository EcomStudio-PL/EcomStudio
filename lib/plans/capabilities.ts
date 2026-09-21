/**
 * PLAN CAPABILITIES — one canonical shape for `subscription_plans.features`.
 *
 * THE BUG THIS FILE CLOSES.
 *   Two halves of the app disagreed about what that column holds.
 *
 *     /admin/plans  wrote   ["Nielimitowane produkty", "5 miejsc", …]   ← string[]
 *     /plan         read    { products: 500, workspace_members: 5, … }  ← object
 *
 *   Production holds the OBJECT on all four plans, and `PricingBoard` reads
 *   `capabilities.workspace_members` / `.priority_queue` / `.operator_mode`,
 *   so the object is the real format and the admin editor was the outlier.
 *   Worse than cosmetic: opening a plan in the admin and pressing Save —
 *   changing nothing but the price — replaced the bag with an array, and the
 *   cennik silently lost every capability row for that tier.
 *
 * THE CANONICAL FORMAT.
 *   A BAG of capability -> value. Values are numbers or booleans, never
 *   sentences: a sentence cannot be compared across tiers, translated, or
 *   enforced. Sentences belong in `description` and in the i18n dictionaries.
 *
 *     -1  means UNLIMITED for a numeric capability (this is the convention
 *         already stored on the agency plan: products: -1, members: -1).
 *
 * UNKNOWN KEYS ARE KEPT, NOT DROPPED. A capability may exist in the database
 * before any screen renders it — pruning here would make a deploy order
 * destructive, which is the exact failure mode this file exists to prevent.
 */

/** The value a capability may take. Nothing else survives parsing. */
export type CapabilityValue = number | boolean;

export type PlanCapabilities = Record<string, CapabilityValue>;

/** The capabilities the UI renders today. The bag may legitimately hold more. */
export const KNOWN_NUMERIC_CAPABILITIES = ["products", "workspace_members"] as const;
export const KNOWN_FLAG_CAPABILITIES = ["priority_queue", "operator_mode"] as const;

export type NumericCapability = (typeof KNOWN_NUMERIC_CAPABILITIES)[number];
export type FlagCapability = (typeof KNOWN_FLAG_CAPABILITIES)[number];

/** `-1` is the stored convention for "no limit". */
export const UNLIMITED = -1;

/**
 * Read whatever the column holds and answer with a bag.
 *
 * An ARRAY answers `{}` — deliberately, and this is the one lossy case. A
 * legacy `string[]` carries no capability the UI can render; translating
 * "5 miejsc w zespole" back into `workspace_members: 5` would be guesswork
 * about pricing, which is not a guess this function is allowed to make. The
 * write path (`writableCapabilities`) is what stops an array from ever being
 * stored again; production currently holds none.
 */
export function parsePlanCapabilities(value: unknown): PlanCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PlanCapabilities = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "boolean") { out[key] = raw; continue; }
    if (typeof raw === "number" && Number.isFinite(raw)) { out[key] = raw; continue; }
    // Strings, nulls, nested objects: not a capability. Skipped rather than
    // coerced — `Number("tak")` is NaN and `Boolean("false")` is true, and
    // both would be silently wrong on a pricing page.
  }
  return out;
}

/** A numeric capability, or null when the plan does not declare it. */
export function capabilityNumber(bag: PlanCapabilities, key: string): number | null {
  const v = bag[key];
  return typeof v === "number" ? v : null;
}

/** A flag capability. Absent means off. */
export function capabilityFlag(bag: PlanCapabilities, key: string): boolean {
  return bag[key] === true;
}

/**
 * THE WRITE GUARD. What a save is allowed to put in the column.
 *
 * Returns the bag to store, or `null` meaning "do not touch the column" —
 * which is what a caller must honour when the client sent something that is
 * not a capability bag. That is the same principle as `keepStructuredFields`
 * in lib/services/admin.ts: for a structured column the last word belongs to
 * what is STORED, not to what a form happened to serialise.
 *
 * `stored` is passed so an UPDATE that arrives with an empty bag keeps the
 * capabilities it had. An admin who genuinely wants to withdraw a capability
 * sets it to 0 / false in the editor; a bag that arrives empty is a bug in
 * the caller, and blanking a live pricing page on a bug is not acceptable.
 */
export function writableCapabilities(
  incoming: unknown,
  stored: unknown,
): PlanCapabilities | null {
  if (incoming === undefined) return null;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return null;
  const next = parsePlanCapabilities(incoming);
  if (Object.keys(next).length > 0) return next;
  const current = parsePlanCapabilities(stored);
  return Object.keys(current).length > 0 ? null : next;
}
