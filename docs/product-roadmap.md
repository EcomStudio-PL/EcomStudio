# Product roadmap

## Shipped (v0.1 — foundation)
Auth (register/login/reset, welcome bonus 25 credits), workspaces, products CRUD + reference image uploads (reorder/primary/delete, signed URLs), template-based prompt generation (7 concepts, honestly non-AI), generator UI with 11 material types × 4 formats gated behind honest "no AI connected" state, credit ledger + wallet UI, plans catalog, history/library scaffolding, admin panel (10 sections, audit logs), i18n PL/EN/DE, light/dark/system themes, responsive + mobile bottom nav.

## Next
1. **AI image generation v1** — first provider adapter (e.g. Gemini image or fal.ai), job execution + storage of assets, credit charge/refund on fail, Product Lock instructions injected into every prompt.
2. **AI product analysis** — describe reference photos, auto-fill `product_images.ai_description`, upgrade prompt generation from templates to analysis-driven; product fidelity scoring (`product_match_score`) + regeneration flow.
3. **Stripe** — checkout for top-ups + subscriptions, webhooks → `apply_credit_transaction`, plan enforcement.

## Later
Batch generation, marketplace exports (Allegro/Amazon formats), video, workspace member invitations + operator mode UI, public API for mobile app (Expo), multi-workspace switching, priority queue for Pro/Agency.
