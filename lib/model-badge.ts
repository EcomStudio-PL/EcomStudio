/**
 * MODEL BADGE — the short label an admin attaches to an engine ("Zalecany",
 * "recommended", "high_quality"…).
 *
 * The value is free text typed in the admin panel, so a dictionary entry may
 * or may not exist for it. `makeT` returns the KEY when a lookup misses,
 * which is why `t(key) || badge` never fell back and shipped
 * "MODELS.BADGE.ZALECANY" to customers. Compare against the key instead, and
 * when there is no translation show the admin's own words.
 */
export function modelBadgeLabel(
  badge: string | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  if (!badge) return null;
  const key = `models.badge.${badge}`;
  const translated = t(key);
  return translated === key ? badge : translated;
}
