# Subprocessors (detected from code/config — verify contracts/DPAs)

| Provider | Purpose | Data sent | Side | Region | DPA action |
|---|---|---|---|---|---|
| Supabase | DB/Auth/Storage | all customer data | server | project-region (verify in dashboard) | sign/download DPA |
| Vercel | hosting, logs | traffic, IPs | server | iad1 functions | DPA available — verify |
| Resend | transactional email | recipient email, message text | server | verify | DPA — verify |
| OpenAI / Google (Gemini) / FAL | image generation | product images, prompts | server, only when active + selected | verify per provider | DPA/API terms — verify |
| Stability / Clipdrop / PhotoRoom / remove.bg | image utilities | uploaded image being processed | server, per tool | verify | verify |
No client-side processors (no analytics/pixels/CDNs beyond Vercel).
Never state retention promises for these without reading their terms.
