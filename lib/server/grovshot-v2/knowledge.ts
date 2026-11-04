import "server-only";
import { createHash } from "node:crypto";
import type { Client } from "@/lib/services/workspace";
import { dispatchToken } from "@/lib/server/server-token";
import {
  KNOWLEDGE_DELIVERIES, KNOWLEDGE_SCOPES, KNOWLEDGE_TOPICS, RULE_BODY_MAX, RULE_TITLE_MAX, SOURCE_TEXT_MAX,
  cleanRuleText, normalizedBody, parseKnowledgeText, parseSnapshot, reviewHint, slug,
  type ExistingRule, type KnowledgeDelivery, type KnowledgeScope, type KnowledgeSnapshot, type KnowledgeTopic, type RuleStatus, type SourceFormat,
} from "@/lib/grovshot-v2/knowledge";
import { STAGE_ROLES, type StageRole } from "@/lib/grovshot-v2/config";

/**
 * GROVBASE SHOT V2 — THE KNOWLEDGE BASE ON THE SERVER.
 *
 *   · importGrovshotSource — „Dodaj wiedzę do GrovShot”: the original to the
 *     private `knowledge` bucket, its sha256 and metadata, the full text, and
 *     the parser's rule PROPOSALS (pending) — duplicates of live rules are not
 *     inserted again, a changed rule becomes a new revision that supersedes
 *     the old one, a possible contradiction is flagged. Nothing is approved or
 *     published here, and no prompt changes until an admin publishes;
 *   · readKnowledgeSnapshot — what an order seals at its start (server token);
 *   · readKnowledgeAdmin — the admin view (admin session, RLS admin-only).
 */

export const TEST_CASE_SET_NAME = "GrovShot V2 — przypadki testowe";
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export async function readKnowledgeSnapshot(supabase: Client, opts: { preview?: boolean } = {}): Promise<KnowledgeSnapshot | null | "unreadable"> {
  const { data, error } = await supabase.rpc("grovshot_knowledge_snapshot", { p_token: dispatchToken() ?? "", p_preview: opts.preview === true });
  if (error) return "unreadable";
  if (data === null) return null;
  return parseSnapshot(data) ?? "unreadable";
}

/** The set GrovShot V2's test cases live in (created on first use). */
export async function testCaseSet(supabase: Client, adminId: string): Promise<string | null> {
  const { data } = await supabase.from("knowledge_sets").select("id").eq("name", TEST_CASE_SET_NAME).eq("scope", "grovshot_v2").limit(1);
  if (data?.[0]) return data[0].id;
  const { data: made } = await supabase.from("knowledge_sets").insert({
    name: TEST_CASE_SET_NAME, status: "ready", scope: "grovshot_v2", created_by: adminId,
    notes: "Przypadki testowe GrovShot V2 (ocena, co zadziałało, poprawka). Nie są przypisane do V1.",
  } as never).select("id").single();
  return (made as { id: string } | null)?.id ?? null;
}

export type ImportInput = {
  setId: string | null;
  newSetName: string | null;
  fileName: string;
  bytes: Buffer;
  title: string | null;
  role: "primary" | "confirmation";
  sourceDate: string | null;
  author: string | null;
};

export type ImportResult =
  | { ok: true; setId: string; sourceId: string; version: number; format: SourceFormat; found: number; inserted: number; duplicates: number; revisions: number; conflicts: number; warnings: string[] }
  | { ok: false; error: string; sourceId?: string };

function formatOf(name: string): SourceFormat | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "md" || ext === "markdown" ? "md" : ext === "txt" ? "txt" : ext === "pdf" ? "pdf" : null;
}

