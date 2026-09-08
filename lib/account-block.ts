/**
 * TEMPORARY BLOCK — the durations an operator can pick, in one place.
 *
 * Shared by the modal that offers them and by the tests that check the maths,
 * so "24 hours" cannot come to mean two different things on two screens.
 *
 * The presets are relative because that is how the decision is made — "give
 * them a day to answer the e-mail" — and the absolute instant is computed once,
 * at the moment of the click, from the operator's clock. The server then
 * validates it (not in the past, not more than a year out) before it lands.
 */

export const BLOCK_PRESETS = [
  { key: "1h", hours: 1 },
  { key: "24h", hours: 24 },
  { key: "3d", hours: 72 },
  { key: "7d", hours: 168 },
] as const;

export type BlockPreset = (typeof BLOCK_PRESETS)[number]["key"] | "custom";

/**
 * The instant a block should lift, or null when the form cannot answer yet.
 *
 * `custom` comes from a `datetime-local` input, which the browser parses in the
 * VIEWER's zone — the zone the operator is thinking in. A value in the past, or
 * an unparseable one, returns null so the caller can keep the button disabled
 * rather than send the server something it will refuse.
 */
export function blockUntilIso(preset: BlockPreset, customAt: string, now = new Date()): string | null {
  if (preset === "custom") {
    if (!customAt.trim()) return null;
    const at = new Date(customAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return null;
    return at.toISOString();
  }
  const found = BLOCK_PRESETS.find((p) => p.key === preset);
  if (!found) return null;
  return new Date(now.getTime() + found.hours * 3_600_000).toISOString();
}

/** Is a stored block still in force? The same rule the server and the database
 *  use — an expiry that has passed is not a block, sweep or no sweep. */
export function blockInForce(blocked: boolean, until: string | null, now = new Date()): boolean {
  if (!blocked) return false;
  if (!until) return true;
  return new Date(until).getTime() > now.getTime();
}
