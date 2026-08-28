# ADR-0005 Vendor-neutral AI routing
Decision: adapters implement ImageProviderAdapter; models/providers/
credentials/pricing are DB rows; router resolves usable chain (active +
credential + health + resolution support). No adapter registered without a
real key — no fake generations ever.
Why: provider churn is certain; catalog changes must not need deploys.
