# GrovBase security rules

Policy for the Security Guidance plugin. It is advisory input to a reviewer, not a gate —
CodeQL, Gitleaks and Dependency Review stay independent.

No secrets in this file. Ever. It is committed.

## Read this before adding to this file

**This repository is public.** Everything here is world-readable, including by
someone looking for a way in.

So this file states **requirements**, not diagnoses. It says what code must do. It does
not say which of those requirements is currently unmet, where, or how the gap would be
exploited. Several of the rules below exist because a 2026-09-18 audit found a real
instance — but the instances, their locations and their reproduction steps live in the
private Notion audit and the Bugs & Issues database, not here.

If you are tempted to add "…because `X.ts:42` currently gets this wrong and you can
bypass it by doing Y": don't. Put the rule here. Put the finding in Notion.

That distinction is the whole point of the file. A rule is useful to a reviewer whether
or not anything is broken. A reproduction is only useful to someone who wants to break it.

---

## Baseline

- Treat all browser/user input as untrusted.
- Never expose a Supabase service_role key or any provider/API secret to the browser.
  This codebase has **no service-role client at all** (ADR, verified 2026-09-18).
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

## GrovBase-specific requirements

### Credits and metering

- The server must not accept the **existence of a metering row** as evidence that work was
  paid for. Proof of payment is a completed charge, not a record that one was intended.
- Idempotency keys for billable work must be derived server-side and must not be
  reconstructible from values the caller already controls.
- A refund path must verify that a charge actually succeeded before reversing it. Refund
  logic must not key off a field written optimistically ahead of the charge.
- Credit balances change only through `apply_credit_transaction()`. No UPDATE on
  `credit_wallets` from application code, no RLS policy granting clients INSERT on
  transactions.
- Idempotency must cover the **expensive side effect**, not just the billing row. A repeat
  that skips the charge must also skip the paid provider call.
- Every path that debits needs a matching path that refunds when the work does not land,
  and that refund path must be callable by a server job — not only by a session holder.

### Authorization

- Auth and step-up gates belong at the **request layer**. A check that only runs while
  rendering a layout does not protect route handlers or server actions.
- Never derive a security decision from a caller-controlled parameter. Derive it from a
  server-known fact.
- Security policy is read server-side, never accepted as an RPC argument — especially by a
  function that then writes based on it.
- Every `SECURITY DEFINER` function needs an explicit `search_path` **and** its own role
  check. Being granted to `authenticated` is not a role check.
- Match protected routes by **path segment**, not string prefix.
- Reject redirect targets containing control characters rather than stripping them; URL
  parsers normalise before resolving.

### Fail-closed

- A missing or rotated encryption key must not silently disable a security control. If a
  control cannot run, it fails closed or raises loudly — a log line while the admin panel
  still reports the feature as ON is the worst outcome.
- A background job that cannot authenticate must report failure. Returning 200 after
  swallowing the exception makes a job that never runs look healthy.
- Background jobs authenticate with a server token, never with an admin browser session.
  `app/api/cron/mail/route.ts` is the reference pattern.

### Exposure

- `app_settings` is anon-readable. Anything written there is public. Do not add a key
  holding a verifier, a hash, an internal hostname, or operational config not meant for
  visitors.
- A public RPC must return only what the public caller needs. The **grant**, not the
  current caller, defines the exposure.
- Management/control-plane calls must resolve their target project from the environment
  and refuse to run outside production.

### Cost

- Protect expensive AI generation endpoints with authentication, server-side quota/credit
  checks, abuse controls and rate limiting. WAF is not a substitute for any of those.
- A provider adapter that makes N billed sub-calls must surface partial results on failure,
  and must record the cost actually incurred rather than zero.

---

## What this plugin must NOT do here

- Do not auto-apply patches. The open findings are already triaged and sequenced;
  remediation is a separate task with its own test gates.
- Do not "fix" a finding by changing UI, layout, padding, navigation or copy. The
  CURRENT PRODUCTION BASELINE in Notion is frozen. A security fix that changes what the
  user sees is out of scope unless closing the hole genuinely requires it.
- Do not add reproduction steps, file:line locations of open vulnerabilities, or bypass
  techniques to this file. See the note at the top.
