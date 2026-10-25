"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, History, Pencil, Plus, RotateCcw, ThumbsDown, ThumbsUp, Trash2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FaqRichText } from "@/components/faq/faq-rich";
import { TICKET_TOPICS, type TicketTopic } from "@/lib/contact-page";
import {
  FAQ_LOCALES, FAQ_PAGES, FAQ_TOOLS, faqHiddenReasons, faqNeedsContent, faqSlugify, parseFaqRich,
  type FaqCategoryRow, type FaqHiddenReason, type FaqItemRow, type FaqLocale, type FaqPage, type FaqText,
} from "@/lib/faq";
import { toolPageTextKeys } from "@/lib/public-tools";
import {
  deleteFaqCategoryAction, deleteFaqItemAction, faqEditorDataAction, faqHistoryAction, reorderFaqAction,
  restoreFaqVersionAction, saveFaqCategoryAction, saveFaqItemAction, type FaqEditorData,
} from "@/app/actions/faq";
import type { FaqVersion } from "@/lib/services/faq";

/**
 * THE FAQ EDITOR (FAQ V1) — one component, two doors: Strony WWW → FAQ, and
 * "Edytuj stronę" on /faq, /plany and /o-nas (the editor's "FAQ" panel). Not
 * a second CMS: it edits the one base those pages read, through the same
 * admin-only actions, and every change is history the same way the inline
 * editor's are (content_versions), restorable from here.
 *
 * What it shows for every question is exactly what decides whether a visitor
 * sees it: switched on or off, the pages it is on, and every reason it is not
 * public — "wymaga uzupełnienia" (an empty text or a [placeholder]), "wymaga
 * weryfikacji", a hidden category, only during the premiere — plus its
 * "Pomogło / Nie pomogło" counts, which only an admin ever sees.
 *
 * ORDER: drag a row (or a category) by its handle, or use the arrows — the
 * keyboard way to the same move. A move saves the whole list at once.
 */

type Busy = null | "load" | "save" | "order" | "restore";
type Editing = { kind: "item"; id: string | null; category: string } | { kind: "category"; id: string | null } | null;
type Filter = "all" | FaqPage | "hidden" | "needs";

const INPUT = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] text-ink focus:border-[rgb(var(--accent)/0.55)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent)/0.15)]";
const BTN = "inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[rgb(var(--accent-strong))] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-[rgb(var(--accent))] disabled:cursor-not-allowed disabled:opacity-60";
const ICON = "grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40";

