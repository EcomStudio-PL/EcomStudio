import "server-only";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import { stripeCredentials } from "@/lib/stripe/config";
import {
  stripePost, StripeApiError, StripeNotConfiguredError, type FormValue,
} from "@/lib/stripe/client";

/**
 * THE ADMIN PANEL IS THE CATALOGUE. STRIPE IS TOLD.
 *
 * Before this module, an admin who changed 49 zł to 59 zł changed one number in
 * Postgres. The Stripe Price object — the thing that actually decides what a
 * card is charged — kept saying 49. GrovBase displayed 59 and billed 49, and
 * nothing in either system was in a position to notice, because the two numbers
 * lived in two places and nothing compared them.
 *
 * ─── WHY THIS IS NOT "UPDATE THE PRICE IN STRIPE" ───────────────────────────
 *
 * There is no such call. A Stripe Price is immutable in `unit_amount` by
 * design: subscriptions and invoices point AT a Price, and letting one change
 * retroactively would silently rewrite what existing customers agreed to pay.
 *
 * So a price change is a new object:
 *
 *     the PRODUCT stays          — it is the thing being sold, and its id is
 *                                  what every past invoice refers to
 *     a new PRICE is created     — on that same Product
 *     the mapping column moves   — new checkouts resolve to the new Price
 *     the old PRICE is archived  — so nothing can quote it again
 *
 * Creating a new Product per price change would be the easy mistake. It
 * orphans history, multiplies the dashboard, and breaks the one-to-one mapping
 * the webhook relies on to answer "which plan is this".
 *
 * ─── THE ORDER OF OPERATIONS IS THE WHOLE SAFETY ARGUMENT ───────────────────
 *
 * There is no transaction spanning Stripe and Postgres. There cannot be. So the
 * order is chosen so that every possible interruption leaves a SAFE state, and
 * "safe" means: no customer is ever charged an amount GrovBase did not display.
 *
 *   1. mark 'syncing'        a crash from here on is visible, not assumed
 *   2. create the Price      ← the step that can fail
 *   3. stripe_apply_price    one statement: displayed amount, Stripe id and
 *                            confirmed amount move together or not at all
 *   4. archive the old Price best effort
 *
 * STRIPE BEFORE POSTGRES, because a Stripe failure must leave GrovBase's price
 * exactly as it was: the admin sees an error, the old price stays live, and it
 * is still the price Stripe charges. Writing Postgres first would create the
 * original bug on purpose, in the failure path.
 *
 * IF STEP 3 FAILS, Stripe holds a Price that nothing references. It is inert —
 * no checkout can reach a Price id that was never recorded — and step 4's
 * machinery archives it on the way out. The row stays 'syncing', which the
 * admin screen shows as a problem with a retry, and which `sellable()` treats
 * as not safe to sell.
 *
 * IF STEP 4 FAILS the customer-facing invariant still holds: new purchases
 * resolve to the new id. An extra active Price nobody points at costs nothing.
 * That is why a failed archive is a note, never a status.
 *
 * ─── AND IT VERIFIES WHAT IT WAS GIVEN ──────────────────────────────────────
 *
 * Step 3 records `price.unit_amount` only after checking it equals the amount
 * that was requested. That check should never fire. It exists because this is
 * the exact seam where the original bug lived, and a seam that once produced a
 * silent mismatch gets an assertion rather than an assumption.
 */

/* ── what Stripe answers with ──────────────────────────────────────────────*/

type StripeProduct = { id: string; name: string; active: boolean };
type StripePrice = {
  id: string;
  product: string;
  unit_amount: number | null;
  currency: string;
  active: boolean;
  recurring: { interval: string } | null;
};

/* ── the vocabulary ────────────────────────────────────────────────────────*/

export type PriceEntity = "plan" | "package";
export type PricePeriod = "monthly" | "annual";

export type PriceSyncRefusal =
  | "payments_disabled"
  | "no_server_key"
  | "unknown_entity"
  | "invalid_amount"
  | "stripe_error"
  /** Stripe created the Price; recording it here did not work. The catalogue
   *  entry is left unsellable rather than half-changed. */
  | "reconcile_required";

export type PriceSyncOutcome =
  | { ok: true; changed: false; priceId: string | null; amountCents: number }
  | { ok: true; changed: true; priceId: string | null; amountCents: number; archived: string | null }
  | { ok: false; reason: PriceSyncRefusal; detail?: string };

