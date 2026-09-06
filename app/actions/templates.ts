"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import {
  SAMPLE_DATA, TEMPLATE_CATALOG, catalogEntry, defaultTemplate, fieldsFromData,
  listPlaceholders, parseStoredDef, renderTemplateEmail, renderTemplateTelegram, storedFromDef,
  type TemplateDef,
} from "@/lib/server/message-templates";
import { AUTH_EMAIL_TEMPLATES } from "@/lib/server/auth-email-templates";
import { readAuthSyncView, runAuthSync, type AuthSyncView } from "@/lib/server/supabase-management";
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

/** The auth templates (GoTrue-rendered): full HTML for preview and for the
 *  copy-to-Supabase button. Admin-only like everything here. */
export async function authTemplateHtmlAction(key: string): Promise<{ ok: true; subject: string; html: string } | { ok: false }> {
  try {
    await requireAdmin();
    const tpl = AUTH_EMAIL_TEMPLATES[key];
    return tpl ? { ok: true, subject: tpl.subject, html: tpl.html } : { ok: false };
  } catch {
    return { ok: false };
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

/* ── Supabase Auth sync (A11) ────────────────────────────────────────────────
 * The AUTH templates are rendered by GoTrue, so "publish" for them means
 * pushing the repo templates + Site URL + SMTP into the Supabase control
 * plane. That happens through the Management API with a server-only token —
 * see lib/server/supabase-management.ts. The UI never claims more than the
 * verified truth: statuses come from readAuthSyncView, and runAuthSync only
 * stores "synced" after reading the config back. */

export async function authSyncStatusAction(): Promise<AuthSyncView | null> {
  try {
    const { supabase } = await requireAdmin();
    return await readAuthSyncView(supabase);
  } catch {
    return null;
  }
}

export type AuthSyncActionResult =
  | { ok: true; smtpIncluded: boolean; view: AuthSyncView }
  | { ok: false; reason: "forbidden" | "no_token" | "api"; error?: string; view: AuthSyncView | null };

export async function syncSupabaseAuthAction(): Promise<AuthSyncActionResult> {
  let ctx: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    ctx = await requireAdmin();
  } catch {
    return { ok: false, reason: "forbidden", view: null };
  }
  const result = await runAuthSync(ctx.supabase);
  await logAudit(ctx.supabase, {
    actorId: ctx.adminId, action: "supabase_auth.sync",
    entityType: "app_settings", entityId: "supabase_auth_sync",
    after: { ok: result.ok, state: result.view.state, ...(result.ok ? { smtp: result.smtpIncluded } : {}) },
  });
  revalidatePath(PAGE);
  return result.ok
    ? { ok: true, smtpIncluded: result.smtpIncluded, view: result.view }
    : { ok: false, reason: result.reason, error: result.error, view: result.view };
}

/** The editor warns about placeholders the event will never fill. */
export async function unknownPlaceholdersFor(key: string, text: string): Promise<string[]> {
  const entry = catalogEntry(key);
  if (!entry) return [];
  const known = new Set(entry.placeholders);
  return listPlaceholders(text).filter((p) => !known.has(p));
}
