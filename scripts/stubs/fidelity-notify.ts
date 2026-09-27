/** Test stub: operator notifications are not sent from tests. */
export async function notify(): Promise<void> {}
export function buildDedupeKey(...parts: unknown[]): string { return parts.join(":"); }
