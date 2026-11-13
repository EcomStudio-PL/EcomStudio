-- CENNIK V2 REHEARSAL — the data 0174 meets: PROD's three wallets with their
-- exact balances, the four plans, the four packs, the service rows, and one
-- generation charged BEFORE the pools exist (its refund must land in the
-- legacy pool). Written through the OLD integer ledger door.
\set ON_ERROR_STOP on
set search_path = public, extensions;

insert into public.profiles (id, email, role) values
  ('22289203-3a80-446d-b377-c2c75c253c0d', 'admin@test', 'admin'),
  ('1d062f02-adb7-409c-be45-ca062ca6b19a', 'second@test', 'user'),
  ('b168449e-b8e0-42a3-8188-e80ae89a3a04', 'e2e@test', 'user'),
  ('00000000-0000-0000-0000-0000000000c1', 'customer@test', 'user'),
  ('00000000-0000-0000-0000-0000000000c2', 'lapsed@test', 'user');

insert into public.workspaces (id, name, owner_id) values
  ('cdd6ed7d-4630-4e29-93d5-69fa60c5d660', 'Grovbase', '22289203-3a80-446d-b377-c2c75c253c0d'),
  ('c538dc41-0ef4-4f04-a7e9-1d6ff73742a5', 'second', '1d062f02-adb7-409c-be45-ca062ca6b19a'),
  ('9b5352f5-b851-46ca-a29c-478f035c843e', 'E2E Test', 'b168449e-b8e0-42a3-8188-e80ae89a3a04'),
  ('00000000-0000-0000-0000-00000000aaa1', 'customer', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000aaa2', 'lapsed', '00000000-0000-0000-0000-0000000000c2');
insert into public.workspace_members (workspace_id, user_id)
select id, owner_id from public.workspaces;

insert into public.credit_wallets (id, workspace_id, balance) values
  ('ef961680-7ea8-4335-acbd-db19c2d5229e', 'cdd6ed7d-4630-4e29-93d5-69fa60c5d660', 0),
  ('bed13ebc-c182-45b4-b57f-74e911ef03bb', 'c538dc41-0ef4-4f04-a7e9-1d6ff73742a5', 0),
  ('825d247f-7a21-450e-b469-0973ecddc6c7', '9b5352f5-b851-46ca-a29c-478f035c843e', 0),
  ('00000000-0000-0000-0000-0000000bbbb1', '00000000-0000-0000-0000-00000000aaa1', 0),
  ('00000000-0000-0000-0000-0000000bbbb2', '00000000-0000-0000-0000-00000000aaa2', 0);

-- The balances PROD holds (through the ledger, as they were built).
select public.apply_credit_transaction('ef961680-7ea8-4335-acbd-db19c2d5229e', 49795, 'bonus', 'seed', null, '{}', null);
select public.apply_credit_transaction('bed13ebc-c182-45b4-b57f-74e911ef03bb', 1124, 'bonus', 'seed', null, '{}', null);
select public.apply_credit_transaction('825d247f-7a21-450e-b469-0973ecddc6c7', 488, 'bonus', 'seed', null, '{}', null);

insert into public.service_catalog (slug, name, credits_cost) values
  ('image_generation', 'Image generation', 4), ('prompt_generation', 'Prompt generation', 0),
  ('tool_thumbnail', 'Miniaturka AI', 10), ('smart_prompt', 'Inteligentny prompt', 1);

-- A generation the admin was charged for BEFORE 0174 (7 credits, old scale):
-- the admin's balance ends at PROD's 49788, and the run is still pending so a
-- later failure refunds it.
insert into public.usage_events (id, user_id, workspace_id, service_slug, credits_charged, status, metadata)
values ('00000000-0000-0000-0000-00000000e0e0', '22289203-3a80-446d-b377-c2c75c253c0d',
        'cdd6ed7d-4630-4e29-93d5-69fa60c5d660', 'image_generation', 7, 'pending', '{}');
update public.usage_events set credit_tx_id = public.apply_credit_transaction(
  'ef961680-7ea8-4335-acbd-db19c2d5229e', -7, 'generation', 'pre-0174 run', '00000000-0000-0000-0000-00000000e0e0', '{}', null)
where id = '00000000-0000-0000-0000-00000000e0e0';

insert into public.subscription_plans (id, slug, name, price_cents, monthly_credits, currency, sort_order,
  stripe_product_id, stripe_price_id_monthly, stripe_price_monthly_cents, stripe_sync_status, features) values
  ('60427dee-bea3-4f93-92a7-393980c04176', 'free', 'Free', 0, 25, 'PLN', 0, null, null, null, 'unknown', '{"products":5,"workspace_members":1}'),
  ('bca46e0c-00d2-4e1a-b034-3bb5ef751221', 'starter', 'Starter', 9900, 300, 'PLN', 1, 'grovbase_plan_starter', 'price_old_starter', 9900, 'synced', '{"products":50,"workspace_members":2}'),
  ('d39062bd-03ef-4844-b65b-7dc6b80e79b0', 'pro', 'Pro', 29900, 1200, 'PLN', 2, 'grovbase_plan_pro', 'price_old_pro', 29900, 'synced', '{"products":500,"priority_queue":true,"workspace_members":5}'),
  ('984262c1-a47f-4d36-9d3d-4a680dd46798', 'agency', 'Agency', 99900, 5000, 'PLN', 3, 'grovbase_plan_agency', 'price_old_agency', 99900, 'synced', '{"products":-1,"operator_mode":true,"priority_queue":true,"workspace_members":-1}');

insert into public.credit_packages (id, name, credits, bonus_credits, price_cents, stripe_price_id, stripe_price_cents, stripe_sync_status) values
  ('f86d4f98-14bb-45e6-a867-5700fc7baf65', 'Start', 100, 0, 1900, 'price_pack_start', 1900, 'synced'),
  ('69f5fc50-5328-4ee6-b5f8-4ce1014c1aad', 'Standard', 500, 50, 7900, 'price_pack_standard', 7900, 'synced'),
  ('d5e9b0d0-9497-4511-b66f-82a808751c8b', 'Pro', 1000, 150, 13900, 'price_pack_pro', 13900, 'synced'),
  ('f0e44f7c-9768-48e6-b753-79544fb3646d', 'Business', 2500, 500, 29900, 'price_pack_business', 29900, 'synced');

insert into public.ai_models (id, model_identifier, name, display_name, credit_cost, pricing, metadata, supported_resolutions) values
  ('70fe4bee-f2d1-491e-9161-6e0c8f2166c2', 'gemini-3-pro-image', 'Nano Banana Pro', 'Nano Banana Pro', 7, '{"1K":7,"2K":7,"4K":12}', '{}', '{1K,2K,4K}'),
  ('61314bc2-3e10-4d65-8988-936e799f4449', 'gemini-3.1-flash-image', 'Nano Banana 2', 'Nano Banana 2', 4, '{"1K":4,"2K":5,"4K":8}', '{}', '{1K,2K,4K}'),
  ('64917127-7f5d-4d16-b551-b40c3e23aded', 'gemini-2.5-flash-image', 'Gemini 2.5 Flash Image', 'Nano Banana', 2, '{"1K":2}', '{}', '{1K}'),
  ('cdcf4ac8-b303-4c3f-8732-9910022e263e', 'gpt-image-2', 'GPT Image 2', 'GPT Image 2', 4, '{"1K":4,"2K":6}',
     '{"qualities":["low","medium","high"],"quality_pricing":{"low":{"1K":2,"2K":4},"medium":{"1K":4,"2K":6},"high":{"1K":6,"2K":8}}}', '{1K,2K}'),
  ('8d0fed1d-b71e-4b50-bad6-0836446f8be6', 'gpt-image-1', 'GPT Image 1', 'GPT Image 2 Medium', 2, '{"1K":2}', '{}', '{1K}'),
  ('d4e1a1fb-ed6f-4862-9628-8e9b1f3224a9', 'gpt-image-2', 'GPT Image 2 High', 'GPT Image 2 High', 8, '{"2K":8}', '{"quality":"high"}', '{2K}');

insert into public.faq_items (id, answer) values
  ('ee80b371-8530-40d2-8bfb-95b829324d78', jsonb_build_object('pl', 'Doładowania są dostępne dla aktywnych planów płatnych: w sekcji „Doładuj kredyty” wybierz pakiet albo własną liczbę kredytów. Kredyty z doładowania nie wygasają i trafiają na konto po potwierdzeniu płatności.')),
  ('1c3d753e-200e-427f-ad75-bc4e04e11153', jsonb_build_object('pl', 'Zmienione przez admina — nie ruszać.'));
