"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { encryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { verifySmtp, type SmtpConfig } from "@/lib/server/mailer";
import {
  cleanOverrides, type HomepageMode, type LaunchByLocale, type LaunchOverrides,
} from "@/lib/server/launch-page";
import { LOCALES } from "@/lib/i18n/config";

/**
 * PREMIERA — everything the admin panel does to the launch page, the list of
 * people waiting for it, and the mailbox that answers them.
 *
 * Each action re-checks the role itself. The admin layout already guards the
 * screens, but a server action is its own entry point: a session that is no
 * longer an admin must not be able to flip the homepage by replaying a call.
 */

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

// ---------- HOMEPAGE SWITCH ----------

export async function setHomepageModeAction(mode: HomepageMode): Promise<Result> {
  try {
    if (mode !== "full" && mode !== "waitlist") return { ok: false, error: "invalid" };
    const { supabase, adminId } = await requireAdmin();
    const { error } = await supabase.from("app_settings")
      .upsert({ key: "homepage", value: { mode } as never }, { onConflict: "key" });
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "homepage.mode_changed", entityType: "app_settings",
      entityId: "homepage", after: { mode },
    });
    // The landing is cached per-render, so the switch has to invalidate the
    // route itself — otherwise the change is real in the database and
    // invisible in the browser for five minutes.
    revalidatePath("/", "layout");
    revalidatePath("/admin/homepage");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- LAUNCH PAGE CMS ----------

async function readStore(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"]) {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "launch_page").maybeSingle();
  const v = (data?.value ?? {}) as { published?: unknown; draft?: unknown };
  return {
    published: (v.published ?? {}) as LaunchByLocale,
    draft: (v.draft ?? {}) as LaunchByLocale,
  };
}

/** Save one locale's draft. Empty fields are dropped rather than stored as
 *  blanks, so clearing a field restores the shipped translation. */
export async function saveLaunchDraftAction(locale: string, overrides: Record<string, string>): Promise<Result> {
  try {
    if (!(LOCALES as readonly string[]).includes(locale)) return { ok: false, error: "invalid_locale" };
    const { supabase, adminId } = await requireAdmin();
    const clean: LaunchOverrides = cleanOverrides(overrides);
    const store = await readStore(supabase);
    const draft: LaunchByLocale = { ...store.draft, [locale]: clean };
    const { error } = await supabase.from("app_settings")
      .upsert({ key: "launch_page", value: { published: store.published, draft } as never }, { onConflict: "key" });
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "launch_page.draft_saved", entityType: "app_settings",
      entityId: "launch_page", after: { locale, fields: Object.keys(clean).length },
    });
    revalidatePath("/admin/launch");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** Publish the whole draft. One button, one version — the live page never
 *  ends up half from the draft and half from the last release. */
export async function publishLaunchAction(): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const store = await readStore(supabase);
    const { error } = await supabase.from("app_settings")
      .upsert({ key: "launch_page", value: { published: store.draft, draft: store.draft } as never }, { onConflict: "key" });
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "launch_page.published", entityType: "app_settings", entityId: "launch_page",
    });
    revalidatePath("/", "layout");
    revalidatePath("/admin/launch");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- SUBSCRIBERS ----------

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
type SubscriberStatus = "pending" | "confirmed" | "unsubscribed";

export async function addSubscriberAction(email: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const value = email.trim().toLowerCase().slice(0, 254);
    if (!EMAIL.test(value)) return { ok: false, error: "invalid_email" };
    const { error } = await supabase.from("waitlist_subscribers")
      .insert({ email: value, source: "admin", status: "confirmed", confirmed_at: new Date().toISOString() });
    // 23505 is the case-insensitive unique index — a duplicate is a normal
    // outcome here, not a failure to log.
    if (error) return { ok: false, error: error.code === "23505" ? "duplicate" : "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "waitlist.added", entityType: "waitlist_subscribers", after: { email: value },
    });
    revalidatePath("/admin/waitlist");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

export async function bulkSubscribersAction(ids: string[], op: "delete" | "confirm" | "unsubscribe"): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const list = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);
    if (list.length === 0) return { ok: false, error: "nothing_selected" };
    if (op === "delete") {
      const { error } = await supabase.from("waitlist_subscribers").delete().in("id", list);
      if (error) return { ok: false, error: "generic" };
    } else {
      const status: SubscriberStatus = op === "confirm" ? "confirmed" : "unsubscribed";
      const { error } = await supabase.from("waitlist_subscribers")
        .update({ status, confirmed_at: op === "confirm" ? new Date().toISOString() : null })
        .in("id", list);
      if (error) return { ok: false, error: "generic" };
    }
    await logAudit(supabase, {
      actorId: adminId, action: `waitlist.${op}`, entityType: "waitlist_subscribers", after: { count: list.length },
    });
    revalidatePath("/admin/waitlist");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** The whole list as CSV. Built on the server so the export is the full table
 *  rather than whatever page the admin happened to be looking at. */
