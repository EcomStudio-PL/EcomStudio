"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import {
  SAMPLE_DATA, TEMPLATE_CATALOG, catalogEntry, defaultTemplate, fieldsFromData,
  listPlaceholders, parseStoredDef, renderTemplateEmail, renderTemplateTelegram, storedFromDef,
  type TemplateDef,
} from "@/lib/server/message-templates";
import { hookUrl, pushHookConfig, readHookStatus, type HookStatus } from "@/lib/server/auth-hook-config";
import { readIntegrationSecrets, type MailConfig } from "@/lib/server/integrations";
import type { Json } from "@/lib/database.types";

/**
 * TEMPLATE EDITOR actions. Admin-only, re-checked here — a server action is
 * its own entry point. The model is DRAFT → PREVIEW → PUBLISH: saving a draft
 * can never change what production sends, because the dispatcher reads only
 * the `published` column (through the token-gated lookup), and only
 * publishTemplateAction writes it.
 *
 * Previews render server-side from SAMPLE data and are displayed inside a
 * sandboxed iframe on the client — stored template text never touches
 * dangerouslySetInnerHTML in the admin page itself.
 */

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const PAGE = "/admin/email/templates";

export async function saveTemplateDraftAction(key: string, def: TemplateDef): Promise<Result> {
  try {
    const entry = catalogEntry(key);
    if (!entry || entry.channel !== def.channel) return { ok: false, error: "invalid" };
    const { supabase, adminId } = await requireAdmin();
    const { error } = await supabase.from("message_templates").upsert({
      key,
      event_type: entry.event,
      channel: entry.channel,
      draft: storedFromDef(def) as Json,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    }, { onConflict: "key" });
    if (error) return { ok: false, error: "generic" };
    revalidatePath(PAGE);
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** Copy draft → published, bump the version. Production switches on the next
 *  send; the draft stays as the working copy. */
export async function publishTemplateAction(key: string): Promise<Result> {
  try {
    const entry = catalogEntry(key);
    // An AUTH template cannot be "published" from here — GoTrue renders it,
    // and pretending otherwise is exactly what this module refuses to do.
    if (!entry || entry.kind === "auth") return { ok: false, error: "invalid" };
    const { supabase, adminId } = await requireAdmin();
    const { data: row } = await supabase.from("message_templates")
      .select("draft, published_version").eq("key", key).maybeSingle();
    if (!row?.draft) return { ok: false, error: "no_draft" };
    const { error } = await supabase.from("message_templates").update({
      published: row.draft,
      published_version: (row.published_version ?? 0) + 1,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    }).eq("key", key);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "message_template.published",
      entityType: "message_templates", entityId: key,
      after: { version: (row.published_version ?? 0) + 1 },
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

/** Back to the built-in copy: clears BOTH draft and published (production
 *  falls back to the shipped default), keeps the row's version history. */
export async function resetTemplateAction(key: string): Promise<Result> {
  try {
    const entry = catalogEntry(key);
    if (!entry) return { ok: false, error: "invalid" };
    const { supabase, adminId } = await requireAdmin();
    const { error } = await supabase.from("message_templates").update({
      draft: null,
      published: null,
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    }).eq("key", key);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "message_template.reset",
      entityType: "message_templates", entityId: key, after: {},
    });
    revalidatePath(PAGE);
    return { ok: true };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

export type TemplatePreview =
  | { ok: true; channel: "email"; subject: string; html: string; text: string; unknown: string[] }
  | { ok: true; channel: "telegram"; text: string; unknown: string[]; buttons: string[] }
  | { ok: false; error: string };

/** Render the given DRAFT with sample data, server-side. Nothing is stored,
 *  nothing is sent — the sample person does not exist. */
export async function previewTemplateAction(key: string, def: TemplateDef): Promise<TemplatePreview> {
  try {
    const entry = catalogEntry(key);
    if (!entry || entry.channel !== def.channel) return { ok: false, error: "invalid" };
    await requireAdmin();
    const known = new Set(entry.placeholders);
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(SAMPLE_DATA)) if (known.has(k)) data[k] = v;

    if (def.channel === "telegram") {
      // Rendered exactly as production will render it — same builder, same
      // event, so the inline buttons in the preview are the real ones.
      const { text, unknown, keyboard } = renderTemplateTelegram(def.telegram, data, { event: entry.event });
      const buttons = (keyboard?.inline_keyboard ?? []).flat().map((b) => b.text);
      return { ok: true, channel: "telegram", text, unknown, buttons };
    }
    const rendered = renderTemplateEmail(def.email, data, {
      badge: entry.event.toUpperCase(),
      fields: fieldsFromData(data),
      timestamp: `${SAMPLE_DATA.date} • ${SAMPLE_DATA.time}`,
    });
    return { ok: true, channel: "email", ...rendered };
  } catch {
    return { ok: false, error: "forbidden" };
  }
}

export type TemplateListEntry = {
  key: string;
  event: string;
  channel: "email" | "telegram";
  kind: "app" | "auth";
  nameKey: string;
  groupKey: string;
  hooked: boolean;
  placeholders: string[];
  hasDraft: boolean;
  publishedVersion: number;
  publishedAt: string | null;
  updatedAt: string | null;
  draft: TemplateDef | null;
  published: TemplateDef | null;
  defaults: TemplateDef | null;
};

/** Everything the list and the editor need, joined catalog × stored rows. */
export async function listTemplatesAction(): Promise<TemplateListEntry[] | null> {
  try {
    const { supabase } = await requireAdmin();
    const { data: rows } = await supabase.from("message_templates")
      .select("key, draft, published, published_version, published_at, updated_at");
    const byKey = new Map((rows ?? []).map((r) => [r.key, r]));
    return TEMPLATE_CATALOG.map((entry) => {
      const row = byKey.get(entry.key);
      return {
        key: entry.key,
        event: entry.event,
        channel: entry.channel,
        kind: entry.kind,
        nameKey: entry.nameKey,
        groupKey: entry.groupKey,
        hooked: entry.hooked,
        placeholders: [...entry.placeholders],
        hasDraft: Boolean(row?.draft),
        publishedVersion: row?.published_version ?? 0,
        publishedAt: row?.published_at ?? null,
        updatedAt: row?.updated_at ?? null,
        draft: row ? parseStoredDef(entry.channel, row.draft) : null,
        published: row ? parseStoredDef(entry.channel, row.published) : null,
        defaults: defaultTemplate(entry.key),
      };
    });
  } catch {
    return null;
  }
}

/* ── AUTH E-MAIL DELIVERY ────────────────────────────────────────────────────
 * The old model asked an admin to copy HTML into the Supabase dashboard and
 * showed a "requires sync" badge until they did. That model is gone: with the
 * Send Email Hook, GoTrue posts the token to GrovBase and GrovBase writes and
 * sends the message from the SAME published template as everything else. What
 * is left to report is the state of the pipe — templates, mailbox, hook — and
 * it is reported only as far as it can actually be verified. */

export type AuthDeliveryView = {
  hook: HookStatus;
  /** The mailbox is complete enough to send (host, user, sealed password). */
  smtpReady: boolean;
  /** Where the endpoint lives, for the panel to show and for a person to
   *  paste into Supabase if they are configuring it by hand. */
  endpointUrl: string;
};

export async function authDeliveryStatusAction(): Promise<AuthDeliveryView | null> {
  try {
    const { supabase } = await requireAdmin();
    const [hook, mail] = await Promise.all([
      readHookStatus(supabase),
      readIntegrationSecrets<MailConfig>(supabase, "mail"),
    ]);
    const password = mail.secrets.smtp_password
      ?? (mail.config.smtp_same_as_imap ? mail.secrets.imap_password : undefined);
    return {
      hook,
      smtpReady: Boolean(mail.config.smtp_host.trim() && mail.config.smtp_user.trim() && password),
      endpointUrl: hookUrl(),
    };
  } catch {
    return null;
  }
}

export type ConfigureHookResult =
  | { ok: true; view: AuthDeliveryView | null }
  | { ok: false; reason: "forbidden" | "no_token" | "no_key" | "api" | "verify"; error?: string; view: AuthDeliveryView | null };

/**
 * Configure the hook in Supabase, secret and all, without anybody copying
 * anything. The secret is generated and sealed server-side; the only thing
 * that ever leaves this process is one TLS PATCH to the Management API, and
 * the audit row records that it happened — never the value.
 */
export async function configureAuthHookAction(): Promise<ConfigureHookResult> {
  let ctx: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    ctx = await requireAdmin();
  } catch {
    return { ok: false, reason: "forbidden", view: null };
  }
  const result = await pushHookConfig(ctx.supabase);
  await logAudit(ctx.supabase, {
    actorId: ctx.adminId, action: "auth_email_hook.configure",
    entityType: "app_settings", entityId: "auth_email_hook",
    after: { ok: result.ok, supabase: result.status.supabase, ...(result.ok ? {} : { reason: result.reason }) },
  });
  revalidatePath(PAGE);
  const view = await authDeliveryStatusAction();
  return result.ok
    ? { ok: true, view }
    : { ok: false, reason: result.reason, error: result.error, view };
}

/** The editor warns about placeholders the event will never fill. */
export async function unknownPlaceholdersFor(key: string, text: string): Promise<string[]> {
  const entry = catalogEntry(key);
  if (!entry) return [];
  const known = new Set(entry.placeholders);
  return listPlaceholders(text).filter((p) => !known.has(p));
}
