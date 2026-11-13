-- 0175 — CENNIK V2 (3/3): the approved prices, switched in ONE transaction.
--
-- Source: GrovBase_CENNIK_I_RENTOWNOSC_DO_AKCEPTACJI_2026-11-13 (approved).
-- Applied only after 0174 and after the eight USD Prices exist in Stripe LIVE
-- (created 13.11.2026, tax_behavior = inclusive: the prices are GROSS).
--
-- Every plan row changes its price, its Stripe Price and its confirmed amount
-- in the same statement, so there is no moment in which the old offer sells
-- for the new credits or the new offer for the old price. Old Stripe Prices
-- and the packs stay in Stripe and in history; the packs leave the offer.
--
-- No wallet, ledger row or balance is touched here. A copy of everything
-- this changes was taken by 0174 (billing_config_snapshots 'before-pricing-v2').
--
-- Idempotent: every statement sets absolute values; FAQ answers change only
-- if they still hold the exact old text (an admin's later edit is kept).

/* ── plans: USD gross, monthly and annual (12 months for the price of 10) ──*/

insert into public.subscription_plans (id, slug, name, description, active, featured, price_cents, annual_price_cents,
  currency, monthly_credits, bonus_credits, features, limits, sort_order)
values ('e5444bf0-1f51-4862-9472-418a521955e0', 'mini', 'Mini', null, true, false, 990, 9900,
  'USD', 20, 0, '{"products": 20, "workspace_members": 1}'::jsonb, '{"concurrent_generations": 1}'::jsonb, 1)
on conflict (slug) do nothing;

update public.subscription_plans p set
  name = v.name,
  currency = 'USD',
  price_cents = v.monthly_cents,
  annual_price_cents = v.annual_cents,
  monthly_credits = v.credits,
  bonus_credits = 0,
  sort_order = v.sort_order,
  active = true,
  stripe_product_id = v.product,
  stripe_price_id_monthly = v.price_monthly,
  stripe_price_id_annual = v.price_annual,
  stripe_price_monthly_cents = v.monthly_cents,
  stripe_price_annual_cents = v.annual_cents,
  stripe_sync_status = 'synced',
  stripe_synced_at = now(),
  stripe_sync_error = null
from (values
  ('mini',    'Mini',     990,  9900,  20, 1, 'grovbase_plan_mini',    'price_1UbRBAPOBRMZKbwYPb94g8Zk', 'price_1UbRIZPOBRMZKbwY6I2dGw1s'),
  ('starter', 'Starter', 2490, 24900,  55, 2, 'grovbase_plan_starter', 'price_1UbRIsPOBRMZKbwYpIHaAKiv', 'price_1UbRIvPOBRMZKbwYWhkcuHbU'),
  ('pro',     'Pro',     4990, 49900, 125, 3, 'grovbase_plan_pro',     'price_1UbRJ1POBRMZKbwYwrr44zvv', 'price_1UbRJ4POBRMZKbwYe57EKQ8F'),
  -- The technical slug stays `agency` (history, subscriptions, code); the
  -- name customers read is Business.
  ('agency',  'Business', 10990, 109900, 290, 4, 'grovbase_plan_agency', 'price_1UbRJBPOBRMZKbwYFyGu3w0V', 'price_1UbRJEPOBRMZKbwYh904lec8')
) as v(slug, name, monthly_cents, annual_cents, credits, sort_order, product, price_monthly, price_annual)
where p.slug = v.slug;

/* ── packs: out of the offer (kept for history; the slider replaces them) ──*/

update public.credit_packages set active = false where active;

/* ── tool prices (credits per result, hundredths) ──────────────────────────*/

-- One table for Packshot (Nano Banana Pro) and „Stwórz zdjęcie".
update public.ai_models set pricing = '{"1K": 1, "2K": 1, "4K": 1.25}'::jsonb, credit_cost = 1
 where model_identifier = 'gemini-3-pro-image' and name = 'Nano Banana Pro';
update public.ai_models set pricing = '{"1K": 1, "2K": 1.25, "4K": 1.75}'::jsonb, credit_cost = 1
 where model_identifier = 'gemini-3.1-flash-image' and name = 'Nano Banana 2';
update public.ai_models set pricing = '{"1K": 0.5}'::jsonb, credit_cost = 0.5
 where model_identifier = 'gemini-2.5-flash-image' and name = 'Gemini 2.5 Flash Image';
-- GPT Image 2: 1 credit at 1K and 2K whatever render quality (its quality
-- table is kept, at the one approved price). It renders no 4K here.
update public.ai_models set pricing = '{"1K": 1, "2K": 1}'::jsonb, credit_cost = 1,
       metadata = metadata || jsonb_build_object('quality_pricing', '{"low": {"1K": 1, "2K": 1}, "medium": {"1K": 1, "2K": 1}, "high": {"1K": 1, "2K": 1}}'::jsonb)
 where model_identifier = 'gpt-image-2' and name = 'GPT Image 2';

-- GrovShot: product analysis once per order (prompt_generation), each image
-- at 2K / 4K whatever model renders it. Miniaturka: 2 per thumbnail (+ the
-- Packshot 2K price for each photo it retouches — the model table above).
update public.service_catalog set credits_cost = 2 where slug = 'prompt_generation';
update public.service_catalog set credits_cost = 2 where slug = 'tool_thumbnail';
insert into public.service_catalog (slug, name, category, service_type, unit, credits_cost, enabled, metadata)
values ('grovshot_image_2k', 'GrovShot — obraz 2K', 'grovshot', 'image', 'generation', 1, true, '{"pricing": "cennik-v2"}'),
       ('grovshot_image_4k', 'GrovShot — obraz 4K', 'grovshot', 'image', 'generation', 1.25, true, '{"pricing": "cennik-v2"}')
on conflict (slug) do update set credits_cost = excluded.credits_cost, enabled = true;

/* ── FAQ: only answers that state what is no longer true ───────────────────*/

-- Packs are gone; the slider (20–5000 credits) is how to top up.
update public.faq_items set answer = jsonb_build_object(
  'pl', 'Doładowania są dostępne dla aktywnych planów płatnych: w sekcji „Doładuj kredyty” ustaw na suwaku liczbę kredytów (od 20 do 5000). Im więcej kredytów, tym niższa cena kolejnych. Kredyty z doładowania nie wygasają i trafiają na konto po potwierdzeniu płatności.',
  'en', 'Top-ups are available on active paid plans: in “Top up credits”, set the number of credits on the slider (20 to 5,000). The more credits, the lower the price of the next ones. Top-up credits never expire and reach your account once the payment is confirmed.',
  'de', 'Aufladungen gibt es für aktive bezahlte Pläne: Stelle unter „Credits aufladen“ die Anzahl der Credits mit dem Schieberegler ein (20 bis 5.000). Je mehr Credits, desto günstiger die weiteren. Aufgeladene Credits verfallen nicht und landen nach Bestätigung der Zahlung auf deinem Konto.')
 where id = 'ee80b371-8530-40d2-8bfb-95b829324d78'
   and answer->>'pl' = 'Doładowania są dostępne dla aktywnych planów płatnych: w sekcji „Doładuj kredyty” wybierz pakiet albo własną liczbę kredytów. Kredyty z doładowania nie wygasają i trafiają na konto po potwierdzeniu płatności.';

-- Payments are in USD now: BLIK (a PLN-only method) is no longer offered.
update public.faq_items set answer = jsonb_build_object(
  'pl', 'Płatności obsługuje Stripe, w dolarach amerykańskich (USD). Plan i doładowania opłacisz kartą płatniczą. Formularz płatności pokazuje metody dostępne na Twoim urządzeniu, w tym portfele takie jak Apple Pay czy Google Pay.',
  'en', 'Payments are handled by Stripe, in US dollars (USD). You pay for a plan and for top-ups by card. The payment form shows the methods available on your device, including wallets such as Apple Pay or Google Pay.',
  'de', 'Zahlungen laufen über Stripe, in US-Dollar (USD). Plan und Aufladungen bezahlst du per Karte. Das Zahlungsformular zeigt die auf deinem Gerät verfügbaren Methoden, darunter Wallets wie Apple Pay oder Google Pay.')
 where id = '1c3d753e-200e-427f-ad75-bc4e04e11153'
   and answer->>'pl' = 'Płatności obsługuje Stripe. Plan opłacisz kartą płatniczą, a jednorazowe doładowania także BLIKiem. Formularz płatności pokazuje metody dostępne na Twoim urządzeniu, w tym portfele takie jak Apple Pay czy Google Pay.';
