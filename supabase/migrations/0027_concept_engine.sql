-- CONCEPT ENGINE — hidden prompts.
--
-- The prompt a concept carries is EcomStudio's intellectual property. From
-- this migration on it is stored ONLY as AES-256-GCM ciphertext, decryptable
-- exclusively with the server-side APP_ENCRYPTION_KEY — the same scheme that
-- already protects provider credentials. A client reading the row through
-- PostgREST gets a title, a description and a blob it cannot open.
--
-- The card the customer sees gets its own honest fields: customer_title and
-- customer_description, written for a seller, in the seller's language.

alter table public.generated_prompts
  add column if not exists customer_title text,
  add column if not exists customer_description text,
  add column if not exists prompt_encrypted text,
  add column if not exists prompt_iv text,
  add column if not exists prompt_tag text,
  add column if not exists generation_count integer not null default 0,
  add column if not exists last_job_id uuid references public.generation_jobs(id) on delete set null;

-- Historical AI-engine prompts (rows with a session) were readable by design
-- in the previous flow; that design is retired. Template-based rows
-- (session_id IS NULL) are the seller's own editable templates and stay.
update public.generated_prompts
set prompt_text = '', negative_prompt = null
where session_id is not null;

-- The same prompt text was mirrored onto generation jobs; strip it there too.
update public.generation_jobs
set prompt_text = null, negative_prompt = null
where prompt_session_id is not null;
