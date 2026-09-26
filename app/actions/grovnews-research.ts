"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import { isUuid } from "@/lib/grovnews";
import {
  isValidSourceSecret, normalizeTitle, normalizeUrl, validateManualItem, validateSettingsInput, validateSourceInput, warsawDate,
  type SourceInputError,
} from "@/lib/grovnews-research";
import * as store from "@/lib/server/grovnews/store";
import {
  analyzeQueue, budget, composeEditionMail, contentHash, draftQueue, errorCode, ingestSources, mailBody, runDaily,
} from "@/lib/server/grovnews/pipeline";
import { GROVNEWS_MODEL_OPTIONS, grovnewsEngine } from "@/lib/server/grovnews/ai";
import { healthFromApiProbe, probeApiSource, sourceSecretName } from "@/lib/server/grovnews/api";
import { sendOperatorCopies } from "@/lib/server/grovnews/operators";
import { clearSecret, putSecret, secretStatuses } from "@/lib/server/secret-store";
import { digestUtm } from "@/lib/server/grovnews/compose";
import { composeDailyMail, mailBodyDaily } from "@/lib/server/grovnews/daily";
import { healthFromProbe, probeSource } from "@/lib/server/grovnews/probe";
import { readDailyRecord } from "@/lib/grovnews-research";
import type { ProbeSummary } from "@/lib/grovnews-import";
import {
  createCampaignAction, deleteCampaignAction, saveCampaignAction, saveStepAction, scheduleCampaignAction,
  sendTestCampaignAction,
} from "@/app/actions/newsletter";

/**
 * GROVNEWS STAGE 2 — admin actions: sources, the research inbox, editions and
 * their mail, the automation settings.
 *
 * Every export re-checks the ADMIN ROLE first; RLS (0121) and the token-gated
 * functions check again underneath. The research and edition work goes
 * through the same pipeline the daily job runs (lib/server/grovnews), so the
 * button and the schedule cannot drift apart.
 *
 * THE MAIL GOES THROUGH THE NEWSLETTER'S OWN ACTIONS — create the campaign,
 * write its step, send a test, schedule it — exactly as an operator would in
 * the Newsletter panel. Nothing here writes a newsletter table directly; the
 * newsletter's audience resolution, consent and suppression rules, queue,
 * worker and tracking are used as they are.
 */

type Fail<E extends string = never> = { ok: false; error: "forbidden" | "invalid" | "generic" | E };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("forbidden");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("forbidden");
  return { supabase, adminId: user.id };
}

const forbidden = (e: unknown) => e instanceof Error && e.message === "forbidden";
const failed = (e: unknown): Fail => ({ ok: false, error: forbidden(e) ? "forbidden" : "generic" });

function revalidateAll() {
  revalidatePath("/admin/newsletter/grovnews", "layout");
  revalidatePath("/grovnews", "layout");
}

/** The job's doors need the server key; say so plainly instead of failing
 *  somewhere deeper with a generic error. */
const NO_SERVER_KEY = { ok: false as const, error: "noServerKey" as const };

/** A trigger's refusal, as the code the UI translates. */
function guardError(e: { message?: string } | null): string {
  const m = e?.message ?? "";
  if (m.includes("grovnews_edition_empty")) return "empty";
  if (m.includes("grovnews_edition_unpublished_posts")) return "unpublished";
  if (m.includes("grovnews_edition_locked")) return "locked";
  if (m.includes("grovnews_post_in_edition")) return "inEdition";
  return "generic";
}

/* ── sources ───────────────────────────────────────────────────────────────── */

export async function saveSourceAction(id: string | null, raw: unknown):
  Promise<{ ok: true; id: string } | Fail<SourceInputError | "urlTaken">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (id !== null && !isUuid(id)) return { ok: false, error: "invalid" };
    const parsed = validateSourceInput(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const v = parsed.value;
    // 0128: how an API source authenticates. The secret is NOT part of this
    // row (saveSourceSecretAction writes it to the vault).
    const row = {
      name: v.name, source_type: v.type, url: v.url, enabled: v.enabled, category_id: v.categoryId,
      priority: v.priority, official_source: v.official, language: v.language,
      auth_kind: v.authKind, auth_header: v.authHeader,
    };
    const res = id
      ? await supabase.from("grovnews_sources").update(row).eq("id", id).select("id").maybeSingle()
      : await supabase.from("grovnews_sources").insert({ ...row, created_by: adminId }).select("id").single();
    if (res.error) return { ok: false, error: res.error.code === "23505" ? "urlTaken" : res.error.code === "23503" ? "category" : "generic" };
    if (!res.data) return { ok: false, error: "invalid" };
    // A source that no longer sends a key keeps none: its stored secret goes.
    if (id && v.authKind === "none") await clearSecret(supabase, sourceSecretName(res.data.id));
    await logAudit(supabase, {
      actorId: adminId, action: id ? "grovnews.source_updated" : "grovnews.source_created",
      entityType: "grovnews_source", entityId: res.data.id,
      after: { name: v.name, type: v.type, url: v.url, official: v.official, auth: v.authKind },
    });
    revalidateAll();
    return { ok: true, id: res.data.id };
  } catch (e) {
    return failed(e);
  }
}