const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export async function importGrovshotSource(supabase: Client, adminId: string, input: ImportInput): Promise<ImportResult> {
  const format = formatOf(input.fileName);
  if (!format) return { ok: false, error: "unsupported_format" };
  if (input.bytes.length === 0) return { ok: false, error: "empty_file" };
  if (input.bytes.length > (format === "pdf" ? MAX_PDF_BYTES : MAX_TEXT_BYTES)) return { ok: false, error: "file_too_large" };
  const warnings: string[] = [];

  // The text, whole — a document is never cut, and never decoded into mojibake.
  let text: string;
  if (format === "pdf") {
    try {
      const { readPdf } = await import("@/lib/server/knowledge-pdf");
      const parsed = await Promise.race([
        readPdf(input.bytes),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pdf_timeout")), 120_000)),
      ]);
      if (parsed.pages.some((p) => p.text.length >= 8000)) warnings.push("pdf_page_long");
      text = parsed.pages.map((p) => `=== ${p.page} ===\n${p.text}`).join("\n\n");
    } catch { return { ok: false, error: "pdf_unreadable" }; }
  } else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes).replace(/^﻿/, ""); }
    catch { return { ok: false, error: "text_not_utf8" }; }
  }
  if (!text.trim()) return { ok: false, error: "empty_file" };
  if (Array.from(text).length > SOURCE_TEXT_MAX) return { ok: false, error: "text_too_long" };
  const digest = sha(input.bytes);

  const { data: same } = await supabase.from("knowledge_sources").select("id").eq("sha256", digest).limit(1);
  if (same?.[0]) return { ok: false, error: "already_imported", sourceId: same[0].id };

  // The set: an existing one (it becomes V2's), or a new V2 set.
  let setId = input.setId;
  if (setId) {
    const { data: set } = await supabase.from("knowledge_sets").select("id, scope").eq("id", setId).maybeSingle();
    if (!set) return { ok: false, error: "set_missing" };
    if (!(set as { scope: string | null }).scope) await supabase.from("knowledge_sets").update({ scope: "grovshot_v2" } as never).eq("id", setId);
  } else {
    const name = (input.newSetName || input.title || input.fileName.replace(/\.[^.]+$/, "")).trim().slice(0, 160) || "Wiedza GrovShot";
    const { data: made, error } = await supabase.from("knowledge_sets").insert({
      name, status: "ready", scope: "grovshot_v2", created_by: adminId,
    } as never).select("id").single();
    if (error || !made) return { ok: false, error: "generic" };
    setId = (made as { id: string }).id;
  }

  const parsedDoc = input.role === "primary" ? parseKnowledgeText(text, { docKey: input.title || input.fileName, format, defaultDate: isoDate(input.sourceDate) }) : null;
  const title = (input.title || parsedDoc?.title || input.fileName.replace(/\.[^.]+$/, "")).trim().slice(0, 200) || "Dokument";
  const docKey = slug(input.title || parsedDoc?.title || input.fileName.replace(/\.[^.]+$/, ""), 40);
  const { data: prev } = await supabase.from("knowledge_sources").select("version, format").eq("set_id", setId).eq("doc_key", docKey)
    .order("version", { ascending: false }).limit(20);
  const latest = (prev ?? [])[0]?.version ?? 0;
  // A confirmation (the same document in another format) joins the latest version.
  const version = input.role === "confirmation" ? Math.max(1, latest) : latest + 1;
  if ((prev ?? []).some((p) => p.version === version && p.format === format)) return { ok: false, error: "version_exists" };

  const ext = format === "md" ? "md" : format === "txt" ? "txt" : "pdf";
  const path = `sets/${setId}/sources/${digest.slice(0, 32)}.${ext}`;
  const { error: upErr } = await supabase.storage.from("knowledge").upload(path, input.bytes, {
    contentType: format === "pdf" ? "application/pdf" : "text/plain", upsert: true,
  });
  if (upErr) return { ok: false, error: "storage_failed" };

  const { data: src, error: srcErr } = await supabase.from("knowledge_sources").insert({
    set_id: setId, doc_key: docKey, version, title, format, role: input.role, storage_path: path,
    content: text, content_chars: Array.from(text).length, sha256: digest, bytes: input.bytes.length,
    source_date: isoDate(input.sourceDate) ?? parsedDoc?.date ?? null, author: (input.author || parsedDoc?.author || "").slice(0, 120) || null,
    status: input.role === "primary" ? "parsed" : "skipped",
    parse_note: input.role === "primary" ? (warnings.concat(parsedDoc?.warnings ?? []).join(", ").slice(0, 500) || null) : "Potwierdzenie (ten sam dokument w innym formacie) — reguły pochodzą ze źródła głównego.",
    created_by: adminId,
  } as never).select("id").single();
  if (srcErr || !src) return { ok: false, error: "generic" };
  const sourceId = (src as { id: string }).id;
  if (!parsedDoc) {
    await supabase.rpc("log_activity", { p_workspace_id: null as unknown as string, p_action: "admin.knowledge_source_imported", p_entity_type: "knowledge_source", p_entity_id: sourceId, p_metadata: { format, role: input.role, version, rules: 0 } });
    return { ok: true, setId, sourceId, version, format, found: 0, inserted: 0, duplicates: 0, revisions: 0, conflicts: 0, warnings };
  }

  // Proposals against every rule there is (duplicates, revisions, conflicts).
  const { data: liveRows } = await supabase.from("knowledge_rules")
    .select("id, rule_key, revision, status, scope_kind, scope_values, topic, body, is_correction").eq("tool_key", "grovshot_v2").limit(5000);
  const existing = (liveRows ?? []) as unknown as ExistingRule[];
  const seen = new Set<string>();
  let duplicates = 0, revisions = 0, conflicts = 0;
  const rows: Record<string, unknown>[] = [];
  for (const d of parsedDoc.rules) {
    const norm = normalizedBody(d.body);
    if (seen.has(norm)) { duplicates++; continue; }
    seen.add(norm);
    const hint = reviewHint(d, existing);
    if (hint.kind === "duplicate") { duplicates++; continue; }
    if (hint.kind === "revision") revisions++;
    if (hint.kind === "conflict") conflicts++;
    rows.push({
      rule_key: d.rule_key, revision: hint.kind === "revision" ? hint.revision : 1, source_id: sourceId, origin: "document",
      section: d.section, page: d.page, position: d.position, source_date: d.source_date, topic: d.topic, stages: d.stages,
      scope_kind: d.scope_kind, scope_values: d.scope_kind === "global" ? [] : d.scope_values,
      delivery: d.delivery === "knowledge" && d.stages.length === 0 ? "reference" : d.delivery,
      is_correction: d.is_correction, title: d.title, body: d.body, body_sha256: sha(d.body),
      supersedes: hint.kind === "revision" ? [hint.of] : [], conflicts_with: hint.kind === "conflict" ? hint.with : [],
      status: "pending", created_by: adminId,
    });
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const { data, error } = await supabase.from("knowledge_rules").insert(rows.slice(i, i + 100) as never).select("id");
    if (error) { warnings.push("rules_insert_failed"); break; }
    inserted += data?.length ?? 0;
  }
  await supabase.from("knowledge_sources").update({ rules_found: inserted } as never).eq("id", sourceId);
  await supabase.rpc("log_activity", {
    p_workspace_id: null as unknown as string, p_action: "admin.knowledge_source_imported", p_entity_type: "knowledge_source", p_entity_id: sourceId,
    p_metadata: { format, role: input.role, version, found: parsedDoc.rules.length, inserted, duplicates, revisions, conflicts },
  });
  return { ok: true, setId, sourceId, version, format, found: parsedDoc.rules.length, inserted, duplicates, revisions, conflicts, warnings: warnings.concat(parsedDoc.warnings) };
}

