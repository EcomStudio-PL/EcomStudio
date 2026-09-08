# GrovBase AI Control Center — audit and migration map

Written before any code changed. Everything below was read out of the repository
and queried against the production database (`orjkxijqpecnbzhxhfct`), not assumed.

---

## 1. What already exists, and which piece is authoritative

| Concern | Authoritative today | Notes |
|---|---|---|
| Customer-facing modules (name, route, status) | **`lib/features.ts` `FEATURE_REGISTRY` + `feature_availability` table** | 24 keys, 14 rows stored. Status = ACTIVE / COMING_SOON / MAINTENANCE / DISABLED, plus `hidden_from_menu` and a time window. Menu, route guards and API guards all read it. |
| Image micro-tools (editor, upscale, remove_bg, white_bg, expand, shadow, format, compress, watermark) | **`lib/images/tools.ts` `TOOLS`** | Declares `kind: local \| paid`, the provider `capability`, and the `service_catalog` slug each one bills against. |
| Credits + API cost per operation | **`service_catalog`** (15 rows) | `credits_cost`, `api_cost_usd_micros`, `sale_value_cents`, `enabled`, `maintenance_mode`. Price is *snapshotted* onto every usage event. |
| AI providers | **`ai_providers`** (9 rows) | slug/name/active/metadata.kind. |
| Provider API keys | **`ai_provider_credentials`** (3 rows) | AES-GCM ciphertext + iv + auth_tag + `last_four`, admin-only under RLS, read at runtime through the `get_active_provider_credential` definer RPC. |
| Image-tool provider keys | `lib/images/providers.ts` + env vars, **with `vaultSlug` bridging to `ai_providers.slug`** | Not a second store: the env var is a fallback, the vault is the same credential table. |
| Models | **`ai_models`** (7 rows) | provider_id, model_identifier, per-resolution `pricing`, `credit_cost`, `internal_cost_usd_micros`, capabilities, `visible_managed` / `visible_custom`. |
| Which models a customer may pick | `lib/ai/router.ts` `getUsableModels` | active model ∧ active provider ∧ registered adapter ∧ a stored credential. |
| Provider adapters | `lib/ai/registry.ts` + `lib/ai/providers/*` | openai, google, fal. |
| Provider health / cooldown | **`provider_health`** + `lib/server/provider-router.ts` | 3-state, cooldown window, concurrency lanes, retry policy. |
| Usage + economics telemetry | **`usage_events`** (23 columns, 225 rows) | user, workspace, service_slug, provider_slug, model_slug, `credits_charged`, `api_cost_usd_micros_snapshot`, **`actual_api_cost_usd_micros`**, `sale_value_cents_snapshot`, status, `provider_request_id`, idempotency key. Written only through `startUsage` / `completeUsage` / `failUsage`, which are the single credit writer and the single refund path. |
| Margin / anomaly maths | `lib/services/economics.ts` | `sliceEconomics`, `modelEconomics`, `costAnomalies`. |
| Hidden prompt engine (shots) | `lib/ai/engine/*` (code) + `prompt_engine_rules` + `prompt_engine_versions` | The master prompt is **in code**; rules and a global version label are in the database. |
| Knowledge / reference packs | **`knowledge_sets`** + **`knowledge_examples`** | ZIP import, embeddings, encrypted hints. Retrieval in `lib/server/knowledge.ts`. |
| Prompt sessions (GrovShot history) | `prompt_sessions` (53 rows) | Concept payloads encrypted at rest. |
| Notifications / Telegram | `lib/server/notify.ts`, `notification_outbox`, `integration_settings` | One transport, already used by every event. |

**Nothing in the list above is missing.** The problem the brief describes is
real but narrower than it looks: the pieces exist and work, and the admin panel
shows them through six unrelated screens with no join between them.

## 2. What genuinely does not exist yet

1. **A tool record.** Nothing ties "Retusz" the customer-facing module to the
   service it bills, the model it runs on and the prompt it uses. Today those
   three facts live in three files and two tables and are only connected inside
   the request handler.
2. **Per-tool engine configuration.** There is one hidden engine (GrovShot) and
   it is hard-coded. A tool cannot be declared "no engine yet" and later be
   given one without editing code.
3. **Per-tool system prompts with versions.** `prompt_engine_versions` versions
   *the engine as a whole* (one row); there is no per-tool prompt to version.
4. **Model assignment per tool.** A model is offered to a *generator surface*
   (`visible_managed` / `visible_custom`), never to a tool, and there is no
   primary/fallback pair.
5. **Knowledge assignment.** `knowledge_sets` has no link to a tool; retrieval
   is global.
6. **Provider budgets and threshold alerts.** Health exists; spend limits do not.

## 3. OLD → NEW migration map

