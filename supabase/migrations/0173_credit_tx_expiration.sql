-- 0173 — CENNIK V2: a ledger entry type for credits that lapse.
--
-- Subscription credits expire at the end of their period (0174). Their
-- removal is a ledger entry like any other, and it needs its own type so a
-- customer's history says "wygasły", not "korekta". An enum value cannot be
-- added and used in the same transaction, so it lands first, alone.
alter type public.credit_tx_type add value if not exists 'expiration';