export function FaqManager({ initial, page, onChanged }: {
  initial?: FaqEditorData | null;
  /** In "Edytuj stronę": the page being edited, to start filtered on it. */
  page?: FaqPage;
  /** Called after every successful write (the inline editor re-renders the page). */
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<FaqEditorData | null>(initial ?? null);
  const [busy, setBusy] = useState<Busy>(initial ? null : "load");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(page ?? "all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [history, setHistory] = useState<{ kind: "item" | "category"; id: string; title: string } | null>(null);

  const errorText = useCallback((code: string, field?: string) => {
    if (field) return t(`ice.faq.err.field.${field}`);
    return t(`ice.faq.err.${code}`);
  }, [t]);

  const reload = useCallback(async () => {
    const res = await faqEditorDataAction();
    if (res.ok) setData(res.data);
    else setError(errorText(res.error));
    setBusy(null);
  }, [errorText]);

  useEffect(() => {
    if (!initial) void reload();
  }, [initial, reload]);

  const after = useCallback(async () => {
    await reload();
    onChanged?.();
  }, [reload, onChanged]);

  const cats = useMemo(() => data?.categories ?? [], [data]);
  const items = useMemo(() => data?.items ?? [], [data]);
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const reasonsOf = useCallback((it: FaqItemRow) => faqHiddenReasons(it, catById.get(it.category_id), { premiere: data?.premiere }), [catById, data?.premiere]);

  const matchesFilter = (it: FaqItemRow) => {
    const q = query.trim().toLowerCase();
    if (q && !`${it.question.pl ?? ""} ${it.answer.pl ?? ""} ${it.slug}`.toLowerCase().includes(q)) return false;
    if (filter === "all") return true;
    if (filter === "hidden") return reasonsOf(it).length > 0;
    if (filter === "needs") return faqNeedsContent(it) || it.needs_review;
    return it.pages.includes(filter);
  };
  const publicCount = items.filter((it) => reasonsOf(it).length === 0).length;

  /* ── order ────────────────────────────────────────────────────────────── */

  const move = async (kind: "categories" | "items", ids: string[], categoryId?: string) => {
    if (!data) return;
    const before = data;
    // Optimistic: the new order on screen at once, put back if refused.
    setData(kind === "categories"
      ? { ...data, categories: ids.map((id, i) => ({ ...catById.get(id)!, position: (i + 1) * 10 })) }
      : { ...data, items: data.items.map((it) => (it.category_id === categoryId ? { ...it, position: (ids.indexOf(it.id) + 1) * 10 } : it)) });
    setBusy("order");
    const res = await reorderFaqAction(kind, ids, categoryId);
    if (!res.ok) {
      setData(before);
      setError(errorText(res.error));
      setBusy(null);
      return;
    }
    setError(null);
    await after();
  };

  const drag = useRef<{ kind: "categories" | "items"; id: string; category?: string } | null>(null);
  const dropOn = (kind: "categories" | "items", targetId: string, list: string[], category?: string) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind !== kind || d.id === targetId || d.category !== category) return;
    const from = list.indexOf(d.id);
    const to = list.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...list];
    next.splice(to, 0, ...next.splice(from, 1));
    void move(kind, next, category);
  };
  const shift = (kind: "categories" | "items", list: string[], id: string, by: -1 | 1, category?: string) => {
    const i = list.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    void move(kind, next, category);
  };

  /* ── quick switches and deletes ───────────────────────────────────────── */

  const setItemVisible = async (it: FaqItemRow, visible: boolean) => {
    setBusy("save");
    const res = await saveFaqItemAction({ ...it, base: it.updated_at, visible });
    if (!res.ok) setError(errorText(res.error, res.field));
    else setError(null);
    await after();
  };
  const setCategoryVisible = async (c: FaqCategoryRow, visible: boolean) => {
    setBusy("save");
    const res = await saveFaqCategoryAction({ ...c, base: c.updated_at, visible });
    if (!res.ok) setError(errorText(res.error, res.field));
    else setError(null);
    await after();
  };
  const removeCategory = async (c: FaqCategoryRow) => {
    if (!window.confirm(t("ice.faq.confirmDeleteCategory", { name: c.name.pl ?? c.slug }))) return;
    setBusy("save");
    const res = await deleteFaqCategoryAction(c.id);
    if (!res.ok) setError(errorText(res.error));
    else setError(null);
    await after();
  };
  const restore = async (versionId: string) => {
    setBusy("restore");
    const res = await restoreFaqVersionAction(versionId);
    if (!res.ok) setError(errorText(res.error));
    else { setError(null); setHistory(null); }
    await after();
  };

  if (!data) {
    return <p className="p-4 text-[13px] text-muted" role="status">{busy === "load" ? t("ice.faq.loading") : error}</p>;
  }

  const sortedCats = [...cats].sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug));
  const catIds = sortedCats.map((c) => c.id);

  return (
    <div className="space-y-4" data-faq-manager aria-busy={busy !== null}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13px] text-muted" data-faq-counts>
          {t("ice.faq.counts", { n: items.length, shown: publicCount, hidden: items.length - publicCount, cats: cats.length })}
        </p>
        <button type="button" className={PRIMARY} disabled={busy !== null || cats.length === 0}
          onClick={() => setEditing({ kind: "item", id: null, category: sortedCats[0]?.id ?? "" })} data-faq-add-item>
          <Plus size={15} aria-hidden />{t("ice.faq.addItem")}
        </button>
        <button type="button" className={BTN} disabled={busy !== null} onClick={() => setEditing({ kind: "category", id: null })} data-faq-add-category>
          <Plus size={15} aria-hidden />{t("ice.faq.addCategory")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("ice.faq.filter")} className="flex flex-wrap gap-1.5">
          {(["all", ...FAQ_PAGES, "hidden", "needs"] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-faq-filter={f}
              className={cn("rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-colors",
                filter === f ? "border-[rgb(var(--accent)/0.45)] bg-accent-soft text-[rgb(var(--accent-strong))]" : "border-line text-muted hover:bg-raised")}>
              {t(`ice.faq.filter_${f.replace("-", "_")}`)}
            </button>
          ))}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ice.faq.search")}
          aria-label={t("ice.faq.search")} className={cn(INPUT, "ml-auto max-w-[16rem]")} />
      </div>

      {error && <p role="alert" className="rounded-xl bg-[rgb(var(--danger)/0.1)] px-3 py-2 text-[13px] text-danger" data-faq-error>{error}</p>}

      {editing?.kind === "category" && (
        <CategoryForm key={editing.id ?? "new"} category={editing.id ? catById.get(editing.id) ?? null : null}
          onCancel={() => setEditing(null)} errorText={errorText}
          onSaved={async () => { setEditing(null); await after(); }} />
      )}
      {editing?.kind === "item" && editing.id === null && (
        <ItemForm key={`new-${editing.category}`} item={null} category={editing.category} categories={sortedCats}
          premiere={data.premiere} onCancel={() => setEditing(null)} errorText={errorText}
          onSaved={async () => { setEditing(null); await after(); }} />
      )}

      <ol className="space-y-3">
        {sortedCats.map((c, ci) => {
          const list = items.filter((it) => it.category_id === c.id).sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug));
          const shown = list.filter(matchesFilter);
          if (filter !== "all" && shown.length === 0) return null;
          const ids = list.map((it) => it.id);
          return (
            <li key={c.id} data-faq-admin-category={c.slug}
              draggable={busy === null} onDragStart={() => { drag.current = { kind: "categories", id: c.id }; }}
              onDragOver={(e) => { if (drag.current?.kind === "categories") e.preventDefault(); }}
              onDrop={() => dropOn("categories", c.id, catIds)}
              className="rounded-2xl border border-line bg-surface">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <GripVertical size={16} aria-hidden className="cursor-grab text-faint" />
                <h3 className="mr-auto min-w-0 text-[13.5px] font-semibold text-ink">
                  {c.name[locale as FaqLocale] ?? c.name.pl}
                  <span className="ml-2 text-[11.5px] font-normal text-faint">/{c.slug} · {t(`cms.contact.text.topic.${c.contact_topic}`)} · {list.length}</span>
                </h3>
                {!c.visible && <Badge tone="warning">{t("ice.faq.categoryHidden")}</Badge>}
                <button type="button" className={ICON} disabled={busy !== null || ci === 0} onClick={() => shift("categories", catIds, c.id, -1)}
                  aria-label={t("ice.faq.up")} title={t("ice.faq.up")}><ArrowUp size={15} aria-hidden /></button>
                <button type="button" className={ICON} disabled={busy !== null || ci === catIds.length - 1} onClick={() => shift("categories", catIds, c.id, 1)}
                  aria-label={t("ice.faq.down")} title={t("ice.faq.down")}><ArrowDown size={15} aria-hidden /></button>
                <button type="button" className={ICON} disabled={busy !== null} onClick={() => void setCategoryVisible(c, !c.visible)}
                  aria-label={c.visible ? t("ice.faq.hide") : t("ice.faq.show")} title={c.visible ? t("ice.faq.hide") : t("ice.faq.show")}>
                  {c.visible ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
                </button>
                <button type="button" className={ICON} onClick={() => setEditing({ kind: "category", id: c.id })}
                  aria-label={t("ice.faq.edit")} title={t("ice.faq.edit")}><Pencil size={15} aria-hidden /></button>
                <button type="button" className={ICON} onClick={() => setHistory({ kind: "category", id: c.id, title: c.name.pl ?? c.slug })}
                  aria-label={t("ice.faq.history")} title={t("ice.faq.history")}><History size={15} aria-hidden /></button>
                <button type="button" className={ICON} disabled={busy !== null || list.length > 0} onClick={() => void removeCategory(c)}
                  aria-label={t("ice.faq.deleteCategory")} title={list.length > 0 ? t("ice.faq.categoryNotEmpty") : t("ice.faq.deleteCategory")}>
                  <Trash2 size={15} aria-hidden />
                </button>
                <button type="button" className={BTN} disabled={busy !== null} onClick={() => setEditing({ kind: "item", id: null, category: c.id })}>
                  <Plus size={14} aria-hidden />{t("ice.faq.addHere")}
                </button>
              </div>
              <ul className="divide-y divide-line">
                {shown.map((it) => {
                  const reasons = reasonsOf(it);
                  const open = editing?.kind === "item" && editing.id === it.id;
                  const i = ids.indexOf(it.id);
                  return (
                    <li key={it.id} data-faq-admin-item={it.slug}
                      draggable={busy === null && !open}
                      onDragStart={(e) => { e.stopPropagation(); drag.current = { kind: "items", id: it.id, category: c.id }; }}
                      onDragOver={(e) => { if (drag.current?.kind === "items" && drag.current.category === c.id) { e.preventDefault(); e.stopPropagation(); } }}
                      onDrop={(e) => { e.stopPropagation(); dropOn("items", it.id, ids, c.id); }}>
                      <div className="flex flex-wrap items-start gap-2 px-3 py-2.5">
                        <GripVertical size={16} aria-hidden className="mt-1 cursor-grab text-faint" />
                        <button type="button" onClick={() => setEditing(open ? null : { kind: "item", id: it.id, category: c.id })}
                          aria-expanded={open} className="min-w-0 flex-1 text-left">
                          <span className="block text-[13.5px] font-semibold text-ink">{it.question.pl}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            {reasons.length === 0
                              ? <Badge tone="success" dot>{t("ice.faq.public")}</Badge>
                              : reasons.map((r) => <Badge key={r} tone={reasonTone(r)}>{t(`ice.faq.reason.${r}`)}</Badge>)}
                            {it.draft_answer && <Badge tone="info">{t("ice.faq.hasDraft")}</Badge>}
                            {it.pages.map((p) => <span key={p} className="rounded-md bg-raised px-1.5 py-0.5 text-[11px] font-semibold text-muted">{t(`ice.faq.page_${p.replace("-", "_")}`)}</span>)}
                            <span className="inline-flex items-center gap-1 text-[11.5px] text-faint" title={t("ice.faq.votesHint")}>
                              <ThumbsUp size={12} aria-hidden />{it.helpful_count}
                              <ThumbsDown size={12} aria-hidden className="ml-1" />{it.unhelpful_count}
                              <span className="sr-only">{t("ice.faq.votes", { yes: it.helpful_count, no: it.unhelpful_count })}</span>
                            </span>
                          </span>
                        </button>
                        <div className="flex items-center">
                          <button type="button" className={ICON} disabled={busy !== null || i <= 0} onClick={() => shift("items", ids, it.id, -1, c.id)}
                            aria-label={t("ice.faq.up")} title={t("ice.faq.up")}><ArrowUp size={15} aria-hidden /></button>
                          <button type="button" className={ICON} disabled={busy !== null || i >= ids.length - 1} onClick={() => shift("items", ids, it.id, 1, c.id)}
                            aria-label={t("ice.faq.down")} title={t("ice.faq.down")}><ArrowDown size={15} aria-hidden /></button>
                          <button type="button" className={ICON} disabled={busy !== null} onClick={() => void setItemVisible(it, !it.visible)}
                            aria-label={it.visible ? t("ice.faq.hide") : t("ice.faq.show")} title={it.visible ? t("ice.faq.hide") : t("ice.faq.show")} data-faq-toggle={it.slug}>
                            {it.visible ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
                          </button>
                          <button type="button" className={ICON} onClick={() => setHistory({ kind: "item", id: it.id, title: it.question.pl ?? it.slug })}
                            aria-label={t("ice.faq.history")} title={t("ice.faq.history")}><History size={15} aria-hidden /></button>
                        </div>
                      </div>
                      {open && (
                        <div className="border-t border-line bg-bg/60 px-3 py-3">
                          <ItemForm item={it} category={c.id} categories={sortedCats} premiere={data.premiere}
                            onCancel={() => setEditing(null)} errorText={errorText}
                            onSaved={async () => { setEditing(null); await after(); }} />
                        </div>
                      )}
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="px-3 py-3 text-[12.5px] text-faint">{t("ice.faq.emptyCategory")}</li>}
              </ul>
            </li>
          );
        })}
      </ol>

      {data.deleted.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface px-3 py-2" data-faq-trash>
          <summary className="cursor-pointer text-[13px] font-semibold text-ink">{t("ice.faq.trash", { n: data.deleted.length })}</summary>
          <ul className="mt-2 divide-y divide-line">
            {data.deleted.map((v) => (
              <li key={v.id} className="flex items-center gap-2 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{titleOf(v)}</span>
                <span className="text-[11.5px] text-faint">{new Date(v.created_at).toLocaleString(locale)}</span>
                <button type="button" className={BTN} disabled={busy !== null} onClick={() => void restore(v.id)}>
                  <RotateCcw size={14} aria-hidden />{t("ice.faq.restore")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {history && (
        <HistoryList key={`${history.kind}:${history.id}`} target={history} busy={busy !== null}
          onRestore={(id) => void restore(id)} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}

const reasonTone = (r: FaqHiddenReason): "warning" | "danger" | "neutral" | "accent" =>
  r === "placeholder" || r === "empty_answer" || r === "empty_question" ? "danger"
    : r === "needs_review" ? "warning" : r === "premiere_only" ? "accent" : "neutral";

function titleOf(v: FaqVersion): string {
  const s = v.state ?? {};
  const q = s.question ?? s.name;
  const pl = q && typeof q === "object" ? (q as Record<string, unknown>).pl : null;
  return typeof pl === "string" ? pl : String(s.slug ?? v.key);
}

/* ── the item form ─────────────────────────────────────────────────────── */

function ItemForm({ item, category, categories, premiere, onCancel, onSaved, errorText }: {
  item: FaqItemRow | null;
  category: string;
  categories: FaqCategoryRow[];
  premiere: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  errorText: (code: string, field?: string) => string;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<FaqLocale>("pl");
  const [question, setQuestion] = useState<FaqText>(item?.question ?? {});
  const [answer, setAnswer] = useState<FaqText>(item?.answer ?? {});
  const [slug, setSlug] = useState(item?.slug ?? "");
  const [cat, setCat] = useState(item?.category_id ?? category);
  const [pages, setPages] = useState<FaqPage[]>(item?.pages ?? ["faq"]);
  const [tools, setTools] = useState<string[]>(item?.tools ?? []);
  const [visible, setVisible] = useState(item?.visible ?? false);
  const [review, setReview] = useState(item?.needs_review ?? false);
  const [premiereOnly, setPremiereOnly] = useState(item?.only_premiere ?? false);
  const [note, setNote] = useState(item?.review_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const draft: FaqItemRow = {
    ...(item ?? { id: "", import_key: null, helpful_count: 0, unhelpful_count: 0, position: 0, created_at: "", updated_at: "", draft_answer: null }),
    slug, category_id: cat, question, answer, pages, tools, visible, needs_review: review, only_premiere: premiereOnly, review_note: note || null,
  } as FaqItemRow;
  const reasons = faqHiddenReasons(draft, categories.find((c) => c.id === cat), { premiere });
  const preview = parseFaqRich(answer[tab] ?? "");

  const wrap = (before: string, after: string, fallback: string) => {
    const el = area.current;
    const value = answer[tab] ?? "";
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    setAnswer({ ...answer, [tab]: value.slice(0, start) + before + selected + after + value.slice(end) });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await saveFaqItemAction({
      id: item?.id ?? null, base: item?.updated_at ?? null, slug: slug || undefined, category_id: cat,
      question, answer, draft_answer: item?.draft_answer ?? null, pages, tools, visible, needs_review: review,
      only_premiere: premiereOnly, review_note: note,
    });
    setSaving(false);
    if (!res.ok) { setError(errorText(res.error, res.field)); return; }
    await onSaved();
  };

  const remove = async () => {
    if (!item || !window.confirm(t("ice.faq.confirmDelete", { q: item.question.pl ?? item.slug }))) return;
    setSaving(true);
    const res = await deleteFaqItemAction(item.id);
    setSaving(false);
    if (!res.ok) { setError(errorText(res.error)); return; }
    await onSaved();
  };

  const field = "block text-[12px] font-semibold text-muted";
  // The tool's page headline (the same words its public page shows).
  const toolLabel = (k: string) => t(toolPageTextKeys(k).headline);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-faq-form={item?.slug ?? "new"}>
      <div role="tablist" aria-label={t("ice.faq.language")} className="flex gap-1">
        {FAQ_LOCALES.map((l) => (
          <button key={l} type="button" role="tab" aria-selected={tab === l} onClick={() => setTab(l)}
            className={cn("rounded-lg px-2.5 py-1 text-[12px] font-bold uppercase", tab === l ? "bg-ink text-bg" : "text-muted hover:bg-raised")}>
            {l}{l !== "pl" && !(question[l] && answer[l]) ? " ·" : ""}
          </button>
        ))}
        {tab !== "pl" && <span className="ml-2 self-center text-[11.5px] text-faint">{t("ice.faq.fallbackPl")}</span>}
      </div>
      <label className={field}>{t("ice.faq.question")}
        <input className={cn(INPUT, "mt-1")} value={question[tab] ?? ""} maxLength={300}
          onChange={(e) => setQuestion({ ...question, [tab]: e.target.value })} required={tab === "pl"} data-faq-question />
      </label>
      <div>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`faq-answer-${item?.id ?? "new"}`} className={field}>{t("ice.faq.answer")}</label>
          <span className="flex gap-1">
            <button type="button" className={BTN} onClick={() => wrap("**", "**", t("ice.faq.boldSample"))} title={t("ice.faq.bold")}><b>B</b></button>
            <button type="button" className={BTN} onClick={() => wrap("[", "](/kontakt)", t("ice.faq.linkSample"))} title={t("ice.faq.link")}>{t("ice.faq.link")}</button>
          </span>
        </div>
        <textarea id={`faq-answer-${item?.id ?? "new"}`} ref={area} className={cn(INPUT, "mt-1 min-h-[7rem] leading-relaxed")} maxLength={4000}
          value={answer[tab] ?? ""} onChange={(e) => setAnswer({ ...answer, [tab]: e.target.value })} data-faq-answer />
        <p className="mt-1 text-[11.5px] text-faint">{t("ice.faq.formatHint")}</p>
        {preview.length > 0 && (
          <div className="mt-2 space-y-2 rounded-xl border border-dashed border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-muted" aria-label={t("ice.faq.preview")}>
            <FaqRichText rich={preview} />
          </div>
        )}
      </div>
      {item?.draft_answer && Object.keys(item.draft_answer).length > 0 && (
        <div className="rounded-xl bg-[rgb(var(--indigo)/0.08)] px-3 py-2 text-[12.5px]" data-faq-draft>
          <p className="font-semibold text-ink">{t("ice.faq.draftTitle")}</p>
          <p className="mt-1 whitespace-pre-line text-muted">{item.draft_answer[tab] ?? item.draft_answer.pl}</p>
          <button type="button" className={cn(BTN, "mt-2")} onClick={() => setAnswer({ ...answer, [tab]: item.draft_answer?.[tab] ?? item.draft_answer?.pl ?? "" })}>
            {t("ice.faq.useDraft")}
          </button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>{t("ice.faq.category")}
          <select className={cn(INPUT, "mt-1")} value={cat} onChange={(e) => setCat(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name.pl ?? c.slug}</option>)}
          </select>
        </label>
        <label className={field}>{t("ice.faq.slug")}
          <input className={cn(INPUT, "mt-1 font-mono text-[12.5px]")} value={slug} placeholder={faqSlugify(question.pl ?? "")}
            onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={80} />
          {item && slug !== item.slug && <span className="mt-1 block text-[11.5px] font-normal text-warning">{t("ice.faq.slugWarn")}</span>}
        </label>
      </div>
      <fieldset>
        <legend className={field}>{t("ice.faq.pages")}</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {FAQ_PAGES.map((p) => (
            <label key={p} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
              <input type="checkbox" checked={pages.includes(p)} data-faq-page-box={p}
                onChange={(e) => setPages(e.target.checked ? [...pages, p] : pages.filter((x) => x !== p))} />
              {t(`ice.faq.page_${p.replace("-", "_")}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset data-faq-tools>
        <legend className={field}>{t("ice.faq.tools")}</legend>
        <p className="mt-0.5 text-[11.5px] text-faint">{t("ice.faq.toolsHint")}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1.5">
          {FAQ_TOOLS.map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5 text-[13px] text-ink">
              <input type="checkbox" checked={tools.includes(k)} data-faq-tool-box={k}
                onChange={(e) => setTools(e.target.checked ? [...tools, k] : tools.filter((x) => x !== k))} />
              {toolLabel(k)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink">
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} data-faq-visible />{t("ice.faq.visible")}</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />{t("ice.faq.needsReview")}</label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={premiereOnly} onChange={(e) => setPremiereOnly(e.target.checked)} />{t("ice.faq.onlyPremiere")}</label>
      </div>
      <label className={field}>{t("ice.faq.note")}
        <textarea className={cn(INPUT, "mt-1 min-h-[3.5rem] text-[12.5px]")} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-[12.5px] text-muted" data-faq-reasons>
        {reasons.length === 0 ? t("ice.faq.willShow") : `${t("ice.faq.whyHidden")} ${reasons.map((r) => t(`ice.faq.reason.${r}`)).join(" · ")}`}
      </p>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={PRIMARY} disabled={saving} data-faq-save>{saving ? t("ice.faq.saving") : t("ice.faq.save")}</button>
        <button type="button" className={BTN} onClick={onCancel}><X size={14} aria-hidden />{t("ice.faq.cancel")}</button>
        {item && (
          <button type="button" className={cn(BTN, "ml-auto text-danger")} disabled={saving} onClick={() => void remove()} data-faq-delete>
            <Trash2 size={14} aria-hidden />{t("ice.faq.delete")}
          </button>
        )}
      </div>
    </form>
  );
}

/* ── the category form ─────────────────────────────────────────────────── */

function CategoryForm({ category, onCancel, onSaved, errorText }: {
  category: FaqCategoryRow | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  errorText: (code: string, field?: string) => string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState<FaqText>(category?.name ?? {});
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [visible, setVisible] = useState(category?.visible ?? true);
  const [topic, setTopic] = useState<TicketTopic>(category?.contact_topic ?? "other");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await saveFaqCategoryAction({
      id: category?.id ?? null, base: category?.updated_at ?? null, slug: slug || undefined, name, visible, contact_topic: topic,
    });
    setSaving(false);
    if (!res.ok) { setError(errorText(res.error, res.field)); return; }
    await onSaved();
  };

  return (
    <form className="space-y-3 rounded-2xl border border-line bg-surface p-3" onSubmit={(e) => { e.preventDefault(); void save(); }} data-faq-category-form>
      <p className="text-[13.5px] font-semibold text-ink">{category ? t("ice.faq.editCategory") : t("ice.faq.addCategory")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {FAQ_LOCALES.map((l) => (
          <label key={l} className="block text-[12px] font-semibold text-muted">{t("ice.faq.categoryName")} ({l.toUpperCase()})
            <input className={cn(INPUT, "mt-1")} value={name[l] ?? ""} maxLength={80} required={l === "pl"}
              onChange={(e) => setName({ ...name, [l]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px] font-semibold text-muted">{t("ice.faq.slug")}
          <input className={cn(INPUT, "mt-1 font-mono text-[12.5px]")} value={slug} placeholder={faqSlugify(name.pl ?? "", 60)}
            onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={60} />
        </label>
        <label className="block text-[12px] font-semibold text-muted">{t("ice.faq.topic")}
          <select className={cn(INPUT, "mt-1")} value={topic} onChange={(e) => setTopic(e.target.value as TicketTopic)}>
            {TICKET_TOPICS.map((tp) => <option key={tp} value={tp}>{t(`cms.contact.text.topic.${tp}`)}</option>)}
          </select>
        </label>
      </div>
      <label className="inline-flex items-center gap-1.5 text-[13px] text-ink">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />{t("ice.faq.categoryVisible")}
      </label>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={saving}>{saving ? t("ice.faq.saving") : t("ice.faq.save")}</button>
        <button type="button" className={BTN} onClick={onCancel}>{t("ice.faq.cancel")}</button>
      </div>
    </form>
  );
}

/* ── history ───────────────────────────────────────────────────────────── */

function HistoryList({ target, busy, onRestore, onClose }: {
  target: { kind: "item" | "category"; id: string; title: string };
  busy: boolean;
  onRestore: (versionId: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<FaqVersion[] | null>(null);
  useEffect(() => {
    let live = true;
    void faqHistoryAction(target.kind, target.id).then((res) => { if (live) setRows(res.ok ? res.data : []); });
    return () => { live = false; };
  }, [target.kind, target.id]);
  return (
    <section className="rounded-2xl border border-line bg-surface p-3" aria-label={t("ice.faq.history")} data-faq-history>
      <div className="flex items-center gap-2">
        <h3 className="mr-auto text-[13.5px] font-semibold text-ink">{t("ice.faq.historyOf", { name: target.title })}</h3>
        <button type="button" className={ICON} onClick={onClose} aria-label={t("ice.faq.close")}><X size={15} aria-hidden /></button>
      </div>
      {rows === null ? <p className="mt-2 text-[12.5px] text-muted">{t("ice.faq.loading")}</p>
        : rows.length === 0 ? <p className="mt-2 text-[12.5px] text-muted">{t("ice.faq.historyEmpty")}</p>
        : (
          <ol className="mt-2 divide-y divide-line">
            {rows.map((v, i) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]">
                <span className="font-semibold text-ink">{t(`ice.faq.action.${v.action}`)}</span>
                <span className="text-faint">{new Date(v.created_at).toLocaleString(locale)}{v.author ? ` · ${v.author}` : ""}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{summaryOf(v)}</span>
                {i > 0 || v.action === "clear" ? (
                  <button type="button" className={BTN} disabled={busy} onClick={() => onRestore(v.id)} data-faq-restore>
                    <RotateCcw size={14} aria-hidden />{t("ice.faq.restore")}
                  </button>
                ) : <span className="text-[11.5px] text-faint">{t("ice.faq.current")}</span>}
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}

function summaryOf(v: FaqVersion): string {
  const s = v.state ?? {};
  const a = s.answer ?? s.name;
  const pl = a && typeof a === "object" ? (a as Record<string, unknown>).pl : null;
  return typeof pl === "string" ? pl.slice(0, 120) : "";
}
