import type { Client } from "./workspace";
import { isTicketTopic, type TicketTopic } from "@/lib/contact-page";
import {
  FAQ_LIMITS, FAQ_SLUG, FAQ_SLUG_MAX, cleanFaqText, faqCharsOk, faqSlugify, isFaqPage, isFaqTool,
  type FaqCategoryRow, type FaqItemRow, type FaqPage, type FaqText,
} from "@/lib/faq";

/**
 * FAQ V1 — WHAT THE ADMIN DOES TO THE BASE. Transport-agnostic, as every
 * service here: it takes the caller's own client, so RLS (admin only, 0155)
 * is the lock and this file is the validation in front of it. The table's
 * CHECKs and triggers say the same again — the vote counts and the import
 * key cannot be written from here at all.
 *
 * Every write is compare-and-set where it edits (updated_at, which only an
 * edit moves — not a vote, not a move), and every write is history through
 * the table's own trigger (content_versions, target 'faq').
 */

export type FaqAdminData = { categories: FaqCategoryRow[]; items: FaqItemRow[] };

export type FaqResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: FaqError; field?: string };

export type FaqError =
  | "invalid" | "conflict" | "not_found" | "slug_taken" | "category" | "category_not_empty"
  | "stale" | "category_missing" | "not_restorable" | "generic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_COLUMNS = "id, slug, category_id, question, answer, position, visible, pages, tools, only_premiere, needs_review, review_note, draft_answer, helpful_count, unhelpful_count, import_key, created_at, updated_at";
const CATEGORY_COLUMNS = "id, slug, name, position, visible, contact_topic, updated_at";

const asText = (v: unknown): FaqText => (v && typeof v === "object" && !Array.isArray(v) ? v as FaqText : {});

function toItem(r: Record<string, unknown>): FaqItemRow {
  return {
    id: String(r.id), slug: String(r.slug), category_id: String(r.category_id),
    question: asText(r.question), answer: asText(r.answer),
    position: Number(r.position) || 0, visible: r.visible === true,
    pages: (Array.isArray(r.pages) ? r.pages : []).filter(isFaqPage),
    tools: (Array.isArray(r.tools) ? r.tools : []).filter(isFaqTool),
    only_premiere: r.only_premiere === true, needs_review: r.needs_review === true,
    review_note: typeof r.review_note === "string" ? r.review_note : null,
    draft_answer: r.draft_answer && typeof r.draft_answer === "object" ? asText(r.draft_answer) : null,
    helpful_count: Number(r.helpful_count) || 0, unhelpful_count: Number(r.unhelpful_count) || 0,
    import_key: typeof r.import_key === "string" ? r.import_key : null,
    created_at: String(r.created_at), updated_at: String(r.updated_at),
  };
}

function toCategory(r: Record<string, unknown>): FaqCategoryRow {
  return {
    id: String(r.id), slug: String(r.slug), name: asText(r.name),
    position: Number(r.position) || 0, visible: r.visible === true,
    contact_topic: isTicketTopic(r.contact_topic) ? r.contact_topic : "other",
    updated_at: String(r.updated_at),
  };
}

/** A database refusal, in the editor's words. */
function dbError(error: { code?: string; message?: string } | null): FaqError {
  if (!error) return "generic";
  if (error.code === "23505") return "slug_taken";
  if (error.code === "23503") return "category_not_empty";
  if (error.code === "23514" || error.code === "22P02") return "invalid";
  const m = error.message ?? "";
  for (const e of ["stale", "slug_taken", "category_missing", "not_restorable", "not_found"] as const) if (m.includes(e)) return e;
  return "generic";
}