/* ── rule editing (pending only; an approved rule is revised instead) ─────*/

export type RulePatch = {
  title?: string; body?: string; topic?: string; stages?: string[]; scope_kind?: string; scope_values?: string[];
  delivery?: string; is_correction?: boolean;
};

/** A patch checked against the closed sets (null = invalid). */
export function cleanPatch(p: RulePatch): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (p.title !== undefined) { const t = cleanRuleText(p.title).slice(0, RULE_TITLE_MAX); if (!t) return null; out.title = t; }
  if (p.body !== undefined) {
    const b = cleanRuleText(p.body);
    if (!b || b.length > RULE_BODY_MAX) return null;
    out.body = b; out.body_sha256 = sha(b);
  }
  if (p.topic !== undefined) { if (!(KNOWLEDGE_TOPICS as readonly string[]).includes(p.topic)) return null; out.topic = p.topic as KnowledgeTopic; }
  if (p.stages !== undefined) {
    if (!Array.isArray(p.stages) || !p.stages.every((s) => (STAGE_ROLES as readonly string[]).includes(s))) return null;
    out.stages = [...new Set(p.stages)] as StageRole[];
  }
  if (p.scope_kind !== undefined) { if (!(KNOWLEDGE_SCOPES as readonly string[]).includes(p.scope_kind)) return null; out.scope_kind = p.scope_kind as KnowledgeScope; }
  if (p.scope_values !== undefined) {
    if (!Array.isArray(p.scope_values)) return null;
    out.scope_values = [...new Set(p.scope_values.map((v) => String(v).trim().toLowerCase().slice(0, 60)).filter((v) => v.length >= 2))].slice(0, 30);
  }
  if (p.delivery !== undefined) { if (!(KNOWLEDGE_DELIVERIES as readonly string[]).includes(p.delivery)) return null; out.delivery = p.delivery as KnowledgeDelivery; }
  if (p.is_correction !== undefined) out.is_correction = p.is_correction === true;
  if (out.scope_kind === "global") out.scope_values = [];
  return out;
}

