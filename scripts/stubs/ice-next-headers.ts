import { iceState, type CookieOpts } from "./ice-state";

/** Test-only stand-in for next/headers (ice suite): the request's cookies and
 *  headers come from iceState, and every cookie write is recorded. */

type CookieEntry = { name: string; value: string };

function store() {
  return {
    get(name: string): CookieEntry | undefined {
      const value = iceState.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll(): CookieEntry[] {
      return [...iceState.cookies.entries()].map(([name, value]) => ({ name, value }));
    },
    has(name: string): boolean {
      return iceState.cookies.has(name);
    },
    set(name: string, value: string, opts: CookieOpts = {}): void {
      iceState.cookieWrites.push({ name, value, opts: { ...opts } });
    },
    delete(name: string): void {
      iceState.cookieWrites.push({ name, value: "", opts: { maxAge: 0 } });
    },
  };
}

export async function cookies() {
  if (iceState.cookiesThrow) throw new Error("cookies() outside a request");
  return store();
}

export async function headers() {
  if (iceState.headersThrow) throw new Error("headers() outside a request");
  const h = new Headers();
  for (const [k, v] of iceState.headers) h.set(k, v);
  return h;
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}
