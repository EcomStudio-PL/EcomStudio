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
