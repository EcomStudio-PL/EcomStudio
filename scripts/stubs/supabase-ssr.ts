/**
 * A STAND-IN FOR @supabase/ssr, SO THE MIDDLEWARE CAN BE RUN INSTEAD OF READ.
 *
 * scripts/login-flow-tests.ts needs to ask the real updateSession() what it
 * does with an authenticated visitor standing on a login page — the exact
 * situation that fired a second factor before anybody typed a password. That
 * question cannot be answered by a regex over the source, and it cannot be
 * answered against Supabase either: DEV carries none of the login-security
 * schema and PROD is not a place to rehearse an auth change.
 *
 * So the client is replaced and nothing else is. The middleware's own logic —
 * every branch, in its real order — runs untouched.
 *
 * Set what the fake session and the fake risk verdict should be with
 * __setSession / __setVerdict before each case.
 */
type FakeUser = { id: string } | null;

let user: FakeUser = null;
let verdict: { trusted?: boolean } | null = { trusted: true };
let rpcError: { code: string } | null = null;
/** Every rpc the middleware made, so a test can assert it asked at all. */
export const rpcCalls: { name: string; args: unknown }[] = [];

export function __setSession(next: FakeUser): void { user = next; }
export function __setVerdict(next: { trusted?: boolean } | null): void { verdict = next; }
export function __setRpcError(next: { code: string } | null): void { rpcError = next; }
export function __reset(): void {
  user = null; verdict = { trusted: true }; rpcError = null; rpcCalls.length = 0;
}

type CookieBag = { getAll(): { name: string; value: string }[]; setAll(list: unknown[]): void };

export function createServerClient(
  _url: string,
  _key: string,
  options: { cookies: CookieBag },
) {
  // The real client writes refreshed cookies through this callback. Calling it
  // with nothing keeps the middleware's response-rebuilding path exercised
  // without inventing tokens.
  options.cookies.setAll([]);
  return {
    auth: {
      async getUser() { return { data: { user }, error: null }; },
    },
    async rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      return { data: verdict, error: null };
    },
  };
}