export async function setSourceEnabledAction(id: string, enabled: boolean): Promise<{ ok: true } | Fail> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    const { error } = await supabase.from("grovnews_sources").update({ enabled: Boolean(enabled) }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.source_enabled", entityType: "grovnews_source", entityId: id, after: { enabled: Boolean(enabled) },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * Test one saved source now ("Testuj"): read it through the same guarded
 * fetcher the daily job uses — robots.txt first, no login, no retry around a
 * refusal — say what the URL really is, and RECORD its health (0125 §2). No
 * item is stored; the source's own settings are not changed (a better type
 * is offered, the admin decides).
 */
export async function testSourceAction(id: string):
  Promise<{ ok: true; entries: number; sample: string[]; health: string; probe: ProbeSummary }
    | (Fail<"fetch" | "notFetchable"> & { code?: string; health?: string; probe?: ProbeSummary })> {
  try {
    const { supabase } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    const { data: s } = await supabase.from("grovnews_sources")
      .select("id, name, source_type, url, category_id, priority, official_source, language, auth_kind, auth_header").eq("id", id).maybeSingle();
    if (!s) return { ok: false, error: "invalid" };
    if (s.source_type === "MANUAL" || !s.url) return { ok: false, error: "notFetchable", code: "manual" };
    if (s.source_type === "API") {
      // 0128: the API reader — its key (from the vault, server-side) to its
      // own origin only. The answer is a verdict and codes; never the key,
      // never the upstream body.
      const probe = await probeApiSource(supabase, {
        id: s.id, url: s.url, authKind: s.auth_kind === "bearer" || s.auth_kind === "header" ? s.auth_kind : "none", authHeader: s.auth_header,
      });
      const result = healthFromApiProbe(probe);
      const health = await store.sourceChecked(supabase, s.id, result);
      revalidateAll();
      if (result.ok) return { ok: true, entries: probe.entries, sample: probe.sample, health, probe };
      return { ok: false, error: "fetch", code: result.error ?? "error", health, probe };
    }
    const probe = await probeSource(s.url, { deadline: Date.now() + 90_000 });
    const result = healthFromProbe(probe, { url: s.url, type: s.source_type });
    const health = await store.sourceChecked(supabase, s.id, result);
    revalidateAll();
    if (result.ok) return { ok: true, entries: result.entries ?? 0, sample: probe.sample, health, probe };
    return { ok: false, error: "fetch", code: result.error ?? errorCode(null), health, probe };
  } catch (e) {
    return failed(e);
  }
}

/* ── API sources: the secret (0128) ────────────────────────────────────────── */

/**
 * Store (or replace) an API source's secret in the vault. Only for an API
 * source that is configured to send one. The value is written and forgotten:
 * it is not returned, not logged and not audited — the audit records only
 * that it changed.
 */
export async function saveSourceSecretAction(id: string, secret: string):
  Promise<{ ok: true; lastFour: string | null } | Fail<"notApi" | "secret">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    if (!isValidSourceSecret(secret)) return { ok: false, error: "secret" };
    const { data: s } = await supabase.from("grovnews_sources").select("id, source_type, auth_kind").eq("id", id).maybeSingle();
    if (!s) return { ok: false, error: "invalid" };
    if (s.source_type !== "API" || s.auth_kind === "none") return { ok: false, error: "notApi" };
    const name = sourceSecretName(id);
    const put = await putSecret(supabase, name, secret);
    if (!put.ok) return { ok: false, error: put.error === "forbidden" ? "forbidden" : "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.source_secret_saved", entityType: "grovnews_source", entityId: id, after: { secret: "replaced" },
    });
    revalidateAll();
    const status = (await secretStatuses(supabase, [name])).get(name);
    return { ok: true, lastFour: status?.lastFour ?? null };
  } catch (e) {
    return failed(e);
  }
}

/** Remove an API source's secret from the vault. */
export async function clearSourceSecretAction(id: string): Promise<{ ok: true; removed: boolean } | Fail> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    const removed = await clearSecret(supabase, sourceSecretName(id));
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.source_secret_removed", entityType: "grovnews_source", entityId: id, after: { removed },
    });
    revalidateAll();
    return { ok: true, removed };
  } catch (e) {
    return failed(e);
  }
}

/* ── research ──────────────────────────────────────────────────────────────── */

