# Plans and Credits

- Plans: FREE / STARTER / PRO / AGENCY (subscription_plans table; UI tones:
  free=blue, starter=green, pro=amber, agency=magenta).
- Credits are the billing unit. Balance lives in `credit_wallets`; every
  change is a `credit_transactions` row written ONLY by
  `apply_credit_transaction()` (definer, revoked from clients).
- Generation price = model pricing per resolution × shots (+ engine
  surcharge when GrovBase writes the prompt). Server recomputes cost from DB
  rows; client-sent values can only raise the charge, never lower it.
- Tools: `service_catalog.credits_cost` with per-run floor; idempotency key
  is a server-side hash (tool+settings+file bytes).
- Welcome credits: `app_settings.user_defaults.welcome_credits` (25).
- No payment provider connected yet (`payments` table ready, Stripe later).
