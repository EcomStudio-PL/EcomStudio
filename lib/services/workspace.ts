import type { createClient } from "@/lib/supabase/server";

/** Exact client type produced by our factory — services stay in lockstep with it. */
export type Client = Awaited<ReturnType<typeof createClient>>;

/** Current user's primary (first) workspace. Multi-workspace switching comes later. */
export async function getCurrentWorkspace(supabase: Client, userId: string) {
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name, owner_id, logo_url, brand_color, company_name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.workspaces) return null;
  return { ...data.workspaces, member_role: data.role };
}

export async function getProfile(supabase: Client, userId: string) {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data;
}
