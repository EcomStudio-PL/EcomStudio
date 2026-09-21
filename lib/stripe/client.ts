import "server-only";
import { stripeCredentials } from "@/lib/stripe/config";

/**
 * A SMALL, EXPLICIT STRIPE CLIENT.
 *
 * Stripe's REST API takes `application/x-www-form-urlencoded` with bracketed
 * keys for nested data — `line_items[0][price_data][unit_amount]=1900`. That
 * encoding is the whole of what the official SDK adds here, so this module
 * does it and nothing else: no new dependency, no bundled polyfills, and every
 * request visible at the call site.
 *
 * WHAT IT GUARANTEES.
 *
 *   IDEMPOTENCY ON WRITES. Every POST carries an Idempotency-Key. A retry
 *   after a timeout then returns the FIRST result instead of creating a second
 *   Checkout Session, a second Customer or a second charge. Without it, the
 *   one place a network blip costs real money is exactly this one.
 *
 *   THE KEY NEVER LEAVES. It is read here, sent in an Authorization header,
 *   and never returned, logged or included in an error. `StripeApiError`
 *   carries Stripe's own message and type — which is safe to log — and nothing
 *   from the request's credentials.
 *
 *   NO SILENT SUCCESS. A non-2xx response throws. A caller that forgets to
 *   handle it fails loudly rather than carrying on with an empty object.
 */

const API = "https://api.stripe.com/v1";

/** Stripe's version pinning: responses keep the shape this code was written for. */
const API_VERSION = "2024-06-20";

export class StripeApiError extends Error {
  readonly status: number;
  readonly type: string | undefined;
  readonly code: string | undefined;
  constructor(status: number, body: { error?: { message?: string; type?: string; code?: string } }) {
    super(body.error?.message ?? `Stripe request failed with ${status}`);
    this.name = "StripeApiError";
    this.status = status;
    this.type = body.error?.type;
    this.code = body.error?.code;
  }
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("stripe_not_configured");
    this.name = "StripeNotConfiguredError";
  }
}

type Primitive = string | number | boolean;
export type FormValue = Primitive | null | undefined | FormValue[] | { [k: string]: FormValue };

/**
 * `{a: {b: 1}, c: [{d: 2}]}` → `a[b]=1&c[0][d]=2`, which is what Stripe reads.
 * null and undefined are DROPPED rather than sent as the strings "null" and
 * "undefined" — Stripe would store those as literal metadata values.
 */
export function encodeForm(value: FormValue, prefix = "", out: string[] = []): string {
  if (value === null || value === undefined) return out.join("&");
  if (Array.isArray(value)) {
    value.forEach((item, i) => encodeForm(item, prefix ? `${prefix}[${i}]` : String(i), out));
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      encodeForm(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }
  return out.join("&");
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, FormValue> | undefined,
  idempotencyKey: string | undefined,
): Promise<T> {
  const creds = stripeCredentials();
  if (!creds) throw new StripeNotConfiguredError();

  const body = method === "POST" && params ? encodeForm(params) : undefined;
  const query = method === "GET" && params ? `?${encodeForm(params)}` : "";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.secretKey}`,
    "Stripe-Version": API_VERSION,
  };
  if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${API}${path}${query}`, { method, headers, body, cache: "no-store" });
  const text = await res.text();
  let parsed: unknown = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }

  if (!res.ok) throw new StripeApiError(res.status, parsed as { error?: { message?: string } });
  return parsed as T;
}

export function stripeGet<T>(path: string, params?: Record<string, FormValue>): Promise<T> {
  return call<T>("GET", path, params, undefined);
}

/**
 * A write. `idempotencyKey` is required by the signature, not optional, so it
 * cannot be forgotten at a call site where forgetting it means charging twice.
 */
export function stripePost<T>(
  path: string,
  params: Record<string, FormValue>,
  idempotencyKey: string,
): Promise<T> {
  return call<T>("POST", path, params, idempotencyKey);
}

/* ── The response shapes this application actually reads ───────────────────*/

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  mode: string;
  payment_intent: string | null;
  customer: string | null;
  amount_total: number | null;
  currency: string | null;
  payment_status: string;
  metadata: Record<string, string> | null;
};

export type StripeCustomer = { id: string; email: string | null; metadata: Record<string, string> | null };

export type StripeBillingPortalSession = { id: string; url: string };
