"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isTicketStatus } from "@/lib/contact-page";
import { sendConfirmation } from "@/lib/server/contact-tickets";

/**
 * KONTAKT V2 — what an admin does with a ticket: change its status (Nowe /
 * W trakcie / Zamknięte) and send the customer's confirmation again. Thin, as
 * every action here: the admin is re-checked, the write goes through RLS
 * (contact_messages is admin-only, 0086) or the definer function, and the
 * change is logged with log_activity on the customer's behalf.
 */

type Result = { ok: true } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

type TicketRow = {
  id: string; ticket_no: number; email: string; topic: string; message: string; locale: string;
  status: string; user_id: string | null; account: unknown;
};

async function readTicket(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<TicketRow | null> {
  const { data } = await supabase.from("contact_messages")
    .select("id, ticket_no, email, topic, message, locale, status, user_id, account").eq("id", id).maybeSingle();
  return (data as TicketRow | null) ?? null;
}

const workspaceOf = (account: unknown): string | null => {
  const w = account && typeof account === "object" ? (account as { workspace_id?: unknown }).workspace_id : null;
  return typeof w === "string" && UUID.test(w) ? w : null;
};

async function log(supabase: Awaited<ReturnType<typeof createClient>>, t: TicketRow, action: string, metadata: Record<string, unknown>) {
  await supabase.rpc("log_activity", {
    p_workspace_id: workspaceOf(t.account) as unknown as string,
    p_action: action,
    p_entity_type: "contact_message",
    p_entity_id: t.id,
    p_metadata: { ticket: t.ticket_no, ...metadata } as never,
    ...(t.user_id ? { p_on_behalf_of: t.user_id } : {}),
  });
}

export async function setTicketStatusAction(id: string, status: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!UUID.test(id) || !isTicketStatus(status)) return { ok: false, error: "invalid" };
    const ticket = await readTicket(supabase, id);
    if (!ticket) return { ok: false, error: "not_found" };
    if (ticket.status === status) return { ok: true };
    const now = new Date().toISOString();
    const { error } = await supabase.from("contact_messages").update({
      status, updated_at: now,
      handled_at: status === "closed" ? now : null,
      handled_by: status === "new" ? null : adminId,
    }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await log(supabase, ticket, "contact.ticket.status", { from: ticket.status, to: status });
    revalidatePath("/admin/support/zgloszenia");
    revalidatePath(`/admin/support/zgloszenia/${ticket.ticket_no}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "generic" };
  }
}

export async function resendConfirmationAction(id: string): Promise<Result> {
  try {
    const { supabase } = await requireAdmin();
    if (!UUID.test(id)) return { ok: false, error: "invalid" };
    const ticket = await readTicket(supabase, id);
    if (!ticket) return { ok: false, error: "not_found" };
    const status = await sendConfirmation(supabase, ticket, { asAdmin: true });
    await log(supabase, ticket, "contact.ticket.confirmation_resent", { result: status });
    revalidatePath(`/admin/support/zgloszenia/${ticket.ticket_no}`);
    return status === "sent" ? { ok: true } : { ok: false, error: status === "skipped" ? "mail_not_configured" : "mail_failed" };
  } catch {
    return { ok: false, error: "generic" };
  }
}
