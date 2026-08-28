# ADR-0001 Ledger-only credits
Context: credits are money-like; races and tampering are fatal.
Decision: balances change ONLY via apply_credit_transaction (SECURITY
DEFINER, FOR UPDATE, balance check, ledger row with before/after);
lifecycle RPCs (charge/complete/fail/refund) wrap it with membership checks
and replay guards.
Alternatives: app-level read-modify-write (racy); service-role writes
(bypasses RLS). Consequences: all billing bugs are DB-reviewable; adding
payment flows means new RPCs, not new write paths. Reversal: hard, by design.