export async function listFaqAdmin(supabase: Client): Promise<FaqAdminData> {
  const [cats, items] = await Promise.all([
    supabase.from("faq_categories").select(CATEGORY_COLUMNS).order("position").order("slug"),
    supabase.from("faq_items").select(ITEM_COLUMNS).order("position").order("slug"),
  ]);
  if (cats.error || items.error) throw new Error("faq_unavailable");
  return {
    categories: (cats.data ?? []).map((r) => toCategory(r as Record<string, unknown>)),
    items: (items.data ?? []).map((r) => toItem(r as Record<string, unknown>)),
  };
}

/* ── items ──────────────────────────────────────────────────────────────── */

export type FaqItemInput = {
  id?: string | null;
  /** updated_at the editor started from (compare-and-set); absent for a new item. */
  base?: string | null;
  slug?: string;
  category_id: string;
  question: unknown;
  answer: unknown;
  draft_answer?: unknown;
  pages: unknown;
  /** Public tool keys; absent from an older editor = none. */
  tools?: unknown;
  visible: boolean;
  needs_review: boolean;
  only_premiere: boolean;
  review_note?: string | null;
};

type ItemWrite = {
  slug: string; category_id: string; question: FaqText; answer: FaqText; draft_answer: FaqText | null;
  pages: FaqPage[]; tools: string[]; visible: boolean; needs_review: boolean; only_premiere: boolean; review_note: string | null;
};

/** The input, cleaned and checked — or the field that is wrong. */
export function validateFaqItem(input: FaqItemInput): { ok: true; value: ItemWrite } | { ok: false; field: string } {
  const question = cleanFaqText(input.question, FAQ_LIMITS.question);
  if (question.problem || !question.value.pl) return { ok: false, field: "question" };
  const answer = cleanFaqText(input.answer, FAQ_LIMITS.answer);
  if (answer.problem) return { ok: false, field: "answer" };
  const draft = input.draft_answer == null ? null : cleanFaqText(input.draft_answer, FAQ_LIMITS.answer);
  if (draft?.problem) return { ok: false, field: "draft" };
  const slug = (input.slug?.trim() || faqSlugify(question.value.pl)).toLowerCase();
  if (!FAQ_SLUG.test(slug) || slug.length > FAQ_SLUG_MAX.item) return { ok: false, field: "slug" };
  if (!UUID.test(input.category_id)) return { ok: false, field: "category" };
  const pagesIn = Array.isArray(input.pages) ? input.pages : [];
  const pages = [...new Set(pagesIn)].filter(isFaqPage);
  if (pages.length !== pagesIn.length) return { ok: false, field: "pages" };
  const toolsIn = Array.isArray(input.tools) ? input.tools : [];
  const tools = [...new Set(toolsIn)].filter(isFaqTool);
  if (tools.length !== toolsIn.length) return { ok: false, field: "tools" };
  const note = (input.review_note ?? "").trim();
  if (note.length > FAQ_LIMITS.note || !faqCharsOk(note)) return { ok: false, field: "note" };
  return {
    ok: true,
    value: {
      slug, category_id: input.category_id, question: question.value, answer: answer.value,
      draft_answer: draft && Object.keys(draft.value).length > 0 ? draft.value : null,
      pages, tools, visible: input.visible === true, needs_review: input.needs_review === true,
      only_premiere: input.only_premiere === true, review_note: note || null,
    },
  };
}

