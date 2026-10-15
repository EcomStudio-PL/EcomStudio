/**
 * Shared, mutable state for the ice suite's stubs (npm run test:ice). The
 * test and every stub import this one module, so they see the same object:
 * the cookies and headers a "request" carries, who is signed in, what the
 * fake database holds, and a record of every side effect (cookie writes,
 * revalidations, audit rows).
 */

export type CookieOpts = { path?: string; maxAge?: number; expires?: unknown; httpOnly?: boolean; sameSite?: string; secure?: boolean };
export type CookieWrite = { name: string; value: string; opts: CookieOpts };
export type AuditRow = { actorId: string; action: string; entityType?: string; entityId?: string; before?: unknown; after?: unknown };

export type IceState = {
  /** Cookies the request carries (name → value). */
  cookies: Map<string, string>;
  /** cookies() throws when set. */
  cookiesThrow: boolean;
  /** Request headers (lower-case names). */
  headers: Map<string, string>;
  /** headers() throws when set. */
  headersThrow: boolean;
  /** Every cookie the code under test set. */
  cookieWrites: CookieWrite[];
  /** revalidateTag / revalidatePath calls, as "tag:<t>" / "path:<p>". */
  revalidated: string[];
  /** logAudit calls. */
  audits: AuditRow[];
  /** What createClient() (lib/supabase/server) hands out. */
  client: unknown;
  /** createClient() throws when set. */
  clientThrow: boolean;
  /** viewerIsAdmin() answer (lib/server/feature-availability stub). */
  viewerAdmin: boolean;
  /** viewerIsAdmin() throws when set. */
  viewerAdminThrow: boolean;
  /** enforceLoginSecurity() answer: null = verified device. */
  stepUp: string | null;
  /** How many times enforceLoginSecurity() was asked. */
  stepUpCalls: number;
  /** The anonymous client's rpc (lib/server/ice/overrides.ts readBag). */
  anonRpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
  /** Names the anonymous client was asked for. */
  anonCalls: string[];
};

export const iceState: IceState = {
  cookies: new Map(),
  cookiesThrow: false,
  headers: new Map(),
  headersThrow: false,
  cookieWrites: [],
  revalidated: [],
  audits: [],
  client: null,
  clientThrow: false,
  viewerAdmin: false,
  viewerAdminThrow: false,
  stepUp: null,
  stepUpCalls: 0,
  anonRpc: async () => ({ data: [], error: null }),
  anonCalls: [],
};

/** Back to "a visitor's request, nothing recorded". */
export function resetIceState(): void {
  iceState.cookies = new Map();
  iceState.cookiesThrow = false;
  iceState.headers = new Map();
  iceState.headersThrow = false;
  iceState.cookieWrites = [];
  iceState.revalidated = [];
  iceState.audits = [];
  iceState.client = null;
  iceState.clientThrow = false;
  iceState.viewerAdmin = false;
  iceState.viewerAdminThrow = false;
  iceState.stepUp = null;
  iceState.stepUpCalls = 0;
  iceState.anonRpc = async () => ({ data: [], error: null });
  iceState.anonCalls = [];
}