/** What the caller must tell us. Never an amount that came from a browser. */
export type PriceSyncRequest = {
  entity: PriceEntity;
  entityId: string;
  /** Ignored for a package, which has exactly one price. */
  period?: PricePeriod;
  amountCents: number;
  currency: string;
  /** The Stripe Product's display name. Kept in step with the catalogue row. */
  productName: string;
};

type Row = {
  currency: string;
  productId: string | null;
  priceId: string | null;
  confirmedCents: number | null;
  status: string;
};

/* ── reading the catalogue row this is about ───────────────────────────────*/

async function readRow(
  supabase: Client, entity: PriceEntity, entityId: string, period: PricePeriod,
): Promise<Row | null> {
  if (entity === "package") {
    const { data, error } = await supabase
      .from("credit_packages")
      .select("currency, stripe_product_id, stripe_price_id, stripe_price_cents, stripe_sync_status")
      .eq("id", entityId).maybeSingle();
    if (error || !data) return null;
    return {
      currency: data.currency,
      productId: data.stripe_product_id,
      priceId: data.stripe_price_id,
      confirmedCents: data.stripe_price_cents,
      status: data.stripe_sync_status,
    };
  }
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("currency, stripe_product_id, stripe_price_id_monthly, stripe_price_id_annual, stripe_price_monthly_cents, stripe_price_annual_cents, stripe_sync_status")
    .eq("id", entityId).maybeSingle();
  if (error || !data) return null;
  const annual = period === "annual";
  return {
    currency: data.currency,
    productId: data.stripe_product_id,
    priceId: annual ? data.stripe_price_id_annual : data.stripe_price_id_monthly,
    confirmedCents: annual ? data.stripe_price_annual_cents : data.stripe_price_monthly_cents,
    status: data.stripe_sync_status,
  };
}

/* ── the Product, created once and kept ────────────────────────────────────*/

/**
 * The Stripe Product for this catalogue entry.
 *
 * Created on first sync and REUSED for every price change afterwards. Its
 * metadata carries the GrovBase id, so the mapping is recoverable from the
 * Stripe side alone — which matters the day someone is looking at a payment in
 * the Stripe dashboard and needs to know what it was.
 *
 * The name is pushed on every sync because an admin renaming "Pro" to
 * "Professional" should not leave Stripe — and therefore receipts, invoices and
 * the customer's card statement descriptor — saying the old thing.
 */
async function ensureProduct(
  entity: PriceEntity, entityId: string, name: string, existing: string | null,
): Promise<string> {
  if (existing) {
    // Best effort: a rename that fails must not block a price change. The
    // Product id is what everything is keyed on, and it is already correct.
    try {
      await stripePost<StripeProduct>(`/products/${existing}`, { name },
        `product-name:${entityId}:${name}`);
    } catch { /* the id is what matters; the label can catch up next time */ }
    return existing;
  }
  const created = await stripePost<StripeProduct>("/products", {
    name,
    metadata: { grovbase_entity: entity, grovbase_entity_id: entityId },
  }, `product:${entity}:${entityId}`);
  return created.id;
}

/* ── the sync ──────────────────────────────────────────────────────────────*/

/**
 * Bring one price into agreement with Stripe.
 *
 * NOTHING HAPPENS WHEN NOTHING CHANGED. A plan edit that only moves
 * `monthly_credits` or a description reaches this function too, and creating a
 * Price for that would litter the account with identical objects and archive a
 * perfectly good one for no reason. So the first question is whether Stripe's
 * confirmed amount already equals the requested amount — and if it does, and
 * the row is marked synced, this returns `changed: false` without a single API
 * call.
 */
