-- PROMPT CONTENT KEY IN SUPABASE VAULT.
--
-- Tool system prompts, workflow step prompts, GrovShot's intermediate prompts,
-- knowledge hints and engine rules are GrovBase IP, stored as AES-256-GCM
-- ciphertext. Until now the key was APP_ENCRYPTION_KEY from the deploy
-- environment — and production no longer has that variable (the integration
-- secrets moved to Vault in 0078, the prompt key did not). With no key the
-- admin panel refused to save a prompt at all: "Brak klucza szyfrowania".
--
-- From here the key is ONE Vault secret, `grovbase.prompts.master_key_v1`:
--
--   · created by the database itself with a CSPRNG (gen_random_bytes), never
--     typed, never in a file, never in an environment variable;
--   · created ONCE: a transaction-scoped advisory lock serialises concurrent
--     first calls, the Vault's unique name index backs it up, and a stored key
--     is never overwritten or rotated in place (every prompt sealed with it
--     would become unreadable);
--   · handed out ONLY to the server — proof-of-server token (server_call_ok,
--     0077). Not to an anonymous caller, not to a customer, and deliberately
--     not to an admin's browser session either: admins read PROMPTS through
--     server actions, never the key that opens all of them.
--
-- Each prompt row keeps its own columns and format (base64 ciphertext / iv /
-- tag) — no schema change, no new column, no second storage path. Rows sealed
-- earlier with APP_ENCRYPTION_KEY stay untouched; the server still opens them
-- when that variable exists, and moves them to this key on their next save.
--
-- The generic secret_* functions (0078/0080) accept ANY vault name, so without
-- a guard an admin session could read, overwrite or delete this key through
-- them. They are re-created below with their bodies unchanged plus one line
-- refusing the reserved `grovbase.prompts.` namespace. No integration or
-- provider credential uses that namespace, so nothing they do changes.

/* ── 1. the reserved namespace ────────────────────────────────────────────*/

