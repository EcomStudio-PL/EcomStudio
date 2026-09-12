# Photoroom

Photoroom is a provider inside the existing image-tools architecture, not a
system beside it. It uses the same credential vault, the same cost engine, the
same credit reservation and the same usage ledger as fal, Stability, Clipdrop
and remove.bg.

## What it is wired to

| GrovBase tool | Endpoint | Photoroom parameters | Cost |
|---|---|---|---|
| Usuń tło (`remove_bg`) | `/v1/segment` | `format=png` | $0.02 |
| Upscale (`upscale`) | `/v2/edit` | `upscale.mode=ai.fast` | $0.10 |
| Rozszerz kadr (`expand`) | `/v2/edit` | `expand.mode=ai.auto`, `outputSize` | $0.10 |
| Tło AI (`ai_background`) | `/v2/edit` | `background.prompt` **or** `background.color` | $0.10 |
| Doświetlenie (`relight`) | `/v2/edit` | `lighting.mode=ai.auto` / `ai.preserve-hue-and-saturation` / `ai.optimize-portrait` | $0.10 |
| Cień AI (`ai_shadow`) | `/v2/edit` | `shadow.mode=ai.soft` / `ai.auto-with-overrides` | $0.10 |
| Upiększanie (`beautify`) | `/v2/edit` | `beautify.mode=ai.auto` / `ai.food` | $0.10 |
| Odtwórz kadr (`uncrop`) | `/v2/edit` | `uncrop.mode=ai.auto` | $0.10 |
| Niewidzialny manekin (`ghost_mannequin`) | `/v2/edit` | `ghostMannequin.mode=ai.auto` | $0.10 |

The first three are existing tools that gained a new possible backend; their UI
did not change. The last six are new.

### Two facts the integration is built around

**`/v2/edit` removes the background by default.** It is an editor, not a
filter. Anything that means "improve this photograph" must send
`removeBackground=false` and `referenceBox=originalImage`, or it returns a
transparent cutout instead. Upscale, expand, relight, beautify and uncrop send
both; AI background, AI shadow and ghost mannequin deliberately do not, because
they act on the subject. `scripts/photoroom-tests.ts` asserts this per
operation — it is the regression most likely to ship silently.

**Photoroom bills per image by which API answered**, in both directions and
regardless of plan: $0.02 for the Remove Background API, $0.10 for the Image
Editing API. That is why background removal stays on `/v1/segment` — the same
cutout for a fifth of the price — and why Photoroom sits LAST in the upscale
and expand preference lists, so an operator who also has a fal key keeps paying
fal's $0.006.

## Connecting a key

1. Admin → **Modele, API i koszty → Dostawcy** → Photoroom → **Konfiguruj**.
2. Paste the key. It is encrypted with AES-256-GCM before it is stored
   (`lib/server/crypto.ts`), and only the last four characters are ever sent
   back to the browser.
3. Press **Testuj połączenie**. The probe posts a request with *no image*:
   authentication is checked before the missing image is, so a bad key answers
   401/403 and a good one answers 400 — and a 400 is the success case. It costs
   nothing. The message says whether the key is live or sandbox.
4. **Activate** the provider with the toggle on the card. A stored key on an
   inactive provider is deliberately not used.

`PHOTOROOM_API_KEY` in the server environment still works and takes precedence
over the vault, for anyone who prefers env config.

## Sandbox

Sandbox is a property of the **key**, not of a URL: a key beginning with
`sandbox_` runs against the same endpoints, costs nothing, is capped (roughly
1000 calls a month, 100 a day) and returns a **watermarked** image.

So switching environment means storing the other key. GrovBase derives the
environment from the key when it is saved and records it in
`ai_providers.metadata.environment`, so the panel can say which one is in use —
and the cost engine charges **zero credits** for a sandbox run, because billing
a seller for a watermarked image would be taking money for something they
cannot use.

## Prices and margin

Nothing about Photoroom's pricing is hardcoded into what a seller pays. The
cost engine (`lib/images/pricing.ts`) takes the provider's per-call USD cost and
raises it to whatever satisfies the margin floor:

```
price_pln ≥ cost_pln × (1 + buffer) / (1 − margin_floor)
```

- Global dials — credit price, USD/PLN, margin floor, buffer — live in
  `app_settings.billing`, edited at **Admin → System**.
- Per-tool floor prices live in `service_catalog.credits_cost`, edited at
  **Admin → Usługi**. The floor can only raise a price, never drop it below the
  margin rule.
- At the defaults (0.19 PLN/credit, 4.0 PLN/USD, 50% margin, 12% buffer) a
  $0.10 edit prices at 5 credits and a $0.02 cutout at 1.

Switching a cheaper provider on makes every tool it serves cheaper
automatically, with no deploy.

## Free background removal

Off by default. `app_settings.free_tools.remove_bg`:

```json
{ "enabled": false, "limit": 10, "window": "day", "plans": [] }
```

`window` is `day` | `week` | `month` and is a **calendar** window in UTC —
"10 a day, resets at midnight" is something a seller can predict, where a
rolling 24 hours reads as a broken counter. `plans` empty means every plan.

The limit is counted and consumed in one statement (`claim_free_tool_run`), so
a batch running three at a time cannot race past it. A grant is taken before
the provider call and is **not** returned if the provider fails — the
conservative direction, since the alternative failure mode is an unbounded free
tier. Free runs are marked `free_grant` on the usage row so the economics view
can still see their real cost.

Only `remove_bg` is eligible (`FREE_ELIGIBLE` in `lib/server/free-tools.ts`).
That list is closed on purpose: a stray settings key must not be able to give
away a $0.10 tool.

## Where the code is

| Concern | File |
|---|---|
| Wire format, parameters, cost constants | `lib/images/providers.ts` |
| Tool catalogue, settings shapes, defaults | `lib/images/tools.ts` |
| Provider resolution, pricing, credits, run | `lib/server/image-tools.ts` |
| Free allowance | `lib/server/free-tools.ts` |
| Connection test | `lib/server/provider-test.ts` |
| Key storage | `app/actions/credentials.ts` |
| Settings panels | `components/tools/settings.tsx` |
| Catalogue cards | `app/(app)/tools/page.tsx` |
| Schema | `supabase/migrations/0075_photoroom_tools.sql` |
| Tests | `scripts/photoroom-tests.ts` (`npm run test:photoroom`) |

## Deliberately not wired

These exist in the Photoroom API but are **not** exposed as GrovBase tools,
because their parameter surface could not be verified from a primary source
during implementation and a tool built on a guessed parameter name ships as a
broken tool:

- `outline.*` (subject outline)
- `flatLay.*` (flat lay) — mode value `ai.auto` is known, the rest is not
- `ironing.*` (wrinkle removal)
- `virtualModel.*` (AI fashion models) — likely needs more than a mode
- `segmentation.*` (text-guided segmentation, alpha)
- `export.dpi`, and the GET/`imageUrl` form of the endpoint

Adding any of them is small: one `EDIT_OPERATIONS` entry, one branch in
`photoroomEdits.edit`, one tool row, one settings panel, three i18n entries and
one `service_catalog` row.