/** Read every enabled source (or one) now: new items land in the inbox. */
export async function ingestNowAction(sourceId: string | null):
  Promise<{ ok: true; sources: number; failed: number; inserted: number; duplicates: number } | Fail<"noServerKey">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (sourceId !== null && !isUuid(sourceId)) return { ok: false, error: "invalid" };
    if (!store.serverTokenAvailable()) return NO_SERVER_KEY;
    const ctx = await store.jobContext(supabase);
    const r = await ingestSources(supabase, ctx, budget(55_000), sourceId ?? undefined);
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.ingest_run", entityType: "grovnews_source", entityId: sourceId ?? undefined,
      after: { sources: r.sources, failed: r.failed, inserted: r.inserted, duplicates: r.duplicates },
    });
    revalidateAll();
    return { ok: true, sources: r.sources, failed: r.failed, inserted: r.inserted, duplicates: r.duplicates };
  } catch (e) {
    return failed(e);
  }
}

/** Analyse the waiting items now, within one request's time. */
export async function analyzeNowAction():
  Promise<{ ok: true; analyzed: number; failed: number; remaining: number } | Fail<"noServerKey" | "aiUnavailable">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!store.serverTokenAvailable()) return NO_SERVER_KEY;
    const engine = await grovnewsEngine(supabase, { ref: "grovnews:analyze" });
    if (!engine) return { ok: false, error: "aiUnavailable" };
    const ctx = await store.jobContext(supabase);
    const r = await analyzeQueue(supabase, ctx, engine, budget(150_000), 15);
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.analyze_run", entityType: "grovnews_research_item",
      after: { analyzed: r.analyzed, failed: r.failed, remaining: r.remaining },
    });
    revalidateAll();
    return { ok: true, analyzed: r.analyzed, failed: r.failed, remaining: r.remaining };
  } catch (e) {
    return failed(e);
  }
}

export type ItemOp = "select" | "reject" | "restore" | "reanalyze";

export async function setItemStatusAction(id: string, op: ItemOp): Promise<{ ok: true } | Fail<"used">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id) || !["select", "reject", "restore", "reanalyze"].includes(op)) return { ok: false, error: "invalid" };
    const { data: item } = await supabase.from("grovnews_research_items")
      .select("id, status, analyzed_at, post_id").eq("id", id).maybeSingle();
    if (!item) return { ok: false, error: "invalid" };
    // An item that became a post keeps that history; the post is edited instead.
    if (item.status === "USED" || item.post_id) return { ok: false, error: "used" };

    const now = new Date().toISOString();
    const patch =
      op === "select" ? { status: "SELECTED", selected_at: now }
      : op === "reject" ? { status: "REJECTED" }
      : op === "restore" ? { status: item.analyzed_at ? "ANALYZED" : "NEW", duplicate_of: null }
      : { status: "NEW", analysis_attempts: 0, analysis_error: null, duplicate_of: null };
    const { error } = await supabase.from("grovnews_research_items").update(patch).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: `grovnews.item_${op}`, entityType: "grovnews_research_item", entityId: id,
      before: { status: item.status }, after: { status: patch.status },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export async function markDuplicateAction(id: string, originalId: string | null): Promise<{ ok: true } | Fail<"used">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id) || (originalId !== null && (!isUuid(originalId) || originalId === id))) return { ok: false, error: "invalid" };
    const { data: item } = await supabase.from("grovnews_research_items").select("status, post_id").eq("id", id).maybeSingle();
    if (!item) return { ok: false, error: "invalid" };
    if (item.status === "USED" || item.post_id) return { ok: false, error: "used" };
    if (originalId) {
      const { data: original } = await supabase.from("grovnews_research_items")
        .select("id, duplicate_of").eq("id", originalId).maybeSingle();
      // A duplicate points at an original, never at another duplicate.
      if (!original || original.duplicate_of) return { ok: false, error: "invalid" };
    }
    const { error } = await supabase.from("grovnews_research_items")
      .update({ status: "DUPLICATE", duplicate_of: originalId }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.item_duplicate", entityType: "grovnews_research_item", entityId: id,
      after: { duplicate_of: originalId },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/** Write a DRAFT post from one item with the configured AI. Never publishes:
 *  an admin-started draft is always reviewed in the editor. */
export async function createDraftFromItemAction(id: string):
  Promise<{ ok: true; postId: string } | Fail<"used" | "noServerKey" | "aiUnavailable" | "aiFailed">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    if (!store.serverTokenAvailable()) return NO_SERVER_KEY;
    const { data: item } = await supabase.from("grovnews_research_items").select("status, post_id").eq("id", id).maybeSingle();
    if (!item) return { ok: false, error: "invalid" };
    if (item.post_id) return { ok: true, postId: item.post_id };
    if (item.status === "USED") return { ok: false, error: "used" };
    const engine = await grovnewsEngine(supabase, { ref: "grovnews:draft" });
    if (!engine) return { ok: false, error: "aiUnavailable" };
    if (item.status !== "SELECTED") {
      const { error } = await supabase.from("grovnews_research_items")
        .update({ status: "SELECTED", selected_at: new Date().toISOString(), duplicate_of: null }).eq("id", id);
      if (error) return { ok: false, error: "generic" };
    }
    await draftQueue(supabase, engine, budget(150_000), false, id);
    const { data: after } = await supabase.from("grovnews_research_items").select("post_id").eq("id", id).maybeSingle();
    if (!after?.post_id) return { ok: false, error: "aiFailed" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.draft_created", entityType: "grovnews_post", entityId: after.post_id,
      after: { research_item: id },
    });
    revalidateAll();
    return { ok: true, postId: after.post_id };
  } catch (e) {
    return failed(e);
  }
}

