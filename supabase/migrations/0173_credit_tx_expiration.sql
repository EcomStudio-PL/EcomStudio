-- 0173 — CENNIK V2 (1/3): a ledger entry type for credits that expire.
--
-- Subscription credits now expire at the end of the period they were granted
-- for (0174). An expiry moves the balance, so it is a ledger entry like any
-- other — written through apply_credit_transaction, never a silent UPDATE.
--
-- Its own migration because Postgres cannot USE an enum value in the same
-- transaction that adds it, and 0174 defines functions that use it.
-- Idempotent: IF NOT EXISTS.

alter type public.credit_tx_type add value if not exists 'expiration';