export async function saveFaqItem(supabase: Client, input: FaqItemInput): Promise<FaqResult<FaqItemRow>> {
  const checked = validateFaqItem(input);
  if (!checked.ok) return { ok: false, error: "invalid", field: checked.field };
  const v = checked.value;

  if (!input.id) {
    const { data: last } = await supabase.from("faq_items").select("position")
      .eq("category_id", v.category_id).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from("faq_items")
      .insert({ ...v, position: (last?.position ?? 0) + 10 }).select(ITEM_COLUMNS).single();
    if (error || !data) return { ok: false, error: error?.code === "23503" ? "category" : dbError(error) };
    return { ok: true, data: toItem(data as Record<string, unknown>) };
  }

  if (!UUID.test(input.id)) return { ok: false, error: "invalid", field: "id" };
  const { data: current } = await supabase.from("faq_items").select("category_id, position").eq("id", input.id).maybeSingle();
  if (!current) return { ok: false, error: "not_found" };
  // Moved to another category: it goes to the end of that list.
  let position = current.position;
  if (current.category_id !== v.category_id) {
    const { data: last } = await supabase.from("faq_items").select("position")
      .eq("category_id", v.category_id).order("position", { ascending: false }).limit(1).maybeSingle();
    position = (last?.position ?? 0) + 10;
  }
  let q = supabase.from("faq_items").update({ ...v, position }).eq("id", input.id);
  if (input.base) q = q.eq("updated_at", input.base);
  const { data, error } = await q.select(ITEM_COLUMNS).maybeSingle();
  if (error) return { ok: false, error: error.code === "23503" ? "category" : dbError(error) };
  if (!data) return { ok: false, error: "conflict" };
  return { ok: true, data: toItem(data as Record<string, unknown>) };
}

export async function deleteFaqItem(supabase: Client, id: string): Promise<FaqResult<FaqItemRow>> {
  if (!UUID.test(id)) return { ok: false, error: "invalid" };
  const { data, error } = await supabase.from("faq_items").delete().eq("id", id).select(ITEM_COLUMNS).maybeSingle();
  if (error) return { ok: false, error: dbError(error) };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, data: toItem(data as Record<string, unknown>) };
}

/* ── categories ─────────────────────────────────────────────────────────── */

export type FaqCategoryInput = {
  id?: string | null;
  base?: string | null;
  slug?: string;
  name: unknown;
  visible: boolean;
  contact_topic: string;
};

export function validateFaqCategory(input: FaqCategoryInput):
  { ok: true; value: { slug: string; name: FaqText; visible: boolean; contact_topic: TicketTopic } } | { ok: false; field: string } {
  const name = cleanFaqText(input.name, FAQ_LIMITS.category);
  if (name.problem || !name.value.pl || /[[\]]/.test(name.value.pl)) return { ok: false, field: "name" };
  const slug = (input.slug?.trim() || faqSlugify(name.value.pl, FAQ_SLUG_MAX.category)).toLowerCase();
  if (!FAQ_SLUG.test(slug) || slug.length > FAQ_SLUG_MAX.category) return { ok: false, field: "slug" };
  if (!isTicketTopic(input.contact_topic)) return { ok: false, field: "topic" };
  return { ok: true, value: { slug, name: name.value, visible: input.visible === true, contact_topic: input.contact_topic } };
}

export async function saveFaqCategory(supabase: Client, input: FaqCategoryInput): Promise<FaqResult<FaqCategoryRow>> {
  const checked = validateFaqCategory(input);
  if (!checked.ok) return { ok: false, error: "invalid", field: checked.field };
  if (!input.id) {
    const { data: last } = await supabase.from("faq_categories").select("position")
      .order("position", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from("faq_categories")
      .insert({ ...checked.value, position: (last?.position ?? 0) + 10 }).select(CATEGORY_COLUMNS).single();
    if (error || !data) return { ok: false, error: dbError(error) };
    return { ok: true, data: toCategory(data as Record<string, unknown>) };
  }
  if (!UUID.test(input.id)) return { ok: false, error: "invalid", field: "id" };
  let q = supabase.from("faq_categories").update(checked.value).eq("id", input.id);
  if (input.base) q = q.eq("updated_at", input.base);
  const { data, error } = await q.select(CATEGORY_COLUMNS).maybeSingle();
  if (error) return { ok: false, error: dbError(error) };
  if (!data) {
    const { data: exists } = await supabase.from("faq_categories").select("id").eq("id", input.id).maybeSingle();
    return { ok: false, error: exists ? "conflict" : "not_found" };
  }
  return { ok: true, data: toCategory(data as Record<string, unknown>) };
}

export async function deleteFaqCategory(supabase: Client, id: string): Promise<FaqResult<FaqCategoryRow>> {
  if (!UUID.test(id)) return { ok: false, error: "invalid" };
  const { data, error } = await supabase.from("faq_categories").delete().eq("id", id).select(CATEGORY_COLUMNS).maybeSingle();
  if (error) return { ok: false, error: dbError(error) };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, data: toCategory(data as Record<string, unknown>) };
}