/* ── the admin view ───────────────────────────────────────────────────────*/

export type RuleView = {
  id: string; ruleKey: string; revision: number; sourceId: string | null; exampleId: string | null; origin: string;
  section: string | null; page: number | null; position: number; date: string | null; topic: KnowledgeTopic; stages: StageRole[];
  scopeKind: KnowledgeScope; scopeValues: string[]; delivery: KnowledgeDelivery; isCorrection: boolean;
  title: string; body: string; status: RuleStatus; supersedes: string[]; conflictsWith: string[]; reviewNote: string | null;
  createdAt: string; reviewedAt: string | null; inActive: boolean;
};
export type SourceView = {
  id: string; setId: string; setName: string; docKey: string; version: number; title: string; format: SourceFormat; role: "primary" | "confirmation";
  date: string | null; author: string | null; createdAt: string; createdBy: string | null; sha256: string | null; chars: number; bytes: number | null;
  status: string; note: string | null; hasFile: boolean;
  counts: Record<RuleStatus | "total" | "delivered" | "inActive", number>;
  stages: StageRole[]; scopes: string[];
};
export type VersionView = { id: string; version: number; active: boolean; ruleCount: number; deliveredCount: number; exampleCount: number; changelog: string | null; createdAt: string; activatedAt: string | null; createdBy: string | null };
export type TestCaseView = {
  id: string; category: string | null; description: string | null; prompt: string | null; rating: number | null; worked: string | null; failed: string | null;
  correction: string | null; scope: Record<string, unknown> | null; status: string; createdAt: string; author: string | null;
  refUrl: string | null; genUrl: string | null; rules: number;
};
export type KnowledgeAdmin = {
  sources: SourceView[]; rules: RuleView[]; versions: VersionView[]; testCases: TestCaseView[];
  sets: { id: string; name: string; scope: string | null }[];
  active: VersionView | null;
  /** Approved rules that the active version does not carry yet (or carries
   *  rules no longer approved): a publish is due. */
  unpublishedChanges: number;
};

type RuleRow = {
  id: string; rule_key: string; revision: number; source_id: string | null; example_id: string | null; origin: string; section: string | null;
  page: number | null; position: number; source_date: string | null; topic: KnowledgeTopic; stages: StageRole[]; scope_kind: KnowledgeScope;
  scope_values: string[]; delivery: KnowledgeDelivery; is_correction: boolean; title: string; body: string; status: RuleStatus;
  supersedes: string[]; conflicts_with: string[]; review_note: string | null; created_at: string; reviewed_at: string | null;
};

