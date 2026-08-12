-- New role for future account managers and richer credit transaction types.
-- Kept in its own migration: ALTER TYPE ... ADD VALUE must not be used by
-- DML inside the same transaction.
alter type public.user_role add value if not exists 'manager';
alter type public.credit_tx_type add value if not exists 'purchase';
alter type public.credit_tx_type add value if not exists 'promotion';
alter type public.credit_tx_type add value if not exists 'admin_grant';
alter type public.credit_tx_type add value if not exists 'manual_adjustment';
