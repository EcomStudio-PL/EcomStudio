import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, getProfile } from "@/lib/services/workspace";

export const dynamic = "force-dynamic";

export type SearchHit = {
  kind: "product" | "session" | "prompt" | "generation" | "user";
  id: string;
  title: string;
  sub: string | null;
  href: string;
};

/** Search across the resources the caller may actually see. RLS does the
 *  authorisation work — the workspace filter only narrows, it never widens —
 *  and admin-only entities are gated on the server-side role check. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] });
  const like = `%${q.replace(/[%_,]/g, " ")}%`;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ hits: [] }, { status: 401 });
  const [workspace, profile] = await Promise.all([
    getCurrentWorkspace(supabase, user.id),
    getProfile(supabase, user.id),
  ]);
  if (!workspace) return NextResponse.json({ hits: [] });

  const [products, sessions, prompts, jobs] = await Promise.all([
    supabase.from("products").select("id, name, category")
      .eq("workspace_id", workspace.id).ilike("name", like).limit(5),
    supabase.from("prompt_sessions").select("id, product_name, status")
      .eq("workspace_id", workspace.id).ilike("product_name", like).limit(5),
    supabase.from("generated_prompts").select("id, concept_name, session_id, scene_type")
      .eq("workspace_id", workspace.id).ilike("concept_name", like).limit(5),
    supabase.from("generation_jobs").select("id, prompt_text, status, created_at")
      .eq("workspace_id", workspace.id).eq("status", "completed").ilike("prompt_text", like)
      .order("created_at", { ascending: false }).limit(4),
  ]);

  const hits: SearchHit[] = [
    ...(products.data ?? []).map((p) => ({
      kind: "product" as const, id: p.id, title: p.name, sub: p.category, href: `/products/${p.id}`,
    })),
    ...(sessions.data ?? []).map((s) => ({
      kind: "session" as const, id: s.id, title: s.product_name, sub: s.status, href: `/prompts/${s.id}`,
    })),
    ...(prompts.data ?? []).map((p) => ({
      kind: "prompt" as const, id: p.id, title: p.concept_name, sub: p.scene_type,
      href: `/generator?prompt=${p.id}`,
    })),
    ...(jobs.data ?? []).map((j) => ({
      kind: "generation" as const, id: j.id,
      title: (j.prompt_text ?? "").split("\n")[0].slice(0, 70) || "—",
      sub: new Date(j.created_at).toLocaleDateString(), href: "/library",
    })),
  ];

  // Admin-only: customer lookup, gated on the server-side role.
  if (profile?.role === "admin") {
    const { data: users } = await supabase.from("profiles")
      .select("id, full_name, email").or(`email.ilike.${like},full_name.ilike.${like}`).limit(5);
    for (const u of users ?? []) {
      hits.push({
        kind: "user", id: u.id, title: u.full_name ?? u.email, sub: u.email,
        href: `/admin/users/${u.id}`,
      });
    }
  }

  return NextResponse.json({ hits });
}
