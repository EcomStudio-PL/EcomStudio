-- GROVSHOT V2.3 (26.11.2026): Exact References for ADMINS' orders only.
-- prompt.references = "exact_admin": an admin's new order sends Nano Banana
-- exactly the references Opus planned, in his order (an invalid choice is
-- blocked explicitly, never swapped). Customers' orders stay on "auto" (the
-- references V2 selection) until the visual test is accepted. Orders already
-- started keep the mode they pinned (input.reference_mode).
-- Rollback: set prompt.references back to "auto" (Admin → GrovShot → Ustawienia, or SQL).
update public.app_settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{prompt,references}', '"exact_admin"'::jsonb, true)
where key = 'grovshot_shot';
