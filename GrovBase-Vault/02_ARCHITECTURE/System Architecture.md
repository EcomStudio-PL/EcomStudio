# System Architecture

Next.js 15 (App Router, RSC-first) + TypeScript strict + Tailwind (CSS-var
tokens) on Vercel serverless (iad1). Supabase = Postgres + Auth + Storage,
RLS everywhere. No service-role key anywhere in the app — every server
query runs under the caller's JWT, so RLS is a second enforcement layer
behind code checks.

```
Browser ──(native form POST / RSC)── Vercel (Next 15)
   │                                    │ anon key + user JWT
   │  signed URLs                       ▼
   └──────────────► Supabase Storage  Supabase Postgres (RLS + definer RPCs)
                                        │ server-side only
                                        ▼
                          AI providers (OpenAI / Google / FAL / img-utils)
                          Resend (email)
```

Key decisions: see [[15_DECISIONS/Architecture Decision Index]].
Business logic lives in `lib/services/*` (takes a SupabaseClient — transport-
agnostic); server actions are thin wrappers; `lib/server/*` is server-only
(crypto, generation, prompt engine, email, image tools).
