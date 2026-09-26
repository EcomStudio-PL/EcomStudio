/**
 * THE ONE STATUS A PROVIDER CARD SHOWS — pure, so the panel and the tests
 * agree on exactly what "Połączono" means.
 *
 *   not_configured  no credential row
 *   error           the key cannot be opened on this server, the last test
 *                   failed, or the most recent REAL call failed after the
 *                   last success and after the last test
 *   connected       the last test (made AFTER the key was last changed)
 *                   read the key through the runtime door and the provider
 *                   accepted it
 *   untested        a key is stored and readable but nothing has proven it
 *
 * A key that merely exists in the database is never "connected".
 */

export type ProviderState = "connected" | "error" | "untested" | "not_configured";

export type CredentialFacts = {
  /** Whether the server can open the stored key (vault copy, or a legacy
   *  ciphertext with its decryption key present). */
  readable: boolean;
  updatedAt: string | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
};

const ts = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export function providerState(c: CredentialFacts | null): { state: ProviderState; reason: string | null } {
  if (!c) return { state: "not_configured", reason: null };
  if (!c.readable) return { state: "error", reason: "key_unreadable" };

  const testedAfterChange = c.lastTestedAt !== null && ts(c.lastTestedAt) >= ts(c.updatedAt);
  const runtimeFailedLast = c.lastErrorAt !== null
    && ts(c.lastErrorAt) > ts(c.lastSuccessAt)
    && ts(c.lastErrorAt) > ts(c.lastTestedAt);
  if (runtimeFailedLast) return { state: "error", reason: `runtime:${c.lastErrorCode ?? "provider_error"}` };

  if (testedAfterChange && c.lastTestStatus === "connected") return { state: "connected", reason: null };
  if (testedAfterChange && c.lastTestStatus && c.lastTestStatus !== "unsupported") {
    return { state: "error", reason: c.lastTestStatus };
  }
  // A provider with no documented probe cannot be "connected" by a test, but
  // real traffic proves it: a success after the last key change counts.
  if (c.lastSuccessAt && ts(c.lastSuccessAt) >= ts(c.updatedAt)) return { state: "connected", reason: "traffic" };
  return { state: "untested", reason: c.lastTestStatus === "unsupported" ? "unsupported" : null };
}

/** Last four characters exactly as stored — never upper-cased (two keys that
 *  differ only in case must not look identical), never more than four. */
export function maskKey(lastFour: string | null): string | null {
  if (!lastFour) return null;
  return `•••• ${lastFour.slice(-4)}`;
}