/** An item an admin found themselves (an official communiqué, say). It is
 *  the admin's own extract — the article is not copied. */
export async function addManualItemAction(raw: unknown): Promise<{ ok: true; id: string } | Fail<"duplicateUrl">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const parsed = validateManualItem(raw);
    if (!parsed.ok) return { ok: false, error: "invalid" };
    const v = parsed.value;
    const nurl = normalizeUrl(v.url);
    if (!nurl) return { ok: false, error: "invalid" };
    let categoryId: string | null = null;
    if (v.sourceId) {
      const { data: s } = await supabase.from("grovnews_sources").select("category_id").eq("id", v.sourceId).maybeSingle();
      if (!s) return { ok: false, error: "invalid" };
      categoryId = s.category_id;
    }
    const { data, error } = await supabase.from("grovnews_research_items").insert({
      source_id: v.sourceId, canonical_url: v.url, normalized_url: nurl, source_title: v.title, source_excerpt: v.excerpt,
      content_hash: contentHash(v.title, v.excerpt), title_norm: normalizeTitle(v.title), category_id: categoryId,
      status: "NEW", metadata: { manual: true },
    }).select("id").single();
    if (error) return { ok: false, error: error.code === "23505" ? "duplicateUrl" : "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.item_added", entityType: "grovnews_research_item", entityId: data.id,
      after: { url: v.url },
    });
    revalidateAll();
    return { ok: true, id: data.id };
  } catch (e) {
    return failed(e);
  }
}

/* ── editions ──────────────────────────────────────────────────────────────── */

/** Today's edition: built from recent posts when there are any, otherwise an
 *  empty draft to fill by hand. Never a second one for the same day. */
export async function buildEditionAction(): Promise<{ ok: true; id: string } | Fail<"noServerKey">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!store.serverTokenAvailable()) return NO_SERVER_KEY;
    const date = warsawDate();
    const r = await store.buildEdition(supabase, date, false);
    let id = r.edition_id;
    if (!id) {
      const { data: existing } = await supabase.from("grovnews_editions").select("id").eq("edition_date", date).maybeSingle();
      id = existing?.id ?? null;
      if (!id) {
        const { data, error } = await supabase.from("grovnews_editions")
          .insert({ edition_date: date, title: `GrovNews — ${date.split("-").reverse().join(".")}`, status: "DRAFT", created_by: adminId })
          .select("id").single();
        if (error || !data) return { ok: false, error: "generic" };
        id = data.id;
      }
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.edition_built", entityType: "grovnews_edition", entityId: id, after: { date, added: r.added },
    });
    revalidateAll();
    return { ok: true, id };
  } catch (e) {
    return failed(e);
  }
}

export async function saveEditionAction(id: string, input: { title: string; intro: string }): Promise<{ ok: true } | Fail<"locked">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    const title = String(input?.title ?? "").trim().slice(0, 200);
    const intro = String(input?.intro ?? "").trim().slice(0, 1500);
    if (!title) return { ok: false, error: "invalid" };
    const { data: e0 } = await supabase.from("grovnews_editions").select("status").eq("id", id).maybeSingle();
    if (!e0) return { ok: false, error: "invalid" };
    if (!["DRAFT", "READY", "PUBLISHED"].includes(e0.status)) return { ok: false, error: "locked" };
    const { error } = await supabase.from("grovnews_editions").update({ title, intro }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, { actorId: adminId, action: "grovnews.edition_saved", entityType: "grovnews_edition", entityId: id, after: { title } });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/** Which posts, in what order, which is featured — one call, one transaction. */
