import type { createClient } from "@/lib/supabase/server";

/** Exact client type produced by our factory — services stay in lockstep with it. */
export type Client = Awaited<ReturnType<typeof createClient>>;

/** Current user's primary (first) workspace. Multi-workspace switching comes later. */
export async function getCurrentWorkspace(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name, owner_id, logo_url, brand_color, company_name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  // A swallowed read error is indistinguishable from "this account has no
  // workspace", and the app then shows a setup error for what is really a
  // transport or policy failure. Record the cause — code and message only,
  // never the token or the row.
  if (error) console.error("workspace.read", error.code, error.message);
  if (!data?.workspaces) return null;
  return { ...data.workspaces, member_role: data.role };
}

export async function getProfile(supabase: Client, userId: string) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) console.error("profile.read", error.code, error.message);
  return data;
}
