-- "POŁĄCZONO" is not proof. The production incident showed a provider can
-- pass its connection test while real image generation fails — so the image
-- generation test becomes a first-class, separately stored result.
alter table public.ai_provider_credentials
  add column if not exists last_image_test_at timestamptz,
  add column if not exists last_image_test_status text,
  add column if not exists last_image_test_error_safe text;