export async function arrangeEditionAction(id: string, postIds: string[], featured: string | null):
  Promise<{ ok: true } | Fail<"locked">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const ids = Array.isArray(postIds) ? postIds : [];
    if (!isUuid(id) || ids.length > 20 || !ids.every(isUuid) || new Set(ids).size !== ids.length
        || (featured !== null && !ids.includes(featured))) {
      return { ok: false, error: "invalid" };
    }
    const { error } = await supabase.rpc("grovnews_edition_arrange", { p_edition_id: id, p_post_ids: ids, p_featured: featured });
    if (error) return { ok: false, error: guardError(error) === "locked" ? "locked" : "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.edition_arranged", entityType: "grovnews_edition", entityId: id, after: { posts: ids.length },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export type EditionTarget = "DRAFT" | "READY" | "PUBLISHED" | "ARCHIVED";

const TRANSITIONS: Record<string, readonly EditionTarget[]> = {
  DRAFT: ["READY", "ARCHIVED"],
  READY: ["PUBLISHED", "DRAFT", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  FAILED: ["ARCHIVED"],
};

/**
 * Move an edition along. The DATABASE refuses READY/PUBLISHED while any post
 * is not published (0121 §4.1); this only keeps the moves to the sensible
 * ones and turns the refusal into words.
 */
export async function setEditionStatusAction(id: string, target: EditionTarget):
  Promise<{ ok: true } | Fail<"empty" | "unpublished" | "locked">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    const { data: ed } = await supabase.from("grovnews_editions").select("status, campaign_id, published_at").eq("id", id).maybeSingle();
    if (!ed) return { ok: false, error: "invalid" };
    if (!(TRANSITIONS[ed.status] ?? []).includes(target)) return { ok: false, error: "locked" };
    // Once a campaign has left draft, the edition belongs to its send.
    if (ed.campaign_id && target !== "PUBLISHED") {
      const { data: k } = await supabase.from("newsletter_campaigns").select("status").eq("id", ed.campaign_id).maybeSingle();
      if (k && k.status !== "draft") return { ok: false, error: "locked" };
    }
    const patch: { status: EditionTarget; published_at?: string } = { status: target };
    if (target === "PUBLISHED" && !ed.published_at) patch.published_at = new Date().toISOString();
    const { error } = await supabase.from("grovnews_editions").update(patch).eq("id", id);
    if (error) {
      const code = guardError(error);
      return { ok: false, error: code === "empty" || code === "unpublished" || code === "locked" ? code : "generic" };
    }
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.edition_status", entityType: "grovnews_edition", entityId: id,
      before: { status: ed.status }, after: { status: target },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

type EditionRow = {
  id: string; status: string; campaign_id: string | null; edition_date: string; title: string; intro: string;
  article_post_id: string | null; daily: unknown;
};

async function readEdition(supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"], id: string): Promise<EditionRow | null> {
  const { data } = await supabase.from("grovnews_editions")
    .select("id, status, campaign_id, edition_date, title, intro, article_post_id, daily").eq("id", id).maybeSingle();
  return data;
}

/**
 * THE MAIL OF A DAY'S ARTICLE (0125): one intro, one short section per topic,
 * links only to the published article (and its topic anchors, 0128). Built from the edition's own record,
 * never from what a campaign row says now. Null when this is not an article
 * edition (the Stage 2 digest path applies).
 */
function dailyMailOf(ed: Pick<EditionRow, "article_post_id" | "daily">, source: store.MailSource):
  { subject: string; preview: string; intro: string; html: string } | null {
  if (!ed.article_post_id) return null;
  const record = readDailyRecord(ed.daily);
  const article = source.posts.find((p) => p.id === ed.article_post_id);
  if (!record || !article) throw new Error("edition_empty");
  const mail = composeDailyMail(source.date, record);
  const { html } = mailBodyDaily(source.date, article.slug, mail);
  return { subject: mail.subject, preview: mail.preview, intro: mail.intro, html };
}

/** Every post the edition carries is in the mail source (which lists only
 *  PUBLISHED, live posts) — i.e. nothing unpublished is attached. */
async function allPostsPublished(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"], editionId: string, source: store.MailSource,
): Promise<boolean> {
  const { count } = await supabase.from("grovnews_edition_posts")
    .select("post_id", { count: "exact", head: true }).eq("edition_id", editionId);
  return (count ?? 0) > 0 && count === source.posts.length;
}

/**
 * Prepare the day's mail: the digest (AI when configured, the posts' own words
 * when not), stored on the edition, and a DRAFT newsletter campaign for the
 * GrovNews group built through the newsletter's own actions. Nothing is sent.
 */
export async function prepareEmailAction(id: string):
  Promise<{ ok: true; aiUsed: boolean; campaignId: string } | Fail<"noServerKey" | "notPublished" | "unpublished" | "campaignLocked" | "newsletter">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    if (!store.serverTokenAvailable()) return NO_SERVER_KEY;
    const ed = await readEdition(supabase, id);
    if (!ed) return { ok: false, error: "invalid" };
    if (ed.status !== "PUBLISHED") return { ok: false, error: "notPublished" };
    const source = await store.editionMailSource(supabase, id);
    if (!source || !(await allPostsPublished(supabase, id, source))) return { ok: false, error: "unpublished" };

    const daily = dailyMailOf(ed, source);
    const engine = daily ? null : await grovnewsEngine(supabase, { ref: "grovnews:mail" });
    const edition = { date: source.date, title: source.title, intro: source.intro };
    const mail = daily
      ? { subject: daily.subject, preview: daily.preview, intro: daily.intro, blurbs: new Map<string, string>(), aiUsed: false }
      : await composeEditionMail(engine, edition, source.posts);
    const html = daily ? daily.html : mailBody(edition, mail.intro, source.posts, mail.blurbs).html;

    for (const p of daily ? [] : source.posts) {
      const { error } = await supabase.from("grovnews_edition_posts")
        .update({ email_blurb: mail.blurbs.get(p.id) ?? null }).eq("edition_id", id).eq("post_id", p.id);
      if (error) return { ok: false, error: guardError(error) === "locked" ? "campaignLocked" : "generic" };
    }

    const group = await store.groupSync(supabase);
    const audience = { include: [group.group_id], exclude: [] };
    let campaignId = ed.campaign_id;
    if (campaignId) {
      const { data: k } = await supabase.from("newsletter_campaigns").select("status").eq("id", campaignId).maybeSingle();
      if (!k) campaignId = null;
      else if (k.status !== "draft") return { ok: false, error: "campaignLocked" };
    }
    if (!campaignId) {
      const created = await createCampaignAction({ name: ed.title, kind: "one_off", audience });
      if (!created.ok || !created.data) return { ok: false, error: "newsletter" };
      // Claim the edition for this campaign — only if nobody claimed it first.
      const { data: claimed } = await supabase.from("grovnews_editions")
        .update({ campaign_id: created.data.id }).eq("id", id).is("campaign_id", null).select("id").maybeSingle();
      if (!claimed) {
        await deleteCampaignAction(created.data.id);
        return { ok: false, error: "campaignLocked" };
      }
      campaignId = created.data.id;
    }
    const settings = await saveCampaignAction({
      id: campaignId, name: ed.title, audience, trackOpens: true, trackClicks: true, utm: digestUtm(source.date),
    });
    if (!settings.ok) return { ok: false, error: "newsletter" };
    const step = await saveStepAction({
      campaignId, stepIndex: 0, variant: "A", subject: mail.subject, preheader: mail.preview, editor: "html", bodyHtml: html,
    });
    if (!step.ok) return { ok: false, error: "newsletter" };

    const { error } = await supabase.from("grovnews_editions").update({
      email_subject: mail.subject.slice(0, 200), email_preview: mail.preview.slice(0, 300) || null, email_body: html,
      email_prepared_at: new Date().toISOString(), intro: ed.intro.trim() ? ed.intro : mail.intro.slice(0, 1500),
      failure_reason: null,
    }).eq("id", id);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.email_prepared", entityType: "grovnews_edition", entityId: id,
      after: { campaign: campaignId, ai: mail.aiUsed, posts: source.posts.length },
    });
    revalidateAll();
    return { ok: true, aiUsed: mail.aiUsed, campaignId };
  } catch (e) {
    return failed(e);
  }
}

