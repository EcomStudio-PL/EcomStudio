/**
 * PUBLICATION IS NOT READINESS.
 *
 * Two questions decide what a customer gets from a tool, and they used to be
 * answered with the same word:
 *
 *   published?  the operator's status in "Narzędzia i silniki" (the
 *               feature_availability switchboard): Aktywny, Wkrótce, Prace
 *               techniczne, Wyłączony. It alone decides whether a card says
 *               "Wkrótce" and whether its door opens.
 *   ready?      whether the tool can run right now — toolCatalogue's verdict
 *               (lib/server/image-tools.ts): a provider key, the service
 *               catalogue's own switches.
 *
 * A published tool whose provider is simply not wired yet (no key, or only a
 * test key) is WAITING, not "coming soon": its card stays open and unbadged,
 * and its own screen says, honestly, that it cannot run yet — the run API
 * refuses before a credit moves. Only a switch an operator flipped on purpose
 * in the service catalogue (disabled / maintenance) still closes the card, with
 * its own words, never "Wkrótce".
 */

/** A catalogue verdict, as the customer surfaces receive it. */
export type ReadinessState = { available: boolean; reason: string | null } | null | undefined;

/** Reasons that only say the provider is not wired up yet. */
export const WAITING_REASONS: readonly string[] = ["no_provider", "sandbox"];

/** Published but waiting for its provider: the door stays open, the screen explains. */
export function waitingForProvider(state: ReadinessState): boolean {
  return Boolean(state && !state.available && state.reason && WAITING_REASONS.includes(state.reason));
}

/** Does readiness itself close the card? Only an operator's service switch does. */
export function readinessCloses(state: ReadinessState): boolean {
  return Boolean(state && !state.available && !waitingForProvider(state));
}