export async function syncPrice(
  supabase: Client, req: PriceSyncRequest,
): Promise<PriceSyncOutcome> {
  const creds = stripeCredentials();
  if (!creds) return { ok: false, reason: "payments_disabled" };
  const token = dispatchToken();
  if (!token) return { ok: false, reason: "no_server_key" };

  const period: PricePeriod = req.period === "annual" ? "annual" : "monthly";
  if (!Number.isSafeInteger(req.amountCents) || req.amountCents < 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  const row = await readRow(supabase, req.entity, req.entityId, period);
  if (!row) return { ok: false, reason: "unknown_entity" };

  const currency = (req.currency || row.currency || "PLN").toLowerCase();

  // ALREADY RIGHT. Stripe's own confirmed figure is what is compared — not the
  // displayed price, which is the number under suspicion.
  const upToDate = row.confirmedCents === req.amountCents
    && row.status === "synced"
    && (req.amountCents === 0 ? row.priceId === null : row.priceId !== null);
  if (upToDate) {
    return { ok: true, changed: false, priceId: row.priceId, amountCents: req.amountCents };
  }

  await mark(supabase, token, req.entity, req.entityId, "syncing", null);

  try {
    // ZERO MEANS NOT FOR SALE IN THIS PERIOD — an annual price left at 0 is a
    // plan sold monthly only. There is no such thing as a 0 zł recurring Price
    // worth creating: it would bill nothing forever and make `/plan` offer a
    // free annual subscription beside a paid monthly one.
    if (req.amountCents === 0) {
      const applied = await apply(supabase, token, req, period, currency, row.productId, null);
      if (!applied.ok) return applied;
      const archived = await archive(applied.previous);
      return { ok: true, changed: true, priceId: null, amountCents: 0, archived };
    }

    const productId = await ensureProduct(req.entity, req.entityId, req.productName, row.productId);

    const params: Record<string, FormValue> = {
      product: productId,
      unit_amount: req.amountCents,
      currency,
      metadata: {
        grovbase_entity: req.entity,
        grovbase_entity_id: req.entityId,
        ...(req.entity === "plan" ? { grovbase_period: period } : {}),
      },
    };
    // A plan is recurring; a credit pack is bought once. `recurring` is what
    // makes Stripe treat the Price as subscribable, and omitting it on a plan
    // would produce a Price that `mode: subscription` refuses.
    if (req.entity === "plan") {
      params.recurring = { interval: period === "annual" ? "year" : "month" };
    }

    // THE KEY INCLUDES THE PRICE IT REPLACES.
    //
    // A retry of the same change must return the SAME Price rather than create
    // a second one — that is what an idempotency key is for. But a key of
    // "this entity at this amount" would be wrong in a way that takes a day to
    // show up: an admin who goes 49 → 59 → 49 within Stripe's 24-hour key
    // window would get back the FIRST 49 Price, which step 4 archived, and
    // checkout would then point at an archived Price.
    //
    // Including the id being replaced makes a genuine retry identical and a
    // round trip distinct, because the second 49 replaces the 59 and not the
    // original.
    const price = await stripePost<StripePrice>("/prices", params,
      `price:${req.entity}:${req.entityId}:${period}:${req.amountCents}:${row.priceId ?? "none"}`);

    // THE ASSERTION AT THE SEAM WHERE THE BUG LIVED. Stripe echoes the amount
    // it stored; if it is ever not the amount we asked for, recording it would
    // be writing down a number we have not verified — which is precisely how a
    // display and a charge come apart. Refuse, and leave the old price live.
    if (price.unit_amount !== req.amountCents || price.currency !== currency) {
      await archive(price.id);
      await mark(supabase, token, req.entity, req.entityId, "failed",
        "stripe_returned_a_different_amount");
      return { ok: false, reason: "stripe_error", detail: "amount_mismatch" };
    }

    const applied = await apply(supabase, token, req, period, currency, productId, price.id);
    if (!applied.ok) {
      // Postgres did not take it. The new Price is referenced by nothing, so
      // put it away rather than leave an active orphan on the account.
      await archive(price.id);
      return applied;
    }

    const archived = await archive(applied.previous);
    return { ok: true, changed: true, priceId: price.id, amountCents: req.amountCents, archived };
  } catch (e) {
    logFailure("sync", e);
    await mark(supabase, token, req.entity, req.entityId, "failed", reason(e));
    if (e instanceof StripeNotConfiguredError) return { ok: false, reason: "payments_disabled" };
    return { ok: false, reason: "stripe_error", detail: reason(e) };
  }
}

/* ── the one local write ───────────────────────────────────────────────────*/

type Applied = { ok: true; previous: string | null } | (PriceSyncOutcome & { ok: false });

async function apply(
  supabase: Client, token: string, req: PriceSyncRequest, period: PricePeriod,
  currency: string, productId: string | null, priceId: string | null,
): Promise<Applied> {
  const { data, error } = await supabase.rpc("stripe_apply_price", {
    p_token: token,
    p_entity: req.entity,
    p_entity_id: req.entityId,
    p_period: period,
    p_price_cents: req.amountCents,
    p_currency: currency.toUpperCase(),
    p_stripe_product_id: productId,
    p_stripe_price_id: priceId,
  });
  if (error) {
    console.error("billing.price_sync.apply_failed", req.entity, error.code ?? "unknown");
    // Deliberately NOT marked 'failed'. The row is left 'syncing', which is the
    // truth: Stripe moved and this side did not. `failed` would suggest nothing
    // happened anywhere, and a human reading the admin screen needs to know a
    // Price exists that this database never recorded.
    return { ok: false, reason: "reconcile_required" };
  }
  const status = (data as { status?: string; previous_price_id?: string | null } | null);
  if (status?.status !== "applied") return { ok: false, reason: "unknown_entity" };
  return { ok: true, previous: status.previous_price_id ?? null };
}

async function mark(
  supabase: Client, token: string, entity: PriceEntity, entityId: string,
  status: string, detail: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("stripe_mark_price_sync", {
    p_token: token, p_entity: entity, p_entity_id: entityId,
    p_status: status, p_error: detail,
  });
  // A status that cannot be written is not worth failing a price change over,
  // but it is worth saying out loud — it means the admin screen is about to
  // show something stale.
  if (error) console.error("billing.price_sync.mark_failed", entity, status, error.code ?? "unknown");
}

/**
 * Retire a Price so nothing can quote it again.
 *
 * `active: false` is the documented way; there is no delete. An archived Price
 * keeps working for subscriptions ALREADY on it — which is exactly the
 * behaviour §17 depends on, and the reason existing customers do not silently
 * change price when the catalogue does.
 */
async function archive(priceId: string | null): Promise<string | null> {
  if (!priceId) return null;
  try {
    await stripePost<StripePrice>(`/prices/${priceId}`, { active: false }, `archive:${priceId}`);
    return priceId;
  } catch (e) {
    logFailure("archive", e);
    return null;
  }
}

function reason(e: unknown): string {
  if (e instanceof StripeApiError) return e.code ?? e.type ?? `http_${e.status}`;
  return e instanceof Error ? e.name : "unknown";
}

function logFailure(where: string, e: unknown): void {
  if (e instanceof StripeApiError) {
    console.error("billing.price_sync", where, e.status, e.type ?? "-", e.code ?? "-", e.message);
    return;
  }
  console.error("billing.price_sync", where, e instanceof Error ? e.message : "unknown");
}

/* ── is this safe to sell right now ────────────────────────────────────────*/

/**
 * THE RUNTIME HALF OF THE GUARANTEE.
 *
 * A test can prove the sync path records matching numbers. It cannot prove that
 * the row a customer is about to buy from was written by that path — a manual
 * SQL edit, a half-finished sync, or a catalogue entry that predates all of
 * this would all slip past.
 *
 * So checkout asks this, every time, about the row it is about to charge
 * against: does the amount Stripe confirmed still equal the amount we are
 * displaying? A mismatch REFUSES THE SALE. A customer seeing "chwilowo
 * niedostępne" is a bad minute; a customer charged 49 for something priced 59
 * is a chargeback, a complaint, and a breach of the thing this whole module
 * exists to guarantee.
 */
export function sellable(row: {
  price_cents: number;
  stripe_price_cents?: number | null;
  stripe_price_monthly_cents?: number | null;
  stripe_price_annual_cents?: number | null;
  annual_price_cents?: number | null;
  stripe_sync_status?: string | null;
}, period: PricePeriod = "monthly"): boolean {
  const displayed = period === "annual" ? (row.annual_price_cents ?? 0) : row.price_cents;
  const confirmed = period === "annual"
    ? row.stripe_price_annual_cents
    : (row.stripe_price_monthly_cents ?? row.stripe_price_cents);
  // 'unknown' is the state of every row created before this module existed.
  // Those Prices were made by hand and have never been verified against the
  // catalogue, so they are not sellable until a sync confirms them. That is a
  // deliberate, visible outage on an unverified price rather than a quiet
  // charge at an amount nobody checked.
  if (row.stripe_sync_status !== "synced") return false;
  return typeof confirmed === "number" && confirmed === displayed;
}
