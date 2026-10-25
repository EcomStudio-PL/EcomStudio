-- ============================================================================
-- 0159 — PUBLIC TOOLS: A VISITOR'S PAGE ASKS "CAN THIS TOOL RUN?" THE WAY A
-- CUSTOMER'S DOES.
--
-- A visitor has no session, so the server reads a public tool page through
-- guestReadClient: the anon key plus the server token in `x-grovbase-server`
-- (0157). 0157 let that read reach every token-gated reader a tool page needs
-- — ai_tool_runtime, secret_read, provider_credential_read, … — but not
-- prompt_master_key. Retusz and Miniaturka decide "configured" by opening their
-- published prompt (engineToolConfigured, readPublishedPrompt), so on a
-- visitor's page they could not open it and both tools read as "chwilowo
-- niedostępny" while a signed-in customer saw them working.
--
-- THE GATE IS THE TOKEN, NOT THE ROLE. prompt_master_key returns the key only
-- to a caller presenting the prompt-key token whose sha256 is pinned in Vault
-- (derived from the server's own secret; pinning itself requires
-- server_call_ok). A browser holding the public anon key has neither and gets
-- 'forbidden', exactly as before. This is the same arrangement 0157 made for
-- secret_read. Nothing else changes: no prompt is copied, no other function is
-- granted, and the key never leaves the server.
-- ============================================================================

grant execute on function public.prompt_master_key(text, text) to anon;

comment on function public.prompt_master_key(text, text) is
  'The Vault-held prompt-content master key (64 hex), created on first use. Server only: the caller must present the prompt-key token whose sha256 is pinned in Vault (pinned on the first call, which must also pass server_call_ok). Executable by anon since 0159 only so the SERVER can read for a visitor''s page (guestReadClient); the token gate is unchanged, so an anonymous browser, a customer or an admin browser session still gets forbidden. Never returns any other vault secret.';
