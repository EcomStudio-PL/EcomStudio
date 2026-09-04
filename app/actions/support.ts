"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { sendEmail } from "@/lib/server/email";
import { absoluteUrl } from "@/lib/site";

type Result = { ok: boolean; error?: string; threadId?: string };

export async function createThreadAction(subject: string, body: string): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (!subject.trim() || !body.trim()) return { ok: false, error: "invalid" };
  const workspace = await getCurrentWorkspace(supabase, user.id);
  const { data: thread, error } = await supabase.from("support_threads").insert({
    user_id: user.id, workspace_id: workspace?.id ?? null, subject: subject.trim().slice(0, 200),
  }).select("id").single();
  if (error || !thread) return { ok: false, error: "generic" };
  await supabase.from("support_messages").insert({
    thread_id: thread.id, author_id: user.id, is_staff: false, body: body.trim().slice(0, 5000),
  });
  revalidatePath("/support");
  return { ok: true, threadId: thread.id };
}

export async function postMessageAction(threadId: string, body: string): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (!body.trim()) return { ok: false, error: "invalid" };
  // RLS restricts insert to the thread owner (or staff).
  const { error } = await supabase.from("support_messages").insert({
    thread_id: threadId, author_id: user.id, is_staff: false, body: body.trim().slice(0, 5000),
  });
  if (error) return { ok: false, error: "generic" };
  await supabase.from("support_threads")
    .update({ last_message_at: new Date().toISOString(), status: "open" }).eq("id", threadId);
  revalidatePath("/support");
  return { ok: true };
}

// ---------- staff side ----------

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role, full_name").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

export async function staffReplyAction(threadId: string, body: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!body.trim()) return { ok: false, error: "invalid" };
    const { data: thread } = await supabase.from("support_threads")
      .select("id, subject, user_id, profiles(email)").eq("id", threadId).maybeSingle();
    if (!thread) return { ok: false, error: "not_found" };
    const { error } = await supabase.from("support_messages").insert({
      thread_id: threadId, author_id: adminId, is_staff: true, body: body.trim().slice(0, 5000),
    });
    if (error) return { ok: false, error: "generic" };
    await supabase.from("support_threads")
      .update({ last_message_at: new Date().toISOString() }).eq("id", threadId);
    await supabase.from("notifications").insert({
      user_id: thread.user_id, type: "support_reply", title: "support_reply",
      body: thread.subject, href: `/support?thread=${threadId}`,
    });
    if (thread.profiles?.email) {
      await sendEmail({
        to: thread.profiles.email,
        subject: `GrovBase — odpowiedź: ${thread.subject}`,
        text: `${body.trim().slice(0, 2000)}\n\n— Zespół GrovBase\n${absoluteUrl(`/support?thread=${threadId}`)}`,
      });
    }
    revalidatePath(`/admin/support/${threadId}`);
    revalidatePath("/support");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function setThreadStatusAction(threadId: string, status: "open" | "closed"): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("support_threads").update({ status }).eq("id", threadId);
    if (error) return { ok: false, error: "generic" };
    revalidatePath(`/admin/support/${threadId}`);
    revalidatePath("/admin/support");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}