create or replace function public.secret_name_reserved(p_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select starts_with(coalesce(p_name, ''), 'grovbase.prompts.');
$$;
revoke all on function public.secret_name_reserved(text) from public, anon, authenticated;

/* ── 2. get-or-create, owner-only ─────────────────────────────────────────*/

-- The one place the key is created. Not callable by any client role: the
-- server reaches it through prompt_master_key() below, the migration through
-- the call at the end of this file.
create or replace function public.prompt_master_key_ensure()
returns text
language plpgsql
volatile
security definer
set search_path = public, vault, extensions
as $$
declare
  c_name constant text := 'grovbase.prompts.master_key_v1';
  v_key text;
begin
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = c_name;
  if v_key is null then
    -- Two first calls at once (an admin save and a customer run, say) must
    -- converge on ONE key: the second waits here, then sees the first's row.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c_name, 0));
    select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = c_name;
    if v_key is null then
      v_key := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
      begin
        perform vault.create_secret(v_key, c_name,
          'GrovBase prompt-content master key (AES-256-GCM, v1). Never overwrite or delete: every prompt sealed with it becomes unreadable.');
      exception when unique_violation then
        -- Someone created it without taking the lock. Theirs stands.
        select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = c_name;
        if v_key is null then raise; end if;
      end;
    end if;
  end if;
  -- A stored value that is not a 256-bit hex key is refused, never "repaired"
  -- by overwriting it.
  if v_key !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'master_key_malformed';
  end if;
  return v_key;
end $$;
revoke all on function public.prompt_master_key_ensure() from public, anon, authenticated;

/* ── 3. the server's door ─────────────────────────────────────────────────*/

-- VOLATILE on purpose: PostgREST runs STABLE functions read-only, and the
-- first call may have to create the key.
create or replace function public.prompt_master_key(p_token text)
returns text
language plpgsql
volatile
security definer
set search_path = public, vault, extensions
as $$
begin
  -- Gate first: an unauthorised caller learns nothing, not even whether a key
  -- exists yet.
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  return public.prompt_master_key_ensure();
end $$;
revoke all on function public.prompt_master_key(text) from public, anon;
grant execute on function public.prompt_master_key(text) to authenticated;

comment on function public.prompt_master_key(text) is
  'The Vault-held prompt-content master key (64 hex), created on first use. Proof-of-server token only: never an anonymous caller, a customer or an admin browser session. Never returns any other vault secret.';

/* ── 4. the generic secret functions refuse the reserved namespace ────────*/

create or replace function public.secret_put(p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'invalid_name'; end if;
  if public.secret_name_reserved(p_name) then raise exception 'reserved_name'; end if;
  -- An empty value is never a secret. Clearing one is secret_clear's job, and
  -- keeping them apart stops a blank form field from silently wiping a working
  -- credential — the single most expensive mistake this module can make.
  if p_value is null or p_value = '' then raise exception 'empty_value'; end if;

  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'GrovBase managed secret');
  else
    perform vault.update_secret(v_id, p_value, p_name, 'GrovBase managed secret');
  end if;
end $$;

revoke all on function public.secret_put(text, text) from public, anon;
grant execute on function public.secret_put(text, text) to authenticated;

create or replace function public.secret_clear(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_hit integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if public.secret_name_reserved(p_name) then raise exception 'reserved_name'; end if;
  delete from vault.secrets where name = p_name;
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end $$;

revoke all on function public.secret_clear(text) from public, anon;
grant execute on function public.secret_clear(text) to authenticated;

create or replace function public.secret_status(p_names text[])
returns table(name text, configured boolean, last_four text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if exists (select 1 from unnest(p_names) as r(n) where public.secret_name_reserved(r.n)) then
    raise exception 'reserved_name';
  end if;
  return query
    select n.n as name,
           (s.id is not null) as configured,
           case
             when s.decrypted_secret is null then null
             when length(s.decrypted_secret) <= 4 then repeat('•', length(s.decrypted_secret))
             else right(s.decrypted_secret, 4)
           end as last_four,
           s.updated_at
      from unnest(p_names) as n(n)
      left join vault.decrypted_secrets s on s.name = n.n;
end $$;

revoke all on function public.secret_status(text[]) from public, anon;
grant execute on function public.secret_status(text[]) to authenticated;

create or replace function public.secret_read(p_name text, p_token text default null)
returns text
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  v_value text;
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then
    raise exception 'forbidden';
  end if;
  if public.secret_name_reserved(p_name) then raise exception 'reserved_name'; end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where name = p_name;
  return v_value;
end $$;

revoke all on function public.secret_read(text, text) from public;
grant execute on function public.secret_read(text, text) to anon, authenticated;

create or replace function public.secret_read_many(p_names text[], p_token text default null)
returns table(name text, value text)
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then
    raise exception 'forbidden';
  end if;
  -- An empty or null array is a legitimate "nothing to fetch", not an error:
  -- an integration with no secrets still calls this.
  if p_names is null or array_length(p_names, 1) is null then
    return;
  end if;
  -- Capped so a caller cannot turn this into a bulk export of the vault. No
  -- integration owns anywhere near this many credentials.
  if array_length(p_names, 1) > 32 then
    raise exception 'too_many_names';
  end if;
  if exists (select 1 from unnest(p_names) as r(n) where public.secret_name_reserved(r.n)) then
    raise exception 'reserved_name';
  end if;

  return query
    select s.name, s.decrypted_secret
      from vault.decrypted_secrets s
     where s.name = any(p_names);
end $$;

revoke all on function public.secret_read_many(text[], text) from public;
grant execute on function public.secret_read_many(text[], text) to anon, authenticated;

/* ── 5. the key exists from the moment this migration is applied ──────────*/

-- Generated here, at apply time, inside the database — the file holds only the
-- expression, never a value. Every later caller finds it; the lazy path above
-- stays for any database this migration reaches before a key exists.
do $$ begin perform public.prompt_master_key_ensure(); end $$;

-- ROLLBACK (manual): re-apply the secret_* bodies from 0078/0079/0080, then
--   drop function if exists public.prompt_master_key(text);
--   drop function if exists public.prompt_master_key_ensure();
--   drop function if exists public.secret_name_reserved(text);
-- and DO NOT delete the vault secret while any prompt is sealed with it.
