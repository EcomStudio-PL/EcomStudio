-- Plans: bonus credits + structured limits for the admin plan editor.
alter table public.subscription_plans add column if not exists bonus_credits int not null default 0;
alter table public.subscription_plans add column if not exists limits jsonb not null default '{}'::jsonb;

-- Reusable prompt building blocks (system library, admin-managed).
-- Categories mirror how a production ad prompt is assembled; the prompt
-- service appends active blocks in this fixed order after the template body.
create table public.prompt_blocks (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('style','scene','format','cta','fidelity','restrictions','extra')),
  name text not null,
  content text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.prompt_blocks enable row level security;

create policy "prompt_blocks_read" on public.prompt_blocks
  for select using (true);

create policy "prompt_blocks_admin_write" on public.prompt_blocks
  for all using (public.is_admin()) with check (public.is_admin());
