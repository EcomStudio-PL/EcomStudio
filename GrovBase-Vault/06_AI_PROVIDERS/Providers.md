# Providers

Provider identity is DATA: `ai_providers` (slug, active) + encrypted
credentials (`ai_provider_credentials`: AES-GCM value/iv/tag + base_url).
Adapters in `lib/ai/providers/`: openai, google, fal. Image utilities in
`lib/images/providers.ts`: stability, clipdrop, photoroom, remove.bg.
Email: Resend. Routing: priority + provider_health cooldowns + error
classification; fallback chain filtered by resolution support.
A provider is "usable" only when DB-active AND a credential decrypts —
no keys, no fake generation.