/** The admin's own edits to the mail copy: stored, re-rendered, and written to
 *  the draft campaign's step. */
export async function saveEmailAction(id: string, input: {
  subject: string; preview: string; intro: string; blurbs: Record<string, string>;
}): Promise<{ ok: true } | Fail<"noServerKey" | "notPrepared" | "campaignLocked" | "unpublished" | "newsletter">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id) || !input || typeof input !== "object") return { ok: false, error: "invalid" };
    if (!store.serverTokenAvailable()) return NO_SERVER_KEY;
    const subject = String(input.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const preview = String(input.preview ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const intro = String(input.intro ?? "").trim().slice(0, 1500);
    if (!subject) return { ok: false, error: "invalid" };
    const ed = await readEdition(supabase, id);
    if (!ed) return { ok: false, error: "invalid" };
    if (ed.status !== "PUBLISHED" || !ed.campaign_id) return { ok: false, error: "notPrepared" };
    const { data: k } = await supabase.from("newsletter_campaigns").select("status").eq("id", ed.campaign_id).maybeSingle();
    if (!k || k.status !== "draft") return { ok: false, error: "campaignLocked" };

    const source = await store.editionMailSource(supabase, id);
    if (!source || !(await allPostsPublished(supabase, id, source))) return { ok: false, error: "unpublished" };
    // A day's article mail is written from its record (edited in the daily
    // review panel), not from per-post blurbs.
    if (ed.article_post_id) return { ok: false, error: "invalid" };
    const blurbs = new Map<string, string>();
    for (const p of source.posts) {
      const given = input.blurbs?.[p.id];
      const text = typeof given === "string" ? given.trim().slice(0, 1500) : (p.blurb ?? "");
      blurbs.set(p.id, text);
      const { error } = await supabase.from("grovnews_edition_posts")
        .update({ email_blurb: text || null }).eq("edition_id", id).eq("post_id", p.id);
      if (error) return { ok: false, error: "generic" };
    }
    const { html } = mailBody({ date: source.date, title: source.title }, intro, source.posts, blurbs);
    const step = await saveStepAction({
      campaignId: ed.campaign_id, stepIndex: 0, variant: "A", subject, preheader: preview, editor: "html", bodyHtml: html,
    });
    if (!step.ok) return { ok: false, error: "newsletter" };
    const { error } = await supabase.from("grovnews_editions").update({
      email_subject: subject, email_preview: preview || null, email_body: html, intro, email_prepared_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, { actorId: adminId, action: "grovnews.email_saved", entityType: "grovnews_edition", entityId: id, after: { subject } });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * A test to the admin's own addresses, through the newsletter's own test send:
 * suppression still applies, the edition's status does not change, no
 * campaign is started and nobody else receives anything.
 */
export async function testSendEditionAction(id: string, addresses: string[]):
  Promise<{ ok: true; sent: number } | Fail<"notPrepared" | "newsletter"> & { code?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    const ed = await readEdition(supabase, id);
    if (!ed?.campaign_id) return { ok: false, error: "notPrepared" };
    const res = await sendTestCampaignAction({ campaignId: ed.campaign_id, addresses: (addresses ?? []).slice(0, 5) });
    if (!res.ok) return { ok: false, error: "newsletter", code: res.error };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.email_test", entityType: "grovnews_edition", entityId: id, after: { sent: res.data?.sent ?? 0 },
    });
    return { ok: true, sent: res.data?.sent ?? 0 };
  } catch (e) {
    return failed(e);
  }
}

