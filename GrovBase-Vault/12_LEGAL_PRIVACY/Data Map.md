# Data Map

| Data | Stored | Purpose | Access | Third party | Retention | Deletion | Risk |
|---|---|---|---|---|---|---|---|
| Email, name | auth.users, profiles | account/login | owner+admin | Supabase (processor) | account lifetime | manual only (gap) | M |
| Password | Supabase Auth (hashed) | login | nobody | Supabase | account lifetime | with auth user | L |
| Product photos | product-images bucket | references for generation | workspace members+admin | Supabase; active AI provider at generation time (server-side) | until deleted | product delete removes rows; storage cleanup PARTIAL | M |
| Generated images | generation-assets bucket | deliverables | workspace+admin | Supabase | indefinite | no user flow (gap) | M |
| Prompts (GrovBase) | generated_prompts (AES-GCM) | generation | server only | AI provider at dispatch | indefinite | none (gap) | L |
| Prompts (custom) | user templates/jobs | generation | workspace | AI provider | indefinite | template delete | L |
| Credits/ledger | credit_wallets/transactions | billing | owner+admin | — | indefinite (accounting) | anonymize on delete (design) | L |
| Usage/cost events | usage_events | billing truth, margins | owner read, admin | — | indefinite | anonymize (design) | L |
| Support messages | support tables | support | participant+admin | Resend (notification email) | indefinite | none (gap) | L |
| IP / request logs | Vercel logs, Supabase logs | ops/security | operators | Vercel, Supabase | platform default (~short) | automatic | L |
| Locale/theme | cookie + user_preferences | UX | owner | — | cookie 1y | clear cookie | none |