export async function readKnowledgeAdmin(supabase: Client): Promise<KnowledgeAdmin> {
  const [{ data: srcRows }, { data: ruleRows }, { data: verRows }, { data: setRows }] = await Promise.all([
    supabase.from("knowledge_sources").select("id, set_id, doc_key, version, title, format, role, source_date, author, created_at, created_by, sha256, content_chars, bytes, status, parse_note, storage_path")
      .order("created_at", { ascending: false }).limit(200),
    supabase.from("knowledge_rules").select("id, rule_key, revision, source_id, example_id, origin, section, page, position, source_date, topic, stages, scope_kind, scope_values, delivery, is_correction, title, body, status, supersedes, conflicts_with, review_note, created_at, reviewed_at")
      .eq("tool_key", "grovshot_v2").order("position").order("created_at").limit(2000),
    supabase.from("knowledge_versions").select("id, version, active, rule_ids, example_ids, rule_count, delivered_count, changelog, created_at, activated_at, created_by")
      .eq("tool_key", "grovshot_v2").order("version", { ascending: false }).limit(50),
    supabase.from("knowledge_sets").select("id, name, scope").order("created_at", { ascending: false }).limit(200),
  ]);
  const sets = (setRows ?? []) as { id: string; name: string; scope: string | null }[];
  const setName = new Map(sets.map((s) => [s.id, s.name]));
  const versionsRaw = (verRows ?? []) as unknown as { id: string; version: number; active: boolean; rule_ids: string[]; example_ids: string[]; rule_count: number; delivered_count: number; changelog: string | null; created_at: string; activated_at: string | null; created_by: string | null }[];
  const activeRaw = versionsRaw.find((v) => v.active) ?? null;
  const activeIds = new Set(activeRaw?.rule_ids ?? []);
  const rules = (ruleRows ?? []) as unknown as RuleRow[];

  // Authors' names (sources, versions, test cases).
  const v2Sets = sets.filter((s) => s.scope === "grovshot_v2").map((s) => s.id);
  const { data: caseRows } = v2Sets.length
    ? await supabase.from("knowledge_examples").select("id, set_id, product_category, description, prompt_used, result_rating, what_worked, what_failed, correction, correction_scope, review_status, created_at, created_by, reference_path, generated_path, source_kind")
        .in("set_id", v2Sets).eq("source_kind", "manual").order("created_at", { ascending: false }).limit(200)
    : { data: [] as never[] };
  const cases = (caseRows ?? []) as unknown as { id: string; product_category: string | null; description: string | null; prompt_used: string | null; result_rating: number | null; what_worked: string | null; what_failed: string | null; correction: string | null; correction_scope: Record<string, unknown> | null; review_status: string; created_at: string; created_by: string | null; reference_path: string | null; generated_path: string | null }[];
  const authorIds = [...new Set([...(srcRows ?? []).map((s) => s.created_by), ...versionsRaw.map((v) => v.created_by), ...cases.map((c) => c.created_by)].filter(Boolean))] as string[];
  const { data: authors } = authorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", authorIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const nameOf = new Map((authors ?? []).map((a) => [a.id, a.full_name ?? a.email]));
  const paths = cases.flatMap((c) => [c.reference_path, c.generated_path]).filter((p): p is string => Boolean(p));
  const { data: signed } = paths.length ? await supabase.storage.from("knowledge").createSignedUrls(paths, 900) : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlOf = new Map((signed ?? []).map((u) => [u.path, u.signedUrl]));

  const ruleViews: RuleView[] = rules.map((r) => ({
    id: r.id, ruleKey: r.rule_key, revision: r.revision, sourceId: r.source_id, exampleId: r.example_id, origin: r.origin,
    section: r.section, page: r.page, position: r.position, date: r.source_date, topic: r.topic, stages: r.stages ?? [],
    scopeKind: r.scope_kind, scopeValues: r.scope_values ?? [], delivery: r.delivery, isCorrection: r.is_correction,
    title: r.title, body: r.body, status: r.status, supersedes: r.supersedes ?? [], conflictsWith: r.conflicts_with ?? [],
    reviewNote: r.review_note, createdAt: r.created_at, reviewedAt: r.reviewed_at, inActive: activeIds.has(r.id),
  }));
  const bySource = new Map<string, RuleView[]>();
  for (const r of ruleViews) if (r.sourceId) bySource.set(r.sourceId, [...(bySource.get(r.sourceId) ?? []), r]);
  const sources: SourceView[] = ((srcRows ?? []) as unknown as { id: string; set_id: string; doc_key: string; version: number; title: string; format: SourceFormat; role: "primary" | "confirmation"; source_date: string | null; author: string | null; created_at: string; created_by: string | null; sha256: string | null; content_chars: number; bytes: number | null; status: string; parse_note: string | null; storage_path: string | null }[])
    .map((s) => {
      const list = bySource.get(s.id) ?? [];
      const counts = { total: list.length, pending: 0, approved: 0, rejected: 0, superseded: 0, retired: 0, delivered: 0, inActive: 0 } as SourceView["counts"];
      for (const r of list) { counts[r.status]++; if (r.delivery === "knowledge") counts.delivered++; if (r.inActive) counts.inActive++; }
      return {
        id: s.id, setId: s.set_id, setName: setName.get(s.set_id) ?? "—", docKey: s.doc_key, version: s.version, title: s.title, format: s.format, role: s.role,
        date: s.source_date, author: s.author, createdAt: s.created_at, createdBy: s.created_by ? nameOf.get(s.created_by) ?? null : null,
        sha256: s.sha256, chars: s.content_chars, bytes: s.bytes, status: s.status, note: s.parse_note, hasFile: Boolean(s.storage_path),
        counts,
        stages: STAGE_ROLES.filter((st) => list.some((r) => r.delivery === "knowledge" && r.stages.includes(st))),
        scopes: [...new Set(list.filter((r) => r.scopeKind !== "global").map((r) => `${r.scopeKind}:${r.scopeValues[0] ?? ""}`))].slice(0, 12),
      };
    });
  const versions: VersionView[] = versionsRaw.map((v) => ({
    id: v.id, version: v.version, active: v.active, ruleCount: v.rule_count, deliveredCount: v.delivered_count, exampleCount: v.example_ids?.length ?? 0,
    changelog: v.changelog, createdAt: v.created_at, activatedAt: v.activated_at, createdBy: v.created_by ? nameOf.get(v.created_by) ?? null : null,
  }));
  const approved = new Set(ruleViews.filter((r) => r.status === "approved").map((r) => r.id));
  const unpublishedChanges = [...approved].filter((id) => !activeIds.has(id)).length + [...activeIds].filter((id) => !approved.has(id)).length;
  const rulesByCase = new Map<string, number>();
  for (const r of ruleViews) if (r.exampleId) rulesByCase.set(r.exampleId, (rulesByCase.get(r.exampleId) ?? 0) + 1);
  const testCases: TestCaseView[] = cases.map((c) => ({
    id: c.id, category: c.product_category, description: c.description, prompt: c.prompt_used, rating: c.result_rating,
    worked: c.what_worked, failed: c.what_failed, correction: c.correction, scope: c.correction_scope, status: c.review_status,
    createdAt: c.created_at, author: c.created_by ? nameOf.get(c.created_by) ?? null : null,
    refUrl: c.reference_path ? urlOf.get(c.reference_path) ?? null : null, genUrl: c.generated_path ? urlOf.get(c.generated_path) ?? null : null,
    rules: rulesByCase.get(c.id) ?? 0,
  }));
  return {
    sources, rules: ruleViews, versions, testCases, sets,
    active: versions.find((v) => v.active) ?? null, unpublishedChanges,
  };
}