/**
 * SEND. Re-verifies everything at the moment of sending — every post
 * published, the campaign still a draft aimed only at the GrovNews group, the
 * body rebuilt from the edition — then hands it to the newsletter's own
 * scheduler. A second press finds the campaign already sending and changes
 * nothing; the newsletter's unique queue index is the second line.
 */
export async function sendEditionAction(id: string):
  Promise<{ ok: true; recipients: number; already?: boolean }
    | Fail<"noServerKey" | "notPrepared" | "unpublished" | "audienceChanged" | "noRecipients" | "newsletter"> & { code?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "invalid" };
    if (!store.serverTokenAvailable()) return NO_SERVER_KEY;
    const { data: ed } = await supabase.from("grovnews_editions")
      .select("id, status, campaign_id, edition_date, title, intro, email_subject, email_preview, email_prepared_at, email_recipients, article_post_id, daily")
      .eq("id", id).maybeSingle();
    if (!ed) return { ok: false, error: "invalid" };
    if (ed.status === "QUEUED" || ed.status === "SENT") return { ok: true, recipients: ed.email_recipients ?? 0, already: true };
    if (ed.status !== "PUBLISHED" || !ed.campaign_id || !ed.email_prepared_at || !ed.email_subject) {
      return { ok: false, error: "notPrepared" };
    }

    const { data: k } = await supabase.from("newsletter_campaigns").select("status, audience").eq("id", ed.campaign_id).maybeSingle();
    if (!k) return { ok: false, error: "notPrepared" };
    if (k.status === "sending" || k.status === "scheduled" || k.status === "sent") {
      // A retry after the queue was already written: record it, send nothing.
      const { error } = await supabase.from("grovnews_editions")
        .update({ status: "QUEUED", queued_at: new Date().toISOString() }).eq("id", id).eq("status", "PUBLISHED");
      if (error) return { ok: false, error: "generic" };
      revalidateAll();
      return { ok: true, recipients: ed.email_recipients ?? 0, already: true };
    }
    if (k.status !== "draft") return { ok: false, error: "notPrepared" };

    const source = await store.editionMailSource(supabase, id);
    if (!source || !(await allPostsPublished(supabase, id, source))) return { ok: false, error: "unpublished" };

    const group = await store.groupSync(supabase);
    const aud = (k.audience ?? {}) as { include?: unknown; exclude?: unknown };
    const include = Array.isArray(aud.include) ? aud.include : [];
    const exclude = Array.isArray(aud.exclude) ? aud.exclude : [];
    if (include.length !== 1 || include[0] !== group.group_id || exclude.length !== 0) return { ok: false, error: "audienceChanged" };

    // CLAIM THE SEND. A double click, two tabs, two admins: exactly one
    // request gets past this conditional update; the others answer "already".
    // A claim older than two minutes is a request that died midway and may be
    // taken over (the newsletter's unique queue index still stops a repeat).
    const claimedAt = new Date().toISOString();
    const { data: claim } = await supabase.from("grovnews_editions").update({ queued_at: claimedAt })
      .eq("id", id).eq("status", "PUBLISHED")
      .or(`queued_at.is.null,queued_at.lt.${new Date(Date.now() - 120_000).toISOString()}`)
      .select("id").maybeSingle();
    if (!claim) return { ok: true, recipients: ed.email_recipients ?? 0, already: true };
    const release = () => supabase.from("grovnews_editions").update({ queued_at: null }).eq("id", id).eq("status", "PUBLISHED");

    // The body that goes out is rebuilt here from the edition, not trusted
    // from the campaign row someone may have edited in the meantime.
    const blurbs = new Map(source.posts.map((p) => [p.id, p.blurb ?? ""]));
    let html: string;
    try {
      html = dailyMailOf(ed, source)?.html ?? mailBody({ date: source.date, title: source.title }, source.intro, source.posts, blurbs).html;
    } catch {
      await release();
      return { ok: false, error: "unpublished" };
    }
    const step = await saveStepAction({
      campaignId: ed.campaign_id, stepIndex: 0, variant: "A", subject: ed.email_subject, preheader: ed.email_preview ?? "",
      editor: "html", bodyHtml: html,
    });
    if (!step.ok) {
      await release();
      return { ok: false, error: "newsletter", code: step.error };
    }

    const res = await scheduleCampaignAction({ campaignId: ed.campaign_id, when: "now" });
    if (!res.ok) {
      await release();
      if (res.error === "noRecipients") {
        await supabase.from("grovnews_editions").update({ failure_reason: "no_recipients" }).eq("id", id);
        revalidateAll();
        return { ok: false, error: "noRecipients" };
      }
      return { ok: false, error: "newsletter", code: res.error };
    }
    const recipients = res.data?.recipients ?? 0;
    const { error } = await supabase.from("grovnews_editions").update({
      status: "QUEUED", queued_at: claimedAt, email_recipients: recipients, failure_reason: null, email_body: html,
    }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    // 0128: the same digest to the admin-configured operator addresses, once,
    // now that the subscribers' send is queued. Best effort — never undoes it.
    const operators = await sendOperatorCopies(supabase, { subject: ed.email_subject, preview: ed.email_preview ?? "", html });
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.email_sent", entityType: "grovnews_edition", entityId: id,
      after: { campaign: ed.campaign_id, recipients, operators },
    });
    revalidateAll();
    return { ok: true, recipients };
  } catch (e) {
    return failed(e);
  }
}

