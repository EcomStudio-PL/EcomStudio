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
 * TEMPORARY BLOCK — a pause, not a deletion.
 *
 * `until` is an ISO instant, or null for an indefinite block. Nothing about
 * the customer's credits, files, history or profile is touched: the account
 * stops being usable and starts being usable again by itself.
 *
 * The write goes through admin_block_user() (0072) rather than a plain update
 * so the rules — admin only, never yourself, never a date in the past, never
 * more than a year — live in the database and hold for any caller.
 */
export async function blockUserAction(input: {
  userId: string;
  /** ISO instant, or null for indefinite. */
  until: string | null;
  reason?: string | null;
  note?: string | null;
}): Promise<Result & { until?: string | null }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!input.userId) return { ok: false, error: "invalid" };
    if (input.until && Number.isNaN(new Date(input.until).getTime())) {
      return { ok: false, error: "invalid_until" };
    }

    const { error } = await supabase.rpc("admin_block_user", {
      p_user: input.userId,
      p_until: input.until,
      p_reason: input.reason?.slice(0, 200) ?? null,
      p_note: input.note?.slice(0, 1000) ?? null,
    });
    if (error) {
      const known = ["cannot_block_self", "until_in_the_past", "until_too_far", "user_not_found"];
      const code = known.find((k) => error.message.includes(k));
      return { ok: false, error: code ?? "generic" };
    }

    // The audit row carries what §CRM asked for: who, whom, when it started,
    // when it ends and why. The internal note is not copied here — it lives on
    // the profile, and duplicating free text into an append-only log is how
    // the same sentence ends up in two places saying different things.
    await logAudit(supabase, {
      actorId: adminId, action: "user.blocked", entityType: "profile", entityId: input.userId,
      after: { expires_at: input.until, reason: input.reason ?? null },
    });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${input.userId}`);
    return { ok: true, until: input.until };
  } catch { return { ok: false, error: "generic" }; }
}

/**
 * The tidy-up sweep, run from the daily cron.
 *
 * NOT the mechanism: an expired block already stops being enforced the moment
 * it expires, because every gate reads `blocked_until` rather than trusting
 * the flag. This only clears the flag afterwards so the CRM does not keep
 * showing a customer as blocked until a date that has passed.
 */
export async function expireBlocksAction(): Promise<Result & { lifted?: number }> {
  try {
    const { supabase } = await requireAdmin();
    const { data, error } = await supabase.rpc("admin_expire_account_blocks");
    if (error) return { ok: false, error: "generic" };
    return { ok: true, lifted: Number(data ?? 0) };
  } catch { return { ok: false, error: "generic" }; }
}

/** Lift a block early. The internal note survives — why an account was paused
 *  is worth keeping after it is running again. */
export async function unblockUserAction(userId: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!userId) return { ok: false, error: "invalid" };
    const { error } = await supabase.rpc("admin_unblock_user", { p_user: userId });
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "user.unblocked", entityType: "profile", entityId: userId,
    });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
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

    // A bulk block is indefinite by design — a deadline is a per-customer
    // decision, and typing one date for twenty accounts is not that. Both
    // directions clear the temporal fields so no row is left saying it is
    // blocked until a date that no longer applies.
    const { error } = await supabase.from("profiles").update({
      blocked,
      blocked_until: null,
      blocked_reason: null,
      blocked_at: blocked ? new Date().toISOString() : null,
      blocked_by: blocked ? adminId : null,
    }).in("id", ids);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: blocked ? "user.bulk_blocked" : "user.bulk_unblocked",
      entityType: "profile", entityId: ids[0], after: { blocked, ids: ids.length },
    });
    revalidatePath("/admin/users");
    return { ok: true, count: ids.length };
  } catch { return { ok: false, error: "generic" }; }
}
