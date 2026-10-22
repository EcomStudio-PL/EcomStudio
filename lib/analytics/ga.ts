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

/** What gtag.js consumes. */
export type DataLayer = unknown[];

/**
 * THE gtag SHIM — Google's own `function gtag(){dataLayer.push(arguments);}`.
 *
 * gtag.js executes a queue entry as a COMMAND ("js", "config", "event") only
 * when it is an `arguments` object. A plain array looks the same by index but
 * is not treated as a gtag command, so nothing is configured and no hit is
 * ever sent. That was the production bug: this module pushed arrays, the tag
 * loaded, and GA4 reported "no data received". So every command goes through
 * this function, which pushes the real `arguments` object.
 */
export function makeGtag(dataLayer: DataLayer): (...args: unknown[]) => void {
  return function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params -- gtag.js needs the arguments object itself
    dataLayer.push(arguments);
  };
}

export type Tracker = {
  /** `js` + `config`, exactly once per document however often this is called. */
  init: () => void;
  /** One page_view for the address the router SETTLES on. */
  pageView: (href: string, title?: string) => void;
  /** One named funnel event (see PRELAUNCH_EVENTS). Initialises first, so an
   *  event can never reach the queue ahead of the `config` it belongs to. */
  event: (name: PrelaunchEvent, params?: EventParams) => void;
};

/* ── FUNNEL EVENTS ─────────────────────────────────────────────────────── */

/**
 * THE ONLY CUSTOM EVENTS THIS APP SENDS — a closed list, so a typo or a new
 * event is a compile error and a reviewed change, never a silent new stream of
 * data to a third party.
 *
 * `prelaunch_referral_confirmed` happens on the SERVER (the referred person's
 * confirmation) and is counted in the database; it is listed so the funnel has
 * one vocabulary, but nothing in the browser can send it truthfully.
 */
export const PRELAUNCH_EVENTS = [
  "prelaunch_page_view",
  "prelaunch_before_after_interaction",
  "prelaunch_form_start",
  "prelaunch_signup_submitted",
  "prelaunch_email_confirmed",
  "prelaunch_referral_shared",
  "prelaunch_referral_confirmed",
  "prelaunch_cta_clicked",
] as const;
export type PrelaunchEvent = (typeof PRELAUNCH_EVENTS)[number];

/**
 * WHAT AN EVENT MAY CARRY — names, not people. An allowlist of parameter keys
 * with short scalar values: which section, which form, which pair, which share
 * button, which traffic source. Never an e-mail, a token, a referral code or a
 * free-text field (none of those keys exist here), so nothing personal can be
 * attached to an event by accident.
 */
export const EVENT_PARAM_KEYS = [
  "section", "form_variant", "pair_index", "channel", "method", "cta_id", "traffic_source",
] as const;
export type EventParams = Partial<Record<(typeof EVENT_PARAM_KEYS)[number], string | number>>;

const PARAM_VALUE_RE = /^[a-z0-9_.\-]{1,64}$/i;

/** The parameters an event is allowed to send — unknown keys, non-scalar and
 *  odd-looking values are dropped rather than sanitised into something else. */
export function eventParams(params: EventParams | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!params) return out;
  for (const key of EVENT_PARAM_KEYS) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.round(value);
    else if (typeof value === "string" && PARAM_VALUE_RE.test(value)) out[key] = value;
  }
  return out;
}

export const isPrelaunchEvent = (name: unknown): name is PrelaunchEvent =>
  typeof name === "string" && (PRELAUNCH_EVENTS as readonly string[]).includes(name);

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
  /** The address an event happens on; injected for the tests. */
  currentHref?: () => string | null;
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
  const currentHref = options.currentHref
    ?? (() => (typeof window === "undefined" ? null : window.location.href));

  let started = false;
  let lastUrl: string | null = null;
  let pending: unknown = null;
  const gtag = makeGtag(dataLayer);

  const init = () => {
    if (started || !gaEnabled(id)) return;
    started = true;
    gtag("js", new Date());
    gtag("config", id, { send_page_view: false });
  };

  return {
    init,
    event(name, params) {
      if (!gaEnabled(id) || !isPrelaunchEvent(name)) return;
      init();
      // THE ADDRESS, SANITISED, ON EVERY EVENT (review S9). An event without a
      // page_location is not an event without an address: gtag.js fills it in
      // from document.location — the raw one, ?ref_code= and all. Naming it
      // explicitly is the only way the sanitiser applies to events too.
      const href = currentHref();
      gtag("event", name, {
        ...eventParams(params),
        ...(href ? { page_location: sanitizePageLocation(href) } : {}),
      });
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
        gtag("event", "page_view", {
          page_location: location,
          ...(title ? { page_title: title } : {}),
        });
      }, settleMs);
    },
  };
}
