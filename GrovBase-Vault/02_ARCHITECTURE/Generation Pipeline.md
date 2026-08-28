# Generation Pipeline

1. `runPromptSession` (lib/server/prompt-engine.ts): analysis (cached by
   image hash + lock version) → Product Lock v3 → master template → N
   prompts stored ENCRYPTED (prompt_encrypted/iv/tag) in
   `generated_prompts`; resolution persisted on the session.
2. `generateFromConcept` (lib/server/concept-generation.ts): ownership
   re-check → model chain from `getUsableModels` (DB-active + credentials
   + health) → cost = pricing[resolution] (+ ecom surcharge) → decrypts the
   prompt at the last moment → `runGeneration`.
3. `runGeneration` (lib/server/generation.ts): quantity clamp 1–4 →
   balance gate → `startUsage` (idempotency key `job:{id}`, unique DB
   constraint) → `charge_usage_credits` (membership-checked definer) →
   provider call with fallback chain + health writes → store to
   `generation-assets/{ws}/{job}/{idx}` → batch-sign URLs →
   `complete_usage_event` (records real API cost) — or
   `fail_usage_event` (single replay-guarded refund).

Provider router: priority order, `provider_health` cooldowns (max 30 min),
error classification, per-model `fallbackModelIds` filtered to engines
supporting the paid resolution so quote always equals charge.
