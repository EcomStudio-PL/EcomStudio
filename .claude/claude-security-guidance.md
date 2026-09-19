# GrovBase security rules

Policy for the Security Guidance plugin. It is advisory input to a reviewer, not a gate —
CodeQL, Gitleaks and Dependency Review stay independent.

No secrets in this file. Ever. It is committed.

## Scope note

The generic half of this list is the standard web checklist. The **GrovBase-specific** half
below it is derived from the Pre-Launch Full Codebase Audit (2026-09-18) — every rule there
exists because the audit found a real instance of that mistake in this repository. Treat those
as regression guards, not theory.

---

## Baseline

- Treat all browser/user input as untrusted.
- Never expose a Supabase service_role key or any provider/API secret to the browser.
  This codebase currently has **no service-role client at all** (ADR, verified 2026-09-18).
  Introducing one is an architecture decision, not an implementation detail.
- Any access to a user-owned record must enforce ownership/workspace authorization
  server-side, and via Supabase RLS where applicable.
- Check for IDOR whenever a route accepts `user_id`, `workspace_id`, `product_id`,
  `generation_id`, a storage path, a contact/campaign/page id, a subscription id, or similar.
- Never trust a client-supplied credit balance, plan, price, role, admin flag, cost, or
  payment status.
- Admin endpoints require explicit server-side authorization. Hiding UI is not authorization.
- Webhooks must verify provider signatures and be idempotent. Do not rate-limit trusted
  webhooks by IP blindly — providers share egress addresses.
- Validate upload type/size and storage path; prevent cross-user file access.
- Do not log passwords, auth tokens, API keys, service_role, payment secrets, full
  Authorization headers, or customer content.
- New redirects/callback URLs must be allowlisted; avoid open redirects.
- Any user-controlled URL fetched server-side must be reviewed for SSRF.
- Any HTML rendered from user- or admin-controlled content must be reviewed for XSS.
- Security fixes must preserve existing GrovBase UI, auth, credits, billing and product
  flows unless the change is required to close the vulnerability.

---

## GrovBase-specific (each one is a real finding)

### Credits and metering

- **A row in `usage_events` is not proof that the server created it.** Clients hold INSERT
  on that table, and the idempotency key is a hash of inputs the client already knows, so a
  caller can pre-insert a row and make the charge step skip itself. Never treat "an event
  with this key exists" as "this work was paid for". (P0-01)
- **A refund requires an actual charge.** Do not issue `usage_event_fail` / any refund path
  on a charge that failed — `credits_charged` is written optimistically before the debit, so
  a failed debit followed by a refund mints credits. A refund must verify the debit
  transaction exists. (P0-02)
- Credit balances change only through `apply_credit_transaction()`. No UPDATE on
  `credit_wallets` from application code, no RLS policy granting clients INSERT on
  transactions.
- Idempotency must cover the **expensive side effect**, not just the billing row. A repeated
  request that skips the charge but still calls Stability/Clipdrop/Photoroom/remove.bg burns
  real money with the customer billed zero. (P1-26)
- A generation's idempotency key must be derived from the *meaning* of the request on the
  server. A key minted inside the request it is meant to deduplicate (`job:${job.id}`)
  deduplicates nothing. (P1-25)
- Every path that debits must have a matching path that refunds when the work does not land,
  and that refund path must be callable by a server job — not only by a session holder. (P1-30)

### Authorization

- **Auth gates belong at the request layer, not the render layer.** A check that runs in
  `layout.tsx` is absent from every route handler and server action, so a stolen password
  alone reaches `/api/generate`, `/api/tools/run`, `/api/library/zip`. (P1-23)
- **Never derive a security decision from a caller-controlled parameter.** The closed-signup
  gate was bypassable with `next=/reset-password` because the exemption read `next`. Derive
  it from the OTP type or another server-known fact. (P1-06)
- Security policy is read server-side, never accepted as an RPC argument. A function that
  takes "should this device be trusted" as a parameter and then WRITES based on it lets the
  caller disable their own second factor. (P1-17)
- Every `SECURITY DEFINER` function needs an explicit `search_path` **and** its own role
  check. A definer function granted to `authenticated` with no `is_admin()` gate is an
  admin API handed to every logged-in user. (P1-16)
- Match protected routes by **path segment**, not string prefix. `startsWith("/k")` also
  claims `/kontakt` and `/klauzula-rodo`. (P1-15)
- Reject redirect targets containing control characters rather than trimming them. URL
  parsers strip `\t\r\n` before resolving, so `/\t/evil.com` becomes an absolute origin. (P1-13)

### Fail-closed

- A missing or rotated encryption key must not silently disable a security control. If a
  control cannot run, it fails closed or raises loudly — `console.warn` while the admin panel
  still reports the feature as ON is the worst outcome. (P1-24)
- A background job that cannot authenticate must report failure. Returning 200 after
  swallowing the exception makes a job that never runs look healthy. (P1-05/08/29)
- Background jobs authenticate with a server token (`CRON_SECRET`, worker token), never with
  an admin browser session. `app/api/cron/mail/route.ts` is the correct pattern.

### Exposure

- `app_settings` is anon-readable. Anything written there is public. Do not add a key
  holding a verifier, a hash, an internal hostname, or operational config that is not meant
  for visitors. (P1-22)
- A public RPC must return only what the public caller needs. Do not return an SMTP identity
  or a sealed credential from a function granted to `anon`, even when the only current caller
  is a server route — the grant, not the caller, defines the exposure. (P1-04)
- Management/control-plane calls must resolve their target project from the environment and
  refuse to run outside production. A hardcoded production project ref means any preview
  deployment holding the token can reconfigure production. (P1-12)

### Cost

- Protect expensive AI generation endpoints with authentication, server-side quota/credit
  checks, abuse controls and rate limiting. WAF is not a substitute for any of those.
- A provider adapter that makes N billed sub-calls must surface partial results on failure.
  Throwing away three paid images because the fourth 429'd, then retrying the whole batch,
  multiplies spend invisibly — especially when the recorded cost is zero. (P1-14)

---

## What this plugin must NOT do here

- Do not auto-apply patches. GrovBase has a complete audit with 3 P0 and 31 P1 findings
  already triaged; remediation is a separate, sequenced task with its own test gates.
- Do not "fix" a finding by changing UI, layout, padding, navigation or copy. The
  CURRENT PRODUCTION BASELINE / FREEZE REGISTRY in Notion is frozen. A security fix that
  changes what the user sees is out of scope unless closing the hole genuinely requires it.
- Do not flag the published `dispatch_hash` as offline-crackable. It is sha256 of a
  ≥32-char random value; the code comment anticipates exactly this. The real (minor) point
  is that publishing a verifier is needless exposure.