| Old admin entry | Route | New home |
|---|---|---|
| **Generacje** | `/admin/generations` | stays — it is the *output log*, not configuration. Filtered by status and paginated. |
| **Modele AI** | `/admin/models` | → `/admin/ai/modele?tab=modele` |
| **Dostawcy AI** | `/admin/providers` | → `/admin/ai/modele?tab=dostawcy` |
| **Image Tools** (backend status + economics) | `/admin/tools` | backends → `/admin/ai/modele?tab=dostawcy` (**Backendy narzędzi**); per-tool economics → **Narzędzia i silniki → \<tool\> → Ekonomia** |
| **AI Engine** (knowledge, rules, versions) | `/admin/engine` | → `/admin/ai/wiedza` (the library), attached per tool from **\<tool\> → Wiedza** |
| **Silnik ujęć** (concept sessions) | `/admin/concepts` | → `/admin/ai/prompts?tab=history`; one session → `/admin/ai/sesje/[id]` |
| **Szablony promptów** | `/admin/templates` | → `/admin/ai/szablony` |
| **Usługi / ceny** | `/admin/services` | unchanged — the catalogue keeps its own screen; **Modele, API i koszty → Modele** only reads its prices |

The AI group in the admin menu is now three entries: **Narzędzia i silniki**,
**Modele, API i koszty**, **Generacje**. `Baza wiedzy`, `Szablony promptów` and
`Sesje ujęć` are reachable from inside those, not from the menu.

Every old URL keeps working: Stage 5 turned each of them into a `redirect()`
rather than deleting it, exactly as the Admin IA refactor did in
`docs/admin-route-migration.md` — including `/admin/concepts/[id]`, which a
Telegram link or a bookmark may still point at.

Nothing was retired before its job had somewhere else to live. The three things
the new screens did not yet cover were moved first: the knowledge library
(page moved to `/admin/ai/wiedza`), the prompt templates and blocks (moved to
`/admin/ai/szablony`) and the shot sessions (listed in GrovShot's **Historia**,
detail page moved to `/admin/ai/sesje/[id]`). The image-tool backends —
remove.bg, the upscalers, the outpainting providers, which are resolved from
their own credentials and are not `ai_providers` rows — became a **Backendy
narzędzi** block on the Dostawcy tab.

## 4. New schema (migration 0070) — four tables, no rewrites

Named against what the brief asked for conceptually, but only where an
equivalent did **not** already exist:

| Brief's concept | Decision |
|---|---|
| TOOLS | **new `ai_tools`**, keyed by the *feature registry key* so route, name and status keep coming from `lib/features.ts` + `feature_availability`. `ai_tools` holds only the AI configuration. |
| PROVIDERS | existing `ai_providers` |
| MODELS | existing `ai_models` |
| TOOL_MODEL_ASSIGNMENTS | **new `ai_tool_models`** (role: primary / fallback / allowed) |
| TOOL_ENGINE_CONFIG | columns on `ai_tools` |
| PROMPT_VERSIONS | **new `ai_tool_prompts`** (encrypted body, draft/published, full history) |
| KNOWLEDGE_SETS | existing `knowledge_sets` |
| KNOWLEDGE_ASSIGNMENTS | **new `ai_tool_knowledge`** |
| AI_REQUEST_USAGE | existing `usage_events` |
| PROVIDER_PRICING | existing `ai_models.pricing` / `internal_cost_usd_micros`, `service_catalog.api_cost_usd_micros` |
| ADMIN_ALERT_RULES | **new `ai_provider_budgets`**, delivered through the existing notification/Telegram transport |

### Engine modes

```
off       — no hidden prompt. Compression, resize, watermark: deterministic pixels.
grovbase  — a hidden GrovBase system prompt only. The customer writes nothing.
user      — the customer's prompt only.
hybrid    — hidden system prompt + the customer's input.
```

The hidden body lives in `ai_tool_prompts.body_encrypted` (AES-GCM, same
`APP_ENCRYPTION_KEY` as every other secret) and is decrypted **only** inside a
server module. It is never selected by any client-reachable query, never
returned by an action, and never written to a job row.

### A tool with no engine yet

`ai_tools` rows may exist with `engine_mode = 'off'` and no model, no prompt and
no knowledge. That is the whole point of the table: a new front-end tool can
ship, appear in the registry, and be given intelligence later by an operator
without a schema change or a deploy.

## 5. Safety rules carried into the build

- Uploaded PDFs / ZIPs / metadata are **data**. They may produce a *candidate*
  prompt version; they can never publish one. Publishing is an explicit admin
  action with an author and a reason, recorded in `ai_tool_prompts`.
- No production prompt is ever silently overwritten — a publish creates a new
  version and marks the previous one superseded, so restore is always possible.
- Credits stay on the existing ledger path (`startUsage` / `charge_usage_credits`
  / `fail_usage_event`). Nothing in this work writes a wallet.
- Retries stay at `MAX_ATTEMPTS_PER_PROVIDER = 3` with the existing backoff.
  A fallback model is one *additional* attempt, not a second full retry budget —
  double-charging an API is worse than showing an error.
- Every read and write in the new admin surface goes through a server-side
  `is_admin` check, in the database (SECURITY DEFINER functions) as well as in
  the action.
