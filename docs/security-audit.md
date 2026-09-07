# Security audit — Stage 4

Scope: RLS and database privileges, admin authorization, secret exposure, the
Supabase Send Email Hook, and Turnstile. Findings are ordered by severity, and
each one says what was proven, not what looked suspicious.

## 1. CRITICAL — any registered customer could mint themselves credits · FIXED

`public.ensure_welcome_bonus_offer` is `SECURITY DEFINER` with `EXECUTE` granted
to `authenticated`, so it was reachable at `/rest/v1/rpc/ensure_welcome_bonus_offer`
with nothing but a normal login. It accepted `p_user_id`, `p_amount`, `p_hours`,
`p_campaign_version` and `p_eligible_at`, and trusted all five.

The attack was a single request:

```
POST /rest/v1/rpc/ensure_welcome_bonus_offer
{ "p_user_id": "<own id>", "p_amount": 1000000, "p_hours": 72,
  "p_campaign_version": 999, "p_eligible_at": "<now>" }
```

`on conflict (user_id, campaign_version) do nothing` does not fire, because 999
is a campaign that does not exist. `claim_welcome_bonus()` then selects
`order by campaign_version desc limit 1` — the forged row — and credits
`reward_amount` through the ledger. The claim path itself is correct; it was
being handed a poisoned offer.

**Proven, not theorised.** Run against the live production function inside a
transaction that was then rolled back:

| | before fix | after fix |
|---|---|---|
| offer the attack returns | `reward_amount: 1000000`, `campaign_version: 999`, `status: ELIGIBLE` | `reward_amount: 150`, `campaign_version: 1` |
| rows created | 2 → **3** | 2 → **2** |
| error raised | none | none (the forged values are ignored, not rejected) |

Production state before and after the test: 2 offer rows, max reward 150, max
campaign 1 — the probe left nothing behind.

**Fix** (migration `0067`): the function no longer believes its own arguments.
The amount, duration and campaign are read from `app_settings->'welcome_bonus'`
— the same row the admin panel writes and `lib/server/welcome-bonus.ts` reads —
the caller may only create an offer for `auth.uid()`, and only once
`auth.users.email_confirmed_at` is set. The signature is unchanged, so the
legitimate call site is untouched and a legitimately created offer is
byte-for-byte what it was.

## 2. MEDIUM — a logged-in customer can degrade provider routing · REPORTED

`public.set_provider_health(text,text,integer,text)` checked only that the
caller was logged in. One request marks any provider `down` /
`quota_exhausted` / `auth_error` with a cooldown of up to 30 minutes, for
everybody.

Impact is bounded: `providerBlocked()` in `lib/server/provider-router.ts`
"never refuses to try the last provider standing", so the effect is degraded
failover rather than an outage, and it expires on its own.

**Not fixed in this pass, deliberately.** The obvious guard — require an admin,
or a recent `usage_events` row of the caller's own against that provider — is
one line of SQL, but the router writes provider health *during* a generation
attempt, and if that correlation is ever absent the guard silently stops
failover from learning anything. That is a worse failure than the nuisance it
prevents, and the generation pipeline cannot be exercised end to end from this
environment. It needs one real generation against a staging provider to
confirm the ordering, then the guard.

The `anon`/`PUBLIC` grant has been removed in the meantime, so the
unauthenticated surface is gone.

## 3. LOW — provider credential ciphertext readable by any logged-in user · PARTIALLY MITIGATED

`public.get_active_provider_credential(uuid)` returned `encrypted_value`, `iv`,
`auth_tag` and `base_url` to any caller with `auth.uid() is not null`, and
carried a `PUBLIC` execute grant.

The value is AES-GCM ciphertext. Decrypting it needs `APP_ENCRYPTION_KEY`,
which is server-only and never reaches a browser, so this is credential
*material*, not a usable key — but there is no reason for a customer to hold it,
and `base_url` leaks internal endpoints.

`PUBLIC`/`anon` execute has been revoked (no behavioural change — the body
already required a session). Closing it for `authenticated` means the `p_token`
pattern this schema already uses (`notification_dispatch_claim`,
`integration_dispatch_read`, `mail_sync_context`), which changes six call sites
on the generation path; `dispatchToken()` returns `null` when the integrations
key is unset, so a mistake there takes image generation down. Recommended as a
dedicated change with the generation pipeline exercised, not as a QA-stage edit.

## 4. Verified clean

| Check | Result |
|---|---|
| Supabase advisors, ERROR level | **0** |
| `apply_credit_transaction` reachable by clients | No — `postgres` and `service_role` only, as `CLAUDE.md` requires |
| `admin_adjust_credits` / `_v2` callable by a customer | Granted to `authenticated`, but both check `is_admin(auth.uid())` in the body |
| `charge_usage_credits` | Requires a session, `is_workspace_member(workspace)`, amount 1–10 000, and only ever debits |
| Secrets in client-reachable code | None. No `'use client'` file reads a non-`NEXT_PUBLIC_` env var |
| `NEXT_PUBLIC_*` in use | `AUTH_PROVIDERS`, `SITE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`, `VERCEL_ENV`, `VERCEL_URL` — no secret among them |
| Admin route guard | `app/admin/layout.tsx` — session, step-up device gate, then `profile.role !== "admin"` → redirect |
| Admin server actions | Every admin-writing action file re-checks the role itself; the files without a guard (`auth`, `feedback`, `notifications`, `platform-access`, `products`, `prompts`, `registration-config`, `settings`, `welcome-bonus`) are read-only public config or scoped to `auth.uid()` under RLS |
| Webhook signature | `app/api/hooks/supabase/send-email/route.ts` still verifies the raw body before parsing — unchanged |
| Turnstile | Still enforced server-side; `captcha_site_key()` returns a key only when the integration is `enabled` (migration 0065) |
| RLS disabled anywhere | No. One INFO advisor: `login_security_challenges` has RLS on with no policy, which denies all client access — the intended posture for a table only `SECURITY DEFINER` functions touch |

## 5. Note on the advisor noise

77 of the 79 advisor findings are
`anon_security_definer_function_executable` /
`authenticated_security_definer_function_executable`. That advisor fires on
*every* `SECURITY DEFINER` function reachable through PostgREST and says nothing
about whether the function guards itself — most of these are correctly guarded
in their bodies, which is why each one was read rather than counted. The three
that were not guarded are §1–§3 above.
