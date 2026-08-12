"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";

export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from("user_preferences").update({ locale }).eq("user_id", user.id);
  }
  revalidatePath("/", "layout");
}

export async function saveProfileAction(_prev: { ok: boolean } | null, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const fullName = String(formData.get("full_name") ?? "").trim();
  const theme = String(formData.get("theme") ?? "system");
  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
  await supabase.from("user_preferences").update({ theme }).eq("user_id", user.id);
  revalidatePath("/settings");
  return { ok: !error };
}

export async function saveBillingProfileAction(_prev: { ok: boolean } | null, formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const workspaceId = String(formData.get("workspace_id") ?? "");
  if (!workspaceId) return { ok: false };
  const field = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const row = {
    workspace_id: workspaceId,
    company_name: field("company_name"),
    vat_id: field("vat_id"),
    regon: field("regon"),
    address_line: field("address_line"),
    postal_code: field("postal_code"),
    city: field("city"),
    country: field("country"),
    billing_email: field("billing_email"),
    contact_person: field("contact_person"),
    phone: field("phone"),
    updated_at: new Date().toISOString(),
  };
  // RLS enforces workspace membership on the upsert.
  const { error } = await supabase.from("billing_profiles").upsert(row, { onConflict: "workspace_id" });
  revalidatePath("/settings");
  return { ok: !error };
}

export async function saveWorkspaceBrandingAction(input: {
  workspaceId: string; logoUrl?: string | null; brandColor?: string | null; companyName?: string | null;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  if (input.brandColor && !/^#[0-9a-fA-F]{6}$/.test(input.brandColor)) return { ok: false };
  const { error } = await supabase.from("workspaces").update({
    logo_url: input.logoUrl ?? null,
    brand_color: input.brandColor ?? null,
    company_name: input.companyName?.trim() || null,
  }).eq("id", input.workspaceId);
  revalidatePath("/settings");
  return { ok: !error };
}
