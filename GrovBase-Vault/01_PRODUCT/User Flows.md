# User Flows

## Core generation flow (engine mode)
1. `/prompts`: pick/create product → upload reference photos (workspace-
   scoped storage) → choose shot types + category controls → toolbar decides
   model/ratio/resolution/shots → submit.
2. Server (`runPromptSession`): vision analysis (cached by image hash) →
   Product Lock → N encrypted prompts → `prompt_sessions` + `generated_prompts`.
3. Concept board: generate one/all → `/api/concepts/generate` →
   `generateFromConcept` → `runGeneration` (charge → provider → store →
   complete/refund).
4. Library shows assets via signed URLs (1h TTL).

## Auth flow
Login form does a NATIVE POST to `/auth/sign-in` (303 + Set-Cookie with full
attributes) → warm-up read absorbs DB clock skew → redirect. Middleware
refreshes sessions and guards protected prefixes.

## Credits flow
Ledger only: `apply_credit_transaction` (SECURITY DEFINER, row-lock,
balance check) — called through `charge_usage_credits` / refunds through
`fail_usage_event`/`refund_usage_event` (replay-guarded).
