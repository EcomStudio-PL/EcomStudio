/**
 * Test-only stand-in for next/server, next/headers, next/cache and nodemailer
 * (scripts/prelaunch-server-tests.ts). Everything a handler would hand to the
 * framework or to the network is RECORDED on one global the suite reads back:
 *
 *  · after(fn)       → queued, run by the suite when it says so — so a test can
 *                      assert what happens after the response was built;
 *  · cookies/headers → served from the suite's request state;
 *  · revalidate*     → recorded; unstable_cache passes straight through, so a
 *                      changed fake answer is seen by the next read;
 *  · nodemailer      → createTransport().sendMail records the message (or
 *                      throws when the suite asks the SMTP server to fail).
 */

export type SentMail = { from?: string; to: string; subject: string; text: string; html: string; replyTo?: string };

export type PrelaunchTestState = {
  afterQueue: (() => unknown)[];
  cookies: Map<string, string>;
  headers: Map<string, string>;
  revalidated: { tags: string[]; paths: string[] };
  mails: SentMail[];
  /** What each createTransport was given (host, auth…) — to see which password won. */
  transports: unknown[];
  smtpError: string | null;
};

const g = globalThis as unknown as { __prelaunchTest?: PrelaunchTestState };

export function testState(): PrelaunchTestState {
  if (!g.__prelaunchTest) {
    g.__prelaunchTest = {
      afterQueue: [], cookies: new Map(), headers: new Map(),
      revalidated: { tags: [], paths: [] }, mails: [], transports: [], smtpError: null,
    };
  }
  return g.__prelaunchTest;
}

/* ── next/server ───────────────────────────────────────────────────────── */

export function after(fn: () => unknown): void {
  testState().afterQueue.push(fn);
}

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { status: init?.status ?? 200, headers });
  }
}

/* ── next/headers ──────────────────────────────────────────────────────── */

type CookieEntry = { name: string; value: string };

export async function cookies() {
  const s = testState();
  return {
    get(name: string): CookieEntry | undefined {
      const value = s.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll(): CookieEntry[] {
      return [...s.cookies.entries()].map(([name, value]) => ({ name, value }));
    },
    has(name: string): boolean {
      return s.cookies.has(name);
    },
    set(): void {},
    delete(): void {},
  };
}

export async function headers() {
  const h = new Headers();
  for (const [k, v] of testState().headers) h.set(k, v);
  return h;
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}

/* ── next/cache ────────────────────────────────────────────────────────── */

export function unstable_cache<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return fn;
}
export function revalidateTag(tag: string): void {
  testState().revalidated.tags.push(tag);
}
export function revalidatePath(path: string): void {
  testState().revalidated.paths.push(path);
}

/* ── nodemailer ────────────────────────────────────────────────────────── */

const nodemailer = {
  createTransport(opts: unknown) {
    testState().transports.push(opts);
    return {
      async sendMail(message: SentMail) {
        const s = testState();
        if (s.smtpError) throw new Error(s.smtpError);
        s.mails.push({ ...message });
        return { accepted: [message.to], rejected: [] };
      },
      close() {},
    };
  },
};
export default nodemailer;