/* ── order ──────────────────────────────────────────────────────────────── */

/** A whole list in its new order (faq_reorder: exactly that set, or stale). */
export async function reorderFaq(supabase: Client, kind: "categories" | "items", ids: string[], categoryId?: string): Promise<FaqResult> {
  if (!ids.length || ids.some((id) => !UUID.test(id)) || (kind === "items" && !UUID.test(categoryId ?? ""))) {
    return { ok: false, error: "invalid" };
  }
  const { error } = await supabase.rpc("faq_reorder", {
    p_kind: kind, p_ids: ids, ...(kind === "items" ? { p_category: categoryId } : {}),
  });
  if (error) return { ok: false, error: dbError(error) };
  return { ok: true, data: undefined };
}

/* ── history ────────────────────────────────────────────────────────────── */

export type FaqVersion = {
  id: string;
  key: string;
  action: string;
  created_at: string;
  author: string | null;
  /** The row this version would bring back (after; for a delete, before). */
  state: Record<string, unknown> | null;
  /** The row as it was before (to show what changed). */
  before: Record<string, unknown> | null;
};

const asRow = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

async function withAuthors(supabase: Client, rows: { id: string; key: string; action: string; created_at: string; created_by: string | null; before: unknown; after: unknown }[]): Promise<FaqVersion[]> {
  const ids = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => Boolean(x)))];
  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of data ?? []) names[p.id] = p.full_name || p.email;
  }
  return rows.map((r) => ({
    id: r.id, key: r.key, action: r.action, created_at: r.created_at,
    author: r.created_by ? names[r.created_by] ?? null : null,
    state: asRow(r.after) ?? asRow(r.before), before: asRow(r.before),
  }));
}

/** The history of one item or category, newest first. */
export async function faqHistory(supabase: Client, kind: "item" | "category", id: string): Promise<FaqVersion[]> {
  if (!UUID.test(id)) return [];
  const { data } = await supabase.from("content_versions")
    .select("id, key, action, created_at, created_by, before, after")
    .eq("target", "faq").eq("key", `faq:${kind}:${id}`)
    .order("created_at", { ascending: false }).limit(30);
  return withAuthors(supabase, (data ?? []) as never);
}

/** Deleted items and categories that are not back yet — "Kosz". */
export async function faqDeleted(supabase: Client, present: { items: string[]; categories: string[] }): Promise<FaqVersion[]> {
  const { data } = await supabase.from("content_versions")
    .select("id, key, action, created_at, created_by, before, after")
    .eq("target", "faq").eq("action", "clear")
    .order("created_at", { ascending: false }).limit(50);
  const alive = new Set([...present.items.map((id) => `faq:item:${id}`), ...present.categories.map((id) => `faq:category:${id}`)]);
  const seen = new Set<string>();
  const rows = ((data ?? []) as { key: string }[]).filter((r) => {
    if (alive.has(r.key) || seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
  return withAuthors(supabase, rows as never);
}

export async function restoreFaqVersion(supabase: Client, versionId: string): Promise<FaqResult<{ kind: string; id: string }>> {
  if (!UUID.test(versionId)) return { ok: false, error: "invalid" };
  const { data, error } = await supabase.rpc("faq_restore", { p_version: versionId });
  if (error) return { ok: false, error: dbError(error) };
  const r = asRow(data);
  return { ok: true, data: { kind: String(r?.kind ?? ""), id: String(r?.id ?? "") } };
}