export async function exportSubscribersAction(): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.from("waitlist_subscribers")
      .select("email, status, source, locale, created_at, confirmed_at")
      .order("created_at", { ascending: false }).limit(50000);
    if (error) return { ok: false, error: "generic" };
    const cell = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "email,status,source,locale,created_at,confirmed_at",
      ...(data ?? []).map((r) =>
        [r.email, r.status, r.source, r.locale, r.created_at, r.confirmed_at].map((v) => cell(v as string | null)).join(",")),
    ].join("\r\n");
    await logAudit(supabase, {
      actorId: adminId, action: "waitlist.exported", entityType: "waitlist_subscribers",
      after: { rows: data?.length ?? 0 },
    });
    return { ok: true, csv };
  } catch { return { ok: false, error: "generic" }; }
}

// ---------- EMAIL SETTINGS ----------

export type EmailSettingsInput = {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  /** Only sent when the admin types a new one; empty means "keep the stored
   *  password", so the form never has to echo a secret back to the browser. */
  smtpPassword?: string;
  encryption: "auto" | "tls" | "ssl";
  confirmationEnabled: boolean;
  confirmationSubject: string;
  confirmationBody: string;
};

export async function saveEmailSettingsAction(input: EmailSettingsInput): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (input.fromEmail.trim() && !EMAIL.test(input.fromEmail.trim())) return { ok: false, error: "invalid_email" };
    if (input.replyTo.trim() && !EMAIL.test(input.replyTo.trim())) return { ok: false, error: "invalid_reply_to" };
    const port = Number.isInteger(input.smtpPort) && input.smtpPort > 0 && input.smtpPort < 65536
      ? input.smtpPort : 587;

    const row: Record<string, unknown> = {
      id: true,
      from_name: input.fromName.trim().slice(0, 120),
      from_email: input.fromEmail.trim().toLowerCase().slice(0, 254),
      reply_to: input.replyTo.trim().toLowerCase().slice(0, 254),
      smtp_host: input.smtpHost.trim().slice(0, 255),
      smtp_port: port,
      smtp_user: input.smtpUser.trim().slice(0, 255),
      smtp_encryption: input.encryption,
      confirmation_enabled: input.confirmationEnabled,
      confirmation_subject: input.confirmationSubject.trim().slice(0, 200),
      confirmation_body: input.confirmationBody.trim().slice(0, 4000),
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    };

    const typed = (input.smtpPassword ?? "").trim();
    if (typed) {
      if (!encryptionAvailable()) return { ok: false, error: "encryption_unavailable" };
      const { ciphertext, iv, authTag } = encryptSecret(typed);
      row.smtp_secret_ciphertext = ciphertext;
      row.smtp_secret_iv = iv;
      row.smtp_secret_auth_tag = authTag;
    }

    const { error } = await supabase.from("email_settings").upsert(row as never, { onConflict: "id" });
    if (error) return { ok: false, error: "generic" };
    // The audit trail records that the settings changed and never what the
    // password is — not even its length.
    await logAudit(supabase, {
      actorId: adminId, action: "email_settings.saved", entityType: "email_settings", entityId: "1",
      after: { host: row.smtp_host, port, encryption: input.encryption, password_changed: Boolean(typed) },
    });
    revalidatePath("/admin/email");
    return { ok: true };
  } catch { return { ok: false, error: "generic" }; }
}

/** Open a connection, authenticate, hang up. Nothing is sent to anyone, and
 *  the result is written back so the screen can show when it last worked. */
export async function testEmailConnectionAction(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const { data, error } = await supabase.rpc("email_transport");
    if (error) return { ok: false, error: "generic" };
    const cfg = (data ?? {}) as Partial<SmtpConfig> & { configured?: boolean };
    if (!cfg.configured) return { ok: false, error: "not_configured" };
    const result = await verifySmtp({
      host: cfg.host ?? "",
      port: cfg.port ?? 587,
      user: cfg.user ?? "",
      encryption: (cfg.encryption ?? "auto") as SmtpConfig["encryption"],
      ciphertext: cfg.ciphertext ?? null,
      iv: cfg.iv ?? null,
      auth_tag: cfg.auth_tag ?? null,
    });
    await supabase.from("email_settings").update({
      last_tested_at: new Date().toISOString(),
      last_test_status: result.ok ? "ok" : "failed",
      last_test_error_safe: result.error ?? null,
    }).eq("id", true);
    await logAudit(supabase, {
      actorId: adminId, action: "email_settings.tested", entityType: "email_settings", entityId: "1",
      after: { ok: result.ok },
    });
    revalidatePath("/admin/email");
    return result;
  } catch { return { ok: false, error: "generic" }; }
}