/** One rule's history: the activity rows that name it (single or bulk) and
 *  the revisions of its key. */
export async function readRuleHistory(supabase: Client, ruleId: string) {
  const { data: rule } = await supabase.from("knowledge_rules").select("rule_key").eq("id", ruleId).maybeSingle();
  const [{ data: single }, { data: bulk }, { data: revs }] = await Promise.all([
    supabase.from("activity_logs").select("action, actor_id, metadata, created_at").eq("entity_id", ruleId).order("created_at", { ascending: false }).limit(50),
    supabase.from("activity_logs").select("action, actor_id, metadata, created_at").eq("action", "admin.knowledge_rules_reviewed").contains("metadata", { ids: [ruleId] }).order("created_at", { ascending: false }).limit(50),
    rule ? supabase.from("knowledge_rules").select("id, revision, status, created_at, reviewed_at").eq("rule_key", (rule as { rule_key: string }).rule_key).order("revision") : Promise.resolve({ data: [] }),
  ]);
  const rows = [...(single ?? []), ...(bulk ?? [])];
  const uniq = new Map(rows.map((r) => [`${r.created_at}:${r.action}`, r]));
  const actorIds = [...new Set([...uniq.values()].map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const nameOf = new Map((actors ?? []).map((a) => [a.id, a.full_name ?? a.email]));
  return {
    events: [...uniq.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return { action: r.action, at: r.created_at, actor: r.actor_id ? nameOf.get(r.actor_id) ?? null : null, status: typeof m.status === "string" ? m.status : null, note: typeof m.note === "string" ? m.note : null };
    }),
    revisions: ((revs ?? []) as { id: string; revision: number; status: string; created_at: string; reviewed_at: string | null }[]),
  };
}
