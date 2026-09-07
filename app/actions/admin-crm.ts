"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { absoluteUrl } from "@/lib/site";
import { renderEmailTemplate } from "@/lib/server/email-template";
import { sendAuthMail } from "@/lib/server/auth-mail";

/**
 * ADMIN → CUSTOMER ACTIONS.
 *
 * Everything an operator can do to somebody else's account, with two rules
 * that shape all of it:
 *
 *   1. The admin never learns or sets a password. "Reset hasła" sends the
 *      customer the same self-service link the login screen sends; there is
 *      no screen anywhere in this panel that shows or accepts one.
 *   2. Nothing here deletes accounting. "Usuń konto" anonymises and locks
 *      (0068) — payments and credit transactions keep their rows, because a
 *      ledger with holes in it is not a ledger.
 *
 * Mail goes out on the mailbox the product already uses. There is no SMS and
 * no WhatsApp: GrovBase has one outbound channel to a customer, and inventing
 * a second in the UI would be a button that cannot work.
 */

type Result = { ok: boolean; error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

async function emailOf(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  userId: string,
): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  return data?.email ?? null;
}

/**
 * Send the customer a password-reset link.
 *
 * Deliberately the same call the public "nie pamiętam hasła" form makes: the
 * token lands in the customer's inbox and nowhere else, so an operator can
 * help without ever holding a credential.
 */
export async function sendPasswordResetAction(userId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const email = await emailOf(supabase, userId);
    if (!email) return { ok: false, error: "not_found" };

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: absoluteUrl("/auth/callback?next=/reset-password"),
    });
    // Supabase throttles these per address; say so instead of "coś poszło nie tak".
    if (error) return { ok: false, error: /rate|limit|seconds/i.test(error.message) ? "rate_limited" : "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "user.password_reset_sent",
      entityType: "profile", entityId: userId,
    });
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/**
 * Re-send the confirmation e-mail — but only to somebody who has not confirmed.
 * Offering it to a verified account would be a button that does nothing.
 */
export async function resendVerificationAction(userId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const email = await emailOf(supabase, userId);
    if (!email) return { ok: false, error: "not_found" };

    const { data: facts } = await supabase.rpc("admin_user_facts", { p_ids: [userId] });
    if (facts?.[0]?.email_confirmed_at) return { ok: false, error: "already_verified" };

    const { error } = await supabase.auth.resend({
      type: "signup", email,
      options: { emailRedirectTo: absoluteUrl("/auth/callback") },
    });
    if (error) return { ok: false, error: /rate|limit|seconds/i.test(error.message) ? "rate_limited" : "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "user.verification_resent",
      entityType: "profile", entityId: userId,
    });
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** A message from the team, on the GrovBase mailbox, in the GrovBase layout. */
export async function sendCustomerMessageAction(input: {
  userId: string; subject: string; body: string;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const subject = input.subject.trim();
    const body = input.body.trim();
    if (!subject || !body) return { ok: false, error: "empty" };
    if (subject.length > 200 || body.length > 5000) return { ok: false, error: "too_long" };

    const email = await emailOf(supabase, input.userId);
    if (!email) return { ok: false, error: "not_found" };

    const rendered = renderEmailTemplate({
      title: subject,
      paragraphs: body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
      footer: "GrovBase",
    });
    const sent = await sendAuthMail(supabase, email, { subject, ...rendered });
    if (!sent.sent) {
      return { ok: false, error: sent.error === "not_configured" ? "mail_not_configured" : "send_failed" };
    }

    await logAudit(supabase, {
      actorId: adminId, action: "user.message_sent",
      entityType: "profile", entityId: input.userId,
      // The subject is enough to know what was sent; the body is the
      // customer's mail, not audit-log material.
      after: { subject },
    });
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/**
 * Close an account: anonymise the personal data, lock the login, keep the books.
 * The typed e-mail confirmation is re-checked inside the function — a dialog
 * that only checks in the browser is decoration.
 */
export async function deleteCustomerAction(userId: string, confirmEmail: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.rpc("admin_soft_delete_user", {
      p_user_id: userId, p_confirm_email: confirmEmail,
    });
    if (error) return { ok: false, error: /cannot_delete_self/.test(error.message) ? "self" : "generic" };
    const result = data as { ok?: boolean; error?: string; email?: string } | null;
    if (!result?.ok) return { ok: false, error: result?.error ?? "generic" };

    // The audit row keeps the address the account had — after this call the
    // profile no longer carries it, and an anonymised row nobody can name is
    // not much of an audit trail.
    await logAudit(supabase, {
      actorId: adminId, action: "user.deleted",
      entityType: "profile", entityId: userId, before: { email: result.email ?? null },
    });
    revalidatePath("/admin/users");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/**
 * Bulk suspend / reactivate — the only bulk operations offered.
 *
 * Both are reversible with the opposite button, which is the whole reason
 * they are safe to do to twenty accounts at once. There is deliberately no
 * bulk delete: an irreversible action against a selection nobody re-read is
 * how a customer base disappears by mis-click.
 */
export async function bulkSetBlockedAction(userIds: string[], blocked: boolean): Promise<Result & { count?: number }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const ids = [...new Set(userIds)].filter((id) => id && id !== adminId);
    if (ids.length === 0) return { ok: false, error: "empty" };
    if (ids.length > 100) return { ok: false, error: "too_many" };

    const { error } = await supabase.from("profiles").update({ blocked }).in("id", ids);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: blocked ? "user.bulk_blocked" : "user.bulk_unblocked",
      entityType: "profile", entityId: ids[0], after: { blocked, ids: ids.length },
    });
    revalidatePath("/admin/users");
    return { ok: true, count: ids.length };
  } catch { return { ok: false, error: "generic" }; }
}