/* ── automation ────────────────────────────────────────────────────────────── */

export async function saveSettingsAction(raw: unknown): Promise<{ ok: true } | Fail<"hours" | "operators" | "model">> {
  try {
    const { supabase, adminId } = await requireAdmin();
    // The model must be one the platform's stack really calls (0128).
    const parsed = validateSettingsInput(raw, GROVNEWS_MODEL_OPTIONS);
    if (!parsed.ok) return { ok: false, error: parsed.error ?? "invalid" };
    const v = parsed.value;
    const { data: before } = await supabase.from("grovnews_settings")
      .select("mode, daily_enabled, email_enabled, ai_provider, ai_model, publish_hour, send_hour").eq("id", true).maybeSingle();
    const { error } = await supabase.from("grovnews_settings").update({
      mode: v.mode, daily_enabled: v.dailyEnabled, run_hour: v.runHour, min_relevance: v.minRelevance,
      min_importance: v.minImportance, max_topics: v.maxTopics, auto_publish_official_sensitive: v.autoPublishOfficialSensitive,
      min_topics: v.minTopics, lookback_hours: v.lookbackHours, email_enabled: v.emailEnabled,
      ai_provider: v.aiProvider, ai_model: v.aiModel, publish_hour: v.publishHour, send_hour: v.sendHour,
      operator_emails: v.operatorEmails,
      updated_by: adminId,
    }).eq("id", true);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "grovnews.settings_saved", entityType: "grovnews_settings",
      before: before ? {
        mode: before.mode, daily_enabled: before.daily_enabled, email_enabled: before.email_enabled,
        ai_provider: before.ai_provider, ai_model: before.ai_model, publish_hour: before.publish_hour, send_hour: before.send_hour,
      } : undefined,
      // Operator addresses are recorded as a count, not as a list of addresses.
      after: { ...v, operatorEmails: v.operatorEmails.length },
    });
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/** Today's run, now — the same code the schedule runs. */
export async function runDailyNowAction():
  Promise<{ ok: true; status: string; reason: string | null; stage: string | null } | Fail<"noServerKey"> & { code?: string }> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!store.serverTokenAvailable()) return NO_SERVER_KEY;
    try {
      const r = await runDaily(supabase, "ADMIN", 240_000);
      await logAudit(supabase, {
        actorId: adminId, action: "grovnews.run_now", entityType: "grovnews_run",
        after: { status: r.status, reason: r.reason ?? null, stage: r.stage ?? null },
      });
      revalidateAll();
      return { ok: true, status: r.status, reason: r.reason ?? null, stage: r.stage ?? null };
    } catch (e) {
      revalidateAll();
      return { ok: false, error: "generic", code: errorCode(e) };
    }
  } catch (e) {
    return failed(e);
  }
}
