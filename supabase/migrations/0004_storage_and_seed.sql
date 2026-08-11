-- Storage: private buckets. Path convention: {workspace_id}/{product_id}/{filename}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 10485760, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generation-assets', 'generation-assets', false, 26214400, array['image/jpeg','image/png','image/webp','video/mp4'])
on conflict (id) do nothing;

create policy "product_images_select" on storage.objects for select
  using (bucket_id = 'product-images' and (public.is_workspace_member((storage.foldername(name))[1]::uuid) or public.is_admin()));
create policy "product_images_insert" on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy "product_images_update" on storage.objects for update
  using (bucket_id = 'product-images' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy "product_images_delete" on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create policy "generation_assets_select" on storage.objects for select
  using (bucket_id = 'generation-assets' and (public.is_workspace_member((storage.foldername(name))[1]::uuid) or public.is_admin()));

-- Seed: subscription plans
insert into public.subscription_plans (slug, name, monthly_credits, price_cents, currency, sort_order, features) values
 ('free','Free',25,0,'PLN',0,'{"products":5,"workspace_members":1}'),
 ('starter','Starter',300,9900,'PLN',1,'{"products":50,"workspace_members":2}'),
 ('pro','Pro',1200,29900,'PLN',2,'{"products":500,"workspace_members":5,"priority_queue":true}'),
 ('agency','Agency',5000,99900,'PLN',3,'{"products":-1,"workspace_members":-1,"priority_queue":true,"operator_mode":true}');

-- Seed: AI provider abstraction (inactive until real APIs are connected — no fake generation)
insert into public.ai_providers (slug, name, active, metadata) values
 ('openai','OpenAI',false,'{"kind":"image_text"}'),
 ('google','Google Gemini',false,'{"kind":"image_video"}'),
 ('fal','fal.ai',false,'{"kind":"image_video"}');

insert into public.ai_models (provider_id, model_identifier, name, type, active, credit_cost, estimated_api_cost, supports_reference_images, supported_aspect_ratios, capabilities)
select p.id, m.ident, m.label, m.mtype, false, m.cost, m.api_cost, m.refs, array['1:1','4:5','16:9','9:16'], m.caps::jsonb
from public.ai_providers p
join (values
  ('openai','gpt-image-1','GPT Image 1','image',4,0.08,true,'{"editing":true}'),
  ('google','gemini-2.5-flash-image','Gemini 2.5 Flash Image','image',3,0.04,true,'{"fidelity":"high"}'),
  ('fal','flux-pro-1.1','FLUX 1.1 Pro','image',3,0.05,true,'{"speed":"fast"}')
) as m(pslug, ident, label, mtype, cost, api_cost, refs, caps) on m.pslug = p.slug;

-- Seed: 7 global prompt template concepts (workspace_id null = system templates)
insert into public.prompt_templates (workspace_id, name, shot_type, template, format, style, priority) values
 (null,'Hero Product','product_hero','Professional e-commerce hero shot of {{product_name}} on a clean seamless studio background, soft key light, crisp shadows, product perfectly centered, true-to-life colors and proportions, all labels and details preserved exactly as in reference images. {{instructions}}','1:1','studio',1),
 (null,'Premium Lifestyle','premium_lifestyle','Premium lifestyle photograph featuring {{product_name}} in an aspirational real-world setting matching its category ({{category}}), natural light, shallow depth of field, product shape, color and branding identical to reference images. {{instructions}}','4:5','lifestyle',2),
 (null,'Product In Use','product_in_use','Photorealistic image of {{product_name}} being used in its intended context, hands or environment interacting naturally, product fully visible and unaltered from reference images: same buttons, ports, labels and accessories. {{instructions}}','4:5','contextual',3),
 (null,'Close-up Detail','closeup_detail','Macro close-up of the most distinctive feature of {{product_name}}, sharp focus on texture and material, exact color fidelity to reference images, premium product photography lighting. {{instructions}}','1:1','macro',4),
 (null,'Scale Demonstration','scale','Photograph of {{product_name}} next to a common object or in hand to communicate true physical size, realistic proportions strictly matching the reference images, neutral background. {{instructions}}','1:1','studio',5),
 (null,'Benefit Shot','benefit','Conversion-focused product photograph of {{product_name}} visually communicating its main customer benefit, clean composition with space for marketplace text overlay, product appearance identical to reference images. {{instructions}}','16:9','marketing',6),
 (null,'Premium Ad','premium_ad','High-end advertising visual of {{product_name}}, dramatic premium lighting, elegant props relevant to {{category}}, brand-safe composition, product rendered with exact fidelity to reference images: shape, colors, item count, materials and scale. {{instructions}}','9:16','advertising',7);
