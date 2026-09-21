/**
 * GOOGLE ANALYTICS 4 — the part that has no DOM in it.
 *
 * Everything decidable without a browser lives here so it can be tested
 * without one: whether analytics is on at all, what a page_view is allowed to
 * say, and the rule that stops the same view being counted twice. The client
 * component is then a thin wire between this and `window.dataLayer`.
 *
 * WHY A QUEUE OBJECT RATHER THAN CALLING `gtag` DIRECTLY.
 *
 * Google's snippet works because the `gtag` shim is NOT gtag.js — it is four
 * lines that push into an array, and the real gtag.js drains that array
 * whenever it finishes loading. That ordering is the whole design, and it is
 * what lets the script be `async` without losing the first event.
 *
 * Reproducing it faithfully matters here: `next/script` with
 * `afterInteractive` gives no promise about running before React's effects, so
 * a page_view that calls `window.gtag(...)` can fire into a function that does
 * not exist yet and vanish. Pushing into the array cannot lose anything —
 * whatever is queued before gtag.js lands is replayed the moment it does.
 */

/**
 * ONE PLACE. The value is compiled into the client bundle by Next (that is
 * what NEXT_PUBLIC_ means), so it is not a secret and never pretends to be —
 * a measurement ID is in the page source of every site that uses GA. It is
 * centralised because an ID copied into three files is an ID that will be
 * changed in two.
 */
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID ?? "";

/** A real GA4 measurement ID, not an empty string and not a UA-xxx property. */
export function gaEnabled(id: string = GA_MEASUREMENT_ID): boolean {
  return /^G-[A-Z0-9]{4,}$/.test(id.trim());
}

/**
 * QUERY PARAMETERS THAT MUST NEVER LEAVE THIS APP.
 *
 * `page_location` is a full URL, and this application puts real credentials in
 * URLs: Supabase password-recovery and e-mail-confirmation links, the OAuth
 * `code`, the newsletter's per-recipient tokens, the step-up codes. Sending
 * any of those to a third party would be handing out a working key.
 *
 * Matched as SUBSTRINGS of the lowercased parameter name, so `access_token`,
 * `refresh_token` and `X-Amz-Signature` are all caught by the short entries.
 * Campaign parameters are deliberately NOT here — utm_*, gclid and fbclid are
 * the reason anyone installs analytics, and they carry nothing private.
 */
export const SENSITIVE_PARAM_PARTS: readonly string[] = [
  "token", "secret", "password", "passwd", "pwd", "otp", "code", "key",
  "signature", "sig", "auth", "session", "jwt", "hash", "email", "credential",
];

function isSensitive(name: string): boolean {
  const n = name.toLowerCase();
  return SENSITIVE_PARAM_PARTS.some((part) => n.includes(part));
}

/**
 * The URL a page_view is allowed to report.
 *
 * THE FRAGMENT IS DROPPED WHOLESALE, not filtered. Supabase returns recovery
 * and magic-link tokens in the hash (`#access_token=…&refresh_token=…`), the
 * hash never reaches a server, and there is no legitimate analytics use for it
 * here — so the safe rule is the simple one.
 *
 * Returns a path-and-query string rather than an absolute URL when the input
 * cannot be parsed, so a malformed href degrades to something harmless instead
 * of throwing inside an effect.
 */
export function sanitizePageLocation(href: string): string {
  let url: URL;
  try { url = new URL(href); } catch { return "/"; }

  const kept = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    if (!isSensitive(name)) kept.append(name, value);
  }
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

/* ── THE COMMAND QUEUE ─────────────────────────────────────────────────── */

/** What gtag.js consumes. Each entry is an `arguments` object in Google's own
 *  snippet; an array is the same shape to gtag.js, which reads it by index. */
export type DataLayer = unknown[];

export type Tracker = {
  /** `js` + `config`, exactly once per document however often this is called. */
  init: () => void;
  /** One page_view for the address the router SETTLES on. */
  pageView: (href: string, title?: string) => void;
};

/**
 * A ROUTE THAT REDIRECTS IS STILL ONE VISIT.
 *
 * Measured in a real browser against the real build: clicking "Zacznij za
 * darmo" on the landing page produced THREE page_views for one click —
 * `/`, `/register`, `/`. Nothing was wrong with the deduplication; the
 * application genuinely passes through those three addresses, because
 * app/(auth)/register/page.tsx is a server `redirect()` to `/?auth=register`
 * and the App Router commits the intermediate route without reloading the
 * document. Several routes here work that way.
 *
 * So a page_view waits for the address to stop moving. Each call replaces the
 * pending one, and only the address that survives the delay is reported —
 * which collapses `/ → /register → /` back into what actually happened, which
 * is nothing: the visitor is still on the page they started on, with a dialog
 * open over it.
 *
 * THE COST, NAMED. A visit abandoned within the delay is not counted. That
 * window is short enough that nobody read the page, and the alternative is
 * triple-counting every redirecting route — silently, in a direction that
 * flatters the numbers.
 */
export const SETTLE_MS = 300;

export type TrackerOptions = {
  settleMs?: number;
  /** Injected so the rule can be tested without waiting. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * `config` IS SENT WITH send_page_view: false, AND THAT IS THE WHOLE
 * DUPLICATE-EVENT FIX.
 *
 * gtag.js sends a page_view of its own when it processes `config`. In a normal
 * website that is the one event you want. In an App Router application it is
 * the FIRST of two, because the router also has to report every client-side
 * navigation — and the usual workaround, "skip the first effect", breaks the
 * moment React runs an effect twice (StrictMode) or a remount happens.
 *
 * So gtag.js is told not to send it, and EVERY page_view — including the one
 * for the initial load — comes from the same code path. One rule, one event.
 */
export function createTracker(
  dataLayer: DataLayer,
  id: string,
  options: TrackerOptions = {},
): Tracker {
  const settleMs = options.settleMs ?? SETTLE_MS;
  const setTimer = options.setTimer
    ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer
    ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let started = false;
  let lastUrl: string | null = null;
  let pending: unknown = null;

  return {
    init() {
      if (started || !gaEnabled(id)) return;
      started = true;
      dataLayer.push(["js", new Date()]);
      dataLayer.push(["config", id, { send_page_view: false }]);
    },
    pageView(href, title) {
      if (!gaEnabled(id)) return;
      const location = sanitizePageLocation(href);
      if (pending !== null) clearTimer(pending);
      pending = setTimer(() => {
        pending = null;
        // Checked HERE rather than on the way in, so a redirect that lands
        // back where it started reports nothing at all rather than reporting
        // the same page twice. It also absorbs a StrictMode double-effect, a
        // theme toggle and a refocus, none of which is a visit.
        if (location === lastUrl) return;
        lastUrl = location;
        dataLayer.push(["event", "page_view", {
          page_location: location,
          ...(title ? { page_title: title } : {}),
        }]);
      }, settleMs);
    },
  };
}
