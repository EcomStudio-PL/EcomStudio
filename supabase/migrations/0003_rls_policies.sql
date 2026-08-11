-- Enable RLS everywhere
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.generated_prompts enable row level security;
alter table public.ai_providers enable row level security;
alter table public.ai_models enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generations enable row level security;
alter table public.generation_assets enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.usage_logs enable row level security;
alter table public.activity_logs enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own_or_admin" on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy "prefs_all_own" on public.user_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "ws_select_member_or_admin" on public.workspaces for select
  using (public.is_workspace_member(id) or public.is_admin());
create policy "ws_insert_own" on public.workspaces for insert
  with check (owner_id = auth.uid());
create policy "ws_update_manager_or_admin" on public.workspaces for update
  using (public.is_workspace_manager(id) or public.is_admin());
create policy "ws_delete_owner_or_admin" on public.workspaces for delete
  using (owner_id = auth.uid() or public.is_admin());

create policy "wsm_select_member_or_admin" on public.workspace_members for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "wsm_insert_manager_or_admin" on public.workspace_members for insert
  with check (public.is_workspace_manager(workspace_id) or public.is_admin());
create policy "wsm_update_manager_or_admin" on public.workspace_members for update
  using (public.is_workspace_manager(workspace_id) or public.is_admin());
create policy "wsm_delete_manager_self_or_admin" on public.workspace_members for delete
  using (public.is_workspace_manager(workspace_id) or user_id = auth.uid() or public.is_admin());

create policy "products_select" on public.products for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "products_insert" on public.products for insert
  with check (public.is_workspace_member(workspace_id) and owner_id = auth.uid());
create policy "products_update" on public.products for update
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "products_delete" on public.products for delete
  using (public.is_workspace_member(workspace_id) or public.is_admin());

create policy "pimg_select" on public.product_images for select
  using (exists (select 1 from public.products p where p.id = product_id and (public.is_workspace_member(p.workspace_id) or public.is_admin())));
create policy "pimg_insert" on public.product_images for insert
  with check (exists (select 1 from public.products p where p.id = product_id and public.is_workspace_member(p.workspace_id)));
create policy "pimg_update" on public.product_images for update
  using (exists (select 1 from public.products p where p.id = product_id and public.is_workspace_member(p.workspace_id)));
create policy "pimg_delete" on public.product_images for delete
  using (exists (select 1 from public.products p where p.id = product_id and public.is_workspace_member(p.workspace_id)));

create policy "ptpl_select" on public.prompt_templates for select
  using (workspace_id is null or public.is_workspace_member(workspace_id) or public.is_admin());
create policy "ptpl_insert" on public.prompt_templates for insert
  with check ((workspace_id is not null and public.is_workspace_member(workspace_id)) or public.is_admin());
create policy "ptpl_update" on public.prompt_templates for update
  using ((workspace_id is not null and public.is_workspace_member(workspace_id)) or public.is_admin());
create policy "ptpl_delete" on public.prompt_templates for delete
  using ((workspace_id is not null and public.is_workspace_member(workspace_id)) or public.is_admin());

create policy "gp_select" on public.generated_prompts for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "gp_insert" on public.generated_prompts for insert
  with check (public.is_workspace_member(workspace_id));
create policy "gp_update" on public.generated_prompts for update
  using (public.is_workspace_member(workspace_id));
create policy "gp_delete" on public.generated_prompts for delete
  using (public.is_workspace_member(workspace_id));

create policy "aiprov_select" on public.ai_providers for select using (auth.uid() is not null);
create policy "aiprov_admin_write" on public.ai_providers for all
  using (public.is_admin()) with check (public.is_admin());
create policy "aimodel_select" on public.ai_models for select using (auth.uid() is not null);
create policy "aimodel_admin_write" on public.ai_models for all
  using (public.is_admin()) with check (public.is_admin());

create policy "gj_select" on public.generation_jobs for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "gj_insert" on public.generation_jobs for insert
  with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());
create policy "gj_update" on public.generation_jobs for update
  using (public.is_workspace_member(workspace_id) or public.is_admin());

create policy "gen_select" on public.generations for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());

create policy "ga_select" on public.generation_assets for select
  using (exists (select 1 from public.generations g where g.id = generation_id and (public.is_workspace_member(g.workspace_id) or public.is_admin())));

create policy "wallet_select" on public.credit_wallets for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());

create policy "ctx_select" on public.credit_transactions for select
  using (exists (select 1 from public.credit_wallets w where w.id = wallet_id and (public.is_workspace_member(w.workspace_id) or public.is_admin())));

create policy "plans_select" on public.subscription_plans for select
  using (active = true or public.is_admin());
create policy "plans_admin_write" on public.subscription_plans for all
  using (public.is_admin()) with check (public.is_admin());

create policy "subs_select" on public.subscriptions for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy "pay_select" on public.payments for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());

create policy "usage_select" on public.usage_logs for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());

create policy "act_select" on public.activity_logs for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
