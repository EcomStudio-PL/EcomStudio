"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";

type Result = { ok: boolean; error?: string; info?: string };

async function siteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function signIn(_prev: Result | null, formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { ok: false, error: "invalid" };
  redirect("/dashboard");
}

export async function signUp(_prev: Result | null, formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const locale = await getLocale();
  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    options: {
      emailRedirectTo: `${await siteUrl()}/auth/callback`,
      data: { full_name: String(formData.get("full_name") ?? "").trim(), locale },
    },
  });
  if (error) return { ok: false, error: error.message };
  if (data.session) redirect("/dashboard");
  return { ok: true, info: "confirm_email" };
}

export async function requestPasswordReset(_prev: Result | null, formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    String(formData.get("email") ?? "").trim(),
    { redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password` }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, info: "sent" };
}

export async function updatePassword(_prev: Result | null, formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { ok: false, error: error.message };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
