# GrovBase (formerly EcomStudio) — project guide for AI-assisted development

Production SaaS for e-commerce sellers: turn product reference photos into professional sales content (photos → prompts → AI generations → marketplace export). Product fidelity beats artistic creativity.

## Stack
Next.js 15 (App Router) · TypeScript strict · Tailwind (CSS vars, dark via `.dark`) · Supabase (Postgres + Auth + Storage, RLS everywhere) · Vercel. Stripe and AI providers come later.

## Environments
- Supabase DEV `ezyhwkcrrysanbcbkzsq` — active development.
- Supabase PROD `orjkxijqpecnbzhxhfct` — PROTECTED. Never run dev experiments, destructive SQL, or data mutations there without explicit permission. Schema changes reach PROD only via the migrations in `supabase/migrations/`.
- Connection config: `lib/supabase/config.ts` (env-first, DEV anon fallback). Anon/publishable keys are safe client-side; service-role keys must NEVER appear in frontend code or NEXT_PUBLIC vars.

## Architecture rules
- Business logic lives in `lib/services/*` and takes a `SupabaseClient` argument — transport-agnostic so a future React Native app can reuse it behind API routes. UI components stay thin.
- Server actions (`app/actions/*`) are thin wrappers: auth context → service call → `log_activity` → revalidate.
- AI: never couple to one vendor. `lib/ai/types.ts` defines `ImageProviderAdapter`; adapters register in `lib/ai/registry.ts`; `lib/ai/router.ts` resolves usable models (DB-active + adapter configured). No adapter is registered until real API keys exist — never fake generations; show honest "unavailable" states instead.
- Product Lock: preserve exact shape, proportions, colors, item count, buttons, ports, labels, accessories, materials, scale. PROMPT ENGINE IS EXPLICIT: the lock text (`lib/ai/product-lock.ts`) reaches a model ONLY where a template places `{{fidelity_rules}}` — never as an automatic append. User prompt (generator "Własny prompt") = exact passthrough. Tool prompts = the published template + explicit variables; tools have NO built-in/fallback prompt (nothing published → `prompt_unconfigured`, 0 calls, 0 credits). Knowledge only via `{{knowledge_*}}`. The final prompt is fixed before `runGeneration`; adapters only serialise it (`GenerationRequest.prompt` verbatim); the Gemini body is built only in `lib/ai/providers/google-request.ts`, which also picks the image kept from a response (`pickGeminiFinalImage`: the LAST non-`thought` image — Gemini 3 Pro Image returns interim draft images first; a draft is never delivered). Retusz is its own minimal path (`strictSingleImage`): ONE stateless call to the Gemini **Interactions API** — `POST /v1beta/interactions`, body exactly `{model: "gemini-3-pro-image", input: [{type:"text", text: PROMPT}, {type:"image", data, mime_type}], response_modalities: ["image"], store: false}` (`buildRetouchInteraction` in `google-request.ts`; the official cookbook's image-edit shape, [text, image]), key in `x-goog-api-key`, `Api-Revision: 2026-05-20`. No previous_interaction_id, system_instruction, generation_config (so NO image size and NO aspect ratio — Google's default size, the photo's own shape), tools or safety settings. One model, one request: no fallback, no retry (runGeneration forces it). The final image is the SDK's `output_image` rule (`pickInteractionFinalImage`: last image in `model_output` steps; `thought` drafts never kept); none → error + refund. The STORED photo bytes go as-is even with an EXIF orientation flag (`prepareReferenceImage(..., { exact: true })`). Runtime guards, before any paid call: runGeneration refuses `retouch_prompt_parity_failed` if the text to send ≠ the resolved published prompt; the adapter parses the serialised body back and refuses `retouch_request_contract_failed` (no HTTP) unless it is exactly that shape with the prompt byte for byte and a photo hashing to the stored original (`strictInputSha256`). Retusz is STATELESS (`STATELESS_TOOL_KEYS`): its template may place only aspect_ratio/resolution/image_count/fidelity_rules, no 👍/👎 (UI hidden, `app/actions/feedback.ts` refuses), no knowledge tab/strategy. The size/format pickers are hidden for now (price = the 1K price, `retouchRunResolution`); 1K/2K/4K and manual framing return as a separate stage. The adapter reads back the EXACT string it hands to fetch (`captureInteractionBoundary`) and the engine stores it with the published→resolved→provider prompt chain in plain SHA-256 on the admin-only `ai_engine_runs.network_boundary` (Testuj konfigurację → Granica sieciowa); the job row keeps keyed digests + a sanitised payload. `npm run test:retouchforensic` drives UI body → real `/api/retouch` route → serializer and compares it byte for byte with an independent hand-written request (`scripts/retouch-baseline.ts`, imports nothing from the app). Every other tool keeps generateContent via `buildGeminiImageRequest` ([image…, prompt]). Never derive/snap a ratio (tried in 30b6f7c, worse PROD results, reverted; `lib/ai/aspect-ratio.ts` is diagnostics only). The photo itself is never cropped/resized. `generations.product_match_score` / `quality_status` store fidelity checks.
- Credits: ledger-only. Balances change exclusively through `public.apply_credit_transaction()` (SECURITY DEFINER, revoked from clients). Never let users write wallets/transactions.
- Roles: `profiles.role` (user/admin) guarded by a DB trigger against self-escalation. Workspace roles in `workspace_members`. Admin/operator actions on customer data must call `log_activity` (supports `on_behalf_of`).
- i18n: PL (default), EN, DE. No hardcoded user-facing strings — everything through `lib/i18n/dictionaries/*.json` (`makeT` server-side, `useI18n` client-side). Locale = `ecs_locale` cookie + `user_preferences.locale`.
- Themes: light/dark/system via next-themes + CSS variables in `app/globals.css`.

## Development rules
1. Read existing code before changing it; reuse existing patterns; no parallel systems.
2. Small isolated upgrades; preserve working functionality; keep backwards compatibility.
3. DB changes = new migration file in `supabase/migrations/` applied via Supabase migrations (never ad-hoc prod SQL, never disable RLS).
4. No `any` / `@ts-ignore` / disabled checks to hide errors.
5. After meaningful changes run `npm run typecheck` and `npm run build`.
6. No fake functionality: unfinished features are visibly marked "coming soon / unavailable".
7. Vercel: preview deployments before production.

## Key data flow
product → product_images (Storage `product-images/{workspace_id}/{product_id}/…`) → generated_prompts (templates now, AI analysis later) → generation_jobs → generations (+ match score) → generation_assets → export (later).

## External documentation (Context7)
When implementing or configuring external libraries/frameworks/APIs, use Context7 for current
documentation when it is relevant. Prefer documentation matching the versions already installed in
this repository — read them from `package.json`, do not assume latest.

Do not upgrade a dependency only to match an example unless explicitly requested. A Context7 snippet
that needs a newer major version is a reason to write the code the installed version supports, or to
raise the upgrade as its own decision — never a reason to bump the version silently as a side effect
of an unrelated task.
