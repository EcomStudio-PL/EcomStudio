# Supabase Architecture

- PROD ref `orjkxijqpecnbzhxhfct` (PROTECTED), DEV ref `ezyhwkcrrysanbcbkzsq`.
- Schema changes reach PROD only via `supabase/migrations/` (0001–0038).
- RLS on every user-accessible table; helpers `is_admin()`,
  `is_workspace_member(ws)`, `is_workspace_manager(ws)` (SECURITY DEFINER,
  auth.uid()-based).
- No service-role key in the application. Privileged writes happen through
  a small audited SECURITY DEFINER RPC surface (see RLS Policies note) —
  every one validates auth.uid() + membership/role internally, `search_path`
  pinned, anon EXECUTE revoked (migration 0036).
- Storage buckets: `product-images` (private, 10MB, image MIME),
  `generation-assets` (private, 25MB), `media` (public, admin-write),
  `workspace-branding` (public read, member write). All content policies
  scope by first folder segment = caller's workspace UUID.
