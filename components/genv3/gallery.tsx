"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check, Download, Heart, LayoutGrid, List, Loader2, Megaphone, Minus,
  Plus, RefreshCw, Search, Sparkles, SquareDashedMousePointer, Sun, Trash2, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { GalleryItem, GallerySessionType, GenModel } from "@/components/genv3/types";
import { ImageDetails, extOf, saveBlob } from "@/components/genv3/image-details";
import { RegenerateModal } from "@/components/genv3/regenerate";

type Filter = { session: GallerySessionType | "all"; fav: boolean; q: string; order: "desc" | "asc" };

/** Most images one "Pobierz wybrane" may pack — the ZIP endpoint's own cap. */
const SELECT_MAX = 60;

/**
 * Run a bulk action over the picks a few at a time. Sixty sequential round
 * trips would leave the customer watching a spinner for the better part of a
 * minute; sixty at once would hammer the API. A small window is neither.
 */
async function runLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await run(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Minimum card width per density step — the grid auto-fills from it, so on a
 *  wide monitor the same step simply yields more columns. Step 0 is the
 *  densest contact sheet, step 5 the largest preview. */
const DENSITY_STEPS = [104, 128, 160, 200, 260, 340] as const;
const DENSITY_DEFAULT = 2;
const DENSITY_KEY = "grovbase.gallery.density";

/**
 * TWOJE GENERACJE — the workspace gallery.
 *
 * Server-paginated (24 per page, one batched signing call per page), lazily
 * loaded through a scroll sentinel, filterable by session type, favourites
 * and text. Fresh results from the current session arrive through
 * `freshItems` and carry the NOWE badge. Cards expose exactly the actions
 * that exist: open, regenerate, download, favourite, delete.
 */
export function GenerationGallery({
  initialItems, initialCursor, freshItems, onFresh, pendingCount, pendingRatio,
  models, balance, onBalance, onAbsorb, operation, emptyTitle, emptyBody,
}: {
  initialItems: GalleryItem[];
  initialCursor: string | null;
  freshItems: GalleryItem[];
  onFresh: (fn: (prev: GalleryItem[]) => GalleryItem[]) => void;
  pendingCount: number;
  pendingRatio: string;
  models: GenModel[];
  balance: number;
  onBalance: (fn: (b: number) => number) => void;
  onAbsorb: (expect: number) => Promise<void>;
  /** Feature whose results this gallery lists ("image_retouch"). Absent = the
   *  workspace's generations, unfiltered. */
  operation?: string;
  /** Copy for the empty state, so a tool can say what IT is waiting for. */
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>({ session: "all", fav: false, q: "", order: "desc" });
  const [view, setView] = useState<"grid" | "list">("grid");
  // Presentation only — remembered per browser, never a round trip.
  const [density, setDensity] = useState(DENSITY_DEFAULT);
  useEffect(() => {
    try {
      // `getItem` returns null when nothing was ever saved, and Number(null)
      // is 0 — which silently started every new browser on the densest
      // contact sheet instead of the default step.
      const raw = window.localStorage.getItem(DENSITY_KEY);
      if (raw === null) return;
      const saved = Number(raw);
      if (Number.isInteger(saved) && saved >= 0 && saved < DENSITY_STEPS.length) setDensity(saved);
    } catch { /* private mode — the default is fine */ }
  }, []);
  const changeDensity = useCallback((next: number) => {
    const step = Math.min(DENSITY_STEPS.length - 1, Math.max(0, next));
    setDensity(step);
    try { window.localStorage.setItem(DENSITY_KEY, String(step)); } catch { /* not essential */ }
  }, []);
  const [items, setItems] = useState<GalleryItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [regenItem, setRegenItem] = useState<GalleryItem | null>(null);
  // ── Multi-select ───────────────────────────────────────────────────────
  // A MODE, as in the Library: enter it from the toolbar or by ticking any
  // card, tap cards to toggle, leave with Anuluj or Escape. Keyed by asset
  // id because that is what a card is. Several picks download as ONE ZIP
  // through the Library's endpoint (it verifies every path against this
  // workspace's own assets); a single pick saves the file itself.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [zipping, setZipping] = useState(false);
  /** Which bulk action is running, so the bar can show it and refuse a second. */
  const [bulkBusy, setBulkBusy] = useState<"fav" | "del" | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDefault = filter.session === "all" && !filter.fav && !filter.q && filter.order === "desc";

  const buildUrl = useCallback((f: Filter, cur: string | null) => {
    const p = new URLSearchParams();
    if (f.session !== "all") p.set("session", f.session);
    if (f.fav) p.set("fav", "1");
    if (f.q.trim()) p.set("q", f.q.trim());
    if (f.order === "asc") p.set("order", "asc");
    if (cur) p.set("cursor", cur);
    if (operation) p.set("op", operation);
    p.set("limit", "24");
    return `/api/generations?${p.toString()}`;
  }, [operation]);

  const refetch = useCallback(async (f: Filter) => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const res = await fetch(buildUrl(f, null), { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: GalleryItem[]; nextCursor?: string | null };
      if (seq !== fetchSeq.current) return;
      if (json.ok && json.items) { setItems(json.items); setCursor(json.nextCursor ?? null); }
    } catch { /* keep what we have */ }
    if (seq === fetchSeq.current) setLoading(false);
  }, [buildUrl]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const res = await fetch(buildUrl(filter, cursor), { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: GalleryItem[]; nextCursor?: string | null };
      if (seq !== fetchSeq.current) return;
      if (json.ok && json.items) {
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.assetId));
          return [...prev, ...json.items!.filter((i) => !seen.has(i.assetId))];
        });
        setCursor(json.nextCursor ?? null);
      }
    } catch { /* retry on next intersection */ }
    if (seq === fetchSeq.current) setLoading(false);
  }, [cursor, loading, filter, buildUrl]);

  function applyFilter(patch: Partial<Filter>) {
    const next = { ...filter, ...patch };
    setFilter(next);
    if (patch.q !== undefined) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void refetch(next), 320);
    } else {
      // A pending search debounce would replay a STALE filter over this
      // immediate fetch — cancel it; `next` already carries the typed text.
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      void refetch(next);
    }
  }

  // Infinite loading through a sentinel — no scroll listeners, no jank.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // Merge: fresh results first (they match "newest"), dedup by asset.
  const merged = useMemo(() => {
    const matches = (i: GalleryItem) =>
      (filter.session === "all" || i.sessionType === filter.session)
      && (!filter.fav || i.favorite)
      && (!filter.q.trim() || [i.product, i.model, i.prompt].some((v) => v?.toLowerCase().includes(filter.q.trim().toLowerCase())));
    const seen = new Set<string>();
    const out: GalleryItem[] = [];
    // Oldest-first: fresh items belong at the TAIL, and only once every
    // older page is loaded — otherwise they would appear mid-history.
    const source = filter.order === "asc"
      ? (cursor ? [...items] : [...items, ...freshItems.filter(matches)])
      : [...freshItems.filter(matches), ...items];
    for (const i of source) {
      if (seen.has(i.assetId)) continue;
      seen.add(i.assetId);
      if (filter.order === "asc" || matches(i) || items.includes(i)) out.push(i);
    }
    return out;
  }, [items, freshItems, filter, cursor]);

  // Only picks that are actually on screen count — a filter change may hide
  // a picked card, and the download must never include what cannot be seen.
  const chosen = useMemo(() => merged.filter((i) => picked.has(i.assetId)), [merged, picked]);

  // ...and a hidden pick is DROPPED rather than merely ignored. Keeping it
  // made the cap disagree with the counter: sixty picks in "Wszystkie", then
  // a filter showing twenty of them read "Wybrano: 20" while every further
  // tick was refused as "maksymalnie 60".
  useEffect(() => {
    setPicked((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(merged.map((i) => i.assetId));
      const kept = [...prev].filter((id) => visible.has(id));
      return kept.length === prev.size ? prev : new Set(kept);
    });
  }, [merged]);

  function togglePick(assetId: string) {
    setSelecting(true);
    const next = new Set(picked);
    if (next.has(assetId)) {
      next.delete(assetId);
    } else {
      if (next.size >= SELECT_MAX) { toast.error(t("genv3.selectMax", { n: SELECT_MAX })); return; }
      next.add(assetId);
    }
    setPicked(next);
  }
  function selectAll() {
    if (merged.length > SELECT_MAX) toast.error(t("genv3.selectMax", { n: SELECT_MAX }));
    setPicked(new Set(merged.slice(0, SELECT_MAX).map((i) => i.assetId)));
    setSelecting(true);
  }
  function exitSelection() {
    setSelecting(false);
    setPicked(new Set());
  }

  /**
   * Escape leaves selection mode — but ONLY when it is really meant for the
   * gallery. Every dialog in the app listens for Escape on `window` too, and
   * `stopPropagation` between two listeners on the SAME target does nothing:
   * without this guard, cancelling the prompt popup (or a bottom sheet, or
   * the reference picker) silently threw away every pick behind it. A field
   * the customer is typing in owns the key as well.
   */
  useEffect(() => {
    if (!selecting || detailsId || regenItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) return;
      if (el?.closest?.("[role='dialog']")) return;
      // Focus may sit on <body> while a dialog is open — the dialog still owns
      // the key, so nothing on the page below may act on it.
      if (document.querySelector("[role='dialog']")) return;
      setSelecting(false);
      setPicked(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, detailsId, regenItem]);

  /** Selected ASSETS belong to generations — favourite and delete work on
   *  the generation, so the same one is never acted on twice. */
  function chosenGenerationIds(): string[] {
    return [...new Set(chosen.map((i) => i.generationId))];
  }

  async function favoriteSelected() {
    const ids = chosenGenerationIds();
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy("fav");
    const supabase = createClient();
    let failed = 0;
    await runLimited(ids, 5, async (id) => {
      const { error } = await supabase.rpc("set_generation_favorite", { gen_id: id, value: true });
      if (error) failed++; else mutate(id, { favorite: true });
    });
    setBulkBusy(null);
    if (failed > 0) toast.error(t("common.error"));
    else toast.success(t("genv3.favAdded", { n: ids.length }));
  }

  async function deleteSelected() {
    const ids = chosenGenerationIds();
    if (ids.length === 0 || bulkBusy) return;
    // Deleting several images at once is the one bulk action that cannot be
    // undone, so it asks first and names the number.
    if (!window.confirm(t("genv3.deleteManyConfirm", { n: chosen.length }))) return;
    setBulkBusy("del");
    let failed = 0;
    const gone: string[] = [];
    await runLimited(ids, 4, async (id) => {
      try {
        const res = await fetch("/api/generations/delete", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId: id }),
        });
        const json = await res.json() as { ok: boolean };
        if (json.ok) gone.push(id); else failed++;
      } catch { failed++; }
    });
    if (gone.length > 0) {
      const drop = (prev: GalleryItem[]) => prev.filter((i) => !gone.includes(i.generationId));
      setItems(drop);
      onFresh(drop);
      setDetailsId(null);
    }
    setBulkBusy(null);
    setPicked(new Set());
    setSelecting(false);
    if (failed > 0) toast.error(t("common.error"));
    else toast.success(t("genv3.deletedMany", { n: gone.length }));
  }

  async function downloadSelected() {
    if (chosen.length === 0 || zipping) return;
    setZipping(true);
    try {
      if (chosen.length === 1) {
        const item = chosen[0];
        const res = await fetch(item.url);
        if (!res.ok) throw new Error("fetch_failed");
        const blob = await res.blob();
        saveBlob(blob, `grovbase-${item.assetId.slice(0, 8)}.${extOf(blob.type)}`);
      } else {
        const res = await fetch("/api/library/zip", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: chosen.map((i) => i.path) }),
        });
        if (!res.ok) throw new Error("zip_failed");
        saveBlob(await res.blob(), `grovbase-${chosen.length}-${new Date().toISOString().slice(0, 10)}.zip`);
      }
      toast.success(t("genv3.downloadStarted"));
      exitSelection();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setZipping(false);
    }
  }

  // ── Card actions ───────────────────────────────────────────────────────
  async function toggleFavorite(item: GalleryItem) {
    const next = !item.favorite;
    mutate(item.generationId, { favorite: next });
    const { error } = await createClient().rpc("set_generation_favorite", { gen_id: item.generationId, value: next });
    if (error) { mutate(item.generationId, { favorite: !next }); toast.error(t("common.error")); }
  }

  function mutate(generationId: string, patch: Partial<GalleryItem>) {
    const map = (arr: GalleryItem[]) => arr.map((i) => i.generationId === generationId ? { ...i, ...patch } : i);
    setItems(map);
    onFresh(map);
  }

  async function remove(item: GalleryItem) {
    if (!window.confirm(t("genv3.deleteConfirm"))) return;
    const res = await fetch("/api/generations/delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generationId: item.generationId }),
    });
    const json = await res.json() as { ok: boolean };
    if (json.ok) {
      const drop = (prev: GalleryItem[]) => prev.filter((i) => i.generationId !== item.generationId);
      setItems(drop);
      onFresh(drop);
      setDetailsId(null);
      // Every asset of that generation is gone — none may stay picked.
      const gone = new Set(merged.filter((i) => i.generationId === item.generationId).map((i) => i.assetId));
      setPicked((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      toast.success(t("genv3.deleted"));
    } else {
      toast.error(t("common.error"));
    }
  }

  async function download(item: GalleryItem) {
    // Fetch, then hand the browser a same-origin blob: a signed URL opened in
    // a tab only DISPLAYS the image, which is not what "Pobierz" promises.
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error("fetch_failed");
      const blob = await res.blob();
      saveBlob(blob, `grovbase-${item.assetId.slice(0, 8)}.${extOf(blob.type)}`);
    } catch {
      // Last resort: at least put the image in front of them.
      window.open(item.url, "_blank", "noopener");
    }
  }

  const chips: { key: Filter["session"]; label: string; icon?: typeof Megaphone }[] = [
    { key: "all", label: t("genv3.filterAll"), icon: Sparkles },
    { key: "advertising", label: t("genv3.sessionAd"), icon: Megaphone },
    { key: "lifestyle", label: t("genv3.sessionLife"), icon: Sun },
  ];

  const skeletonRatio = pendingRatio.includes(":") ? pendingRatio.replace(":", "/") : "1/1";

  return (
    // No section heading: the gallery IS the right half of the workspace, not
    // a titled block inside a page, and dropping the title lets its toolbar
    // start on the same line as the configuration panel opposite.
    <div className="min-w-0">
      {/* ONE toolbar row: session chips on the left, view/search/filter/sort
          on the right, every control the same 36px height on a shared centre
          line. Below `lg` the two groups wrap onto their own rows instead of
          being squeezed. */}
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="thin-scroll -mx-1 order-2 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 pb-0.5 lg:order-1">
          {/* Session chips belong to the generator: a retouch has no session
              type, so a tool's gallery does not offer two dead filters. */}
          {!operation && chips.map((c) => {
            const on = filter.session === c.key;
            return (
              <button key={c.key} type="button" aria-pressed={on}
                onClick={() => applyFilter({ session: c.key })}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-[12.5px] font-semibold transition-colors duration-200",
                  on ? "is-selected text-ink" : "border-line text-muted hover:bg-raised",
                )}>
                {c.icon && <c.icon size={13} aria-hidden className={on ? "text-accent" : "text-faint"} />}
                {c.label}
              </button>
            );
          })}
          {/* Phones get three tap targets instead of a slider — the row
              already scrolls sideways, so nothing overflows. */}
          {view === "grid" && (
            <div className="ml-1 flex shrink-0 items-center rounded-xl border border-line p-0.5 md:hidden"
              role="group" aria-label={t("genv3.densityLabel")}>
              {[[0, "S"], [2, "M"], [4, "L"]].map(([step, short]) => (
                <button key={String(short)} type="button"
                  aria-pressed={density === step}
                  aria-label={`${t("genv3.densityLabel")}: ${short}`}
                  onClick={() => changeDensity(step as number)}
                  className={cn("h-8 w-8 rounded-[9px] text-[11px] font-bold transition-colors",
                    density === step ? "bg-raised text-ink" : "text-faint")}>
                  {short}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="order-1 flex min-w-0 flex-1 items-center gap-1.5 lg:order-2 lg:flex-none">
          <div className="hidden items-center rounded-xl border border-line p-0.5 md:flex" role="group" aria-label={t("genv3.viewLabel")}>
            <button type="button" aria-pressed={view === "grid"} aria-label={t("genv3.viewGrid")}
              onClick={() => setView("grid")}
              className={cn("rounded-[9px] p-1.5", view === "grid" ? "bg-raised text-ink" : "text-faint hover:text-ink")}>
              <LayoutGrid size={14} aria-hidden />
            </button>
            <button type="button" aria-pressed={view === "list"} aria-label={t("genv3.viewList")}
              onClick={() => setView("list")}
              className={cn("rounded-[9px] p-1.5", view === "list" ? "bg-raised text-ink" : "text-faint hover:text-ink")}>
              <List size={14} aria-hidden />
            </button>
          </div>
          {/* Thumbnail size — a workspace tool, not a feature panel. Only
              meaningful for the grid, so it hides with the list view. */}
          {view === "grid" && (
            <div className="hidden h-9 items-center gap-1.5 rounded-xl border border-line px-2 md:flex">
              <button type="button" aria-label={t("genv3.densitySmaller")} title={t("genv3.densitySmaller")}
                disabled={density === 0} onClick={() => changeDensity(density - 1)}
                className="text-faint transition-colors hover:text-ink disabled:opacity-35">
                <Minus size={13} aria-hidden />
              </button>
              <input
                type="range" min={0} max={DENSITY_STEPS.length - 1} step={1} value={density}
                onChange={(e) => changeDensity(Number(e.target.value))}
                aria-label={t("genv3.densityLabel")}
                title={t("genv3.densityLabel")}
                className="h-1 w-16 cursor-pointer accent-[rgb(var(--accent))] lg:w-14 xl:w-20"
              />
              <button type="button" aria-label={t("genv3.densityLarger")} title={t("genv3.densityLarger")}
                disabled={density === DENSITY_STEPS.length - 1} onClick={() => changeDensity(density + 1)}
                className="text-faint transition-colors hover:text-ink disabled:opacity-35">
                <Plus size={13} aria-hidden />
              </button>
            </div>
          )}
          {/* Desktop: the search field is ALWAYS visible, same height as its
              neighbours. Phones get it full-width on its own row. */}
          <div className="relative hidden md:block md:min-w-0 md:flex-1 lg:w-40 lg:flex-none xl:w-64 2xl:w-72">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={filter.q}
              onChange={(e) => applyFilter({ q: e.target.value })}
              placeholder={t("genv3.searchPh")}
              aria-label={t("genv3.searchLabel")}
              className="h-9 w-full rounded-xl border border-line bg-sunken/60 pl-8 pr-2 text-[12.5px] font-medium outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.55)] focus:shadow-[0_0_0_3px_rgb(var(--accent)/0.12)]"
            />
          </div>
          {/* Phones: the field takes the whole row instead of hiding behind a
              magnifier — searching is a primary action here too. */}
          <div className="relative min-w-0 flex-1 md:hidden">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={filter.q}
              onChange={(e) => applyFilter({ q: e.target.value })}
              placeholder={t("genv3.searchPh")}
              aria-label={t("genv3.searchLabel")}
              className="h-9 w-full rounded-xl border border-line bg-sunken/60 pl-8 pr-2 text-[12.5px] font-medium outline-none transition-colors placeholder:text-faint focus:border-[rgb(var(--accent)/0.55)]"
            />
          </div>
          {/* Selection mode — icon only, the bar below carries the words. */}
          <button type="button" aria-pressed={selecting} data-select-toggle
            aria-label={selecting ? t("genv3.selectOff") : t("genv3.selectOn")}
            title={selecting ? t("genv3.selectOff") : t("genv3.selectOn")}
            onClick={() => selecting ? exitSelection() : setSelecting(true)}
            className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
              selecting ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft/40 text-accent" : "border-line text-faint hover:text-ink")}>
            <SquareDashedMousePointer size={14} aria-hidden />
          </button>
          {/* Favourites filter wears the same HEART the rest of GrovBase
              uses — outline off, filled + accent on. */}
          <button type="button" aria-pressed={filter.fav} aria-label={t("genv3.filterFav")} title={t("genv3.filterFav")}
            onClick={() => applyFilter({ fav: !filter.fav })}
            className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors",
              filter.fav ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft/40 text-accent" : "border-line text-faint hover:text-ink")}>
            <Heart size={14} aria-hidden fill={filter.fav ? "currentColor" : "none"} />
          </button>
          <select
            value={filter.order}
            onChange={(e) => applyFilter({ order: e.target.value as "desc" | "asc" })}
            aria-label={t("genv3.sortLabel")}
            className="h-9 rounded-xl border border-line bg-sunken/60 px-2 text-[12px] font-semibold text-ink outline-none">
            <option value="desc">{t("genv3.sortNewest")}</option>
            <option value="asc">{t("genv3.sortOldest")}</option>
          </select>
        </div>
      </div>

      {/* THE BAR EXISTS ONLY WHEN SOMETHING IS PICKED. "Wybrano: 0" is not
          information, and an empty strip above the grid is just a hole — so
          the bar is mounted by the selection itself and unmounts with it,
          leaving no gap behind. Selection MODE (the ticks) is separate: the
          toolbar toggle turns those on for touch, where there is no hover.
          Sticky at every width so the actions stay reachable deep in a long
          history; below `lg` it parks under the app header. */}
      {chosen.length > 0 && (
        <div data-select-bar
          className="animate-fade sticky top-[calc(var(--header-h)+env(safe-area-inset-top)+0.25rem)] z-20 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--surface))] px-2.5 py-2 shadow-e2 lg:top-0">
          <span className="order-1 px-1 text-[12.5px] font-semibold tabular-nums" data-selected-count>
            {t("genv3.selectedCount", { n: chosen.length })}
          </span>
          <button type="button" onClick={exitSelection} aria-label={t("genv3.selectOff")} title={t("genv3.selectOff")}
            className="order-2 ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-faint transition-colors hover:bg-raised hover:text-ink sm:hidden">
            <X size={15} aria-hidden />
          </button>
          {/* Phones break here: count and close on the first line, the
              toggles and the actions on the second. */}
          <span aria-hidden className="order-3 h-0 basis-full sm:hidden" />
          <span aria-hidden className="hidden h-4 w-px bg-line sm:order-2 sm:mx-0.5 sm:block" />
          <button type="button" onClick={selectAll} disabled={merged.length === 0} data-select-all
            className="order-4 h-8 rounded-lg px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 sm:order-3">
            {t("genv3.selectAll")}
          </button>
          <button type="button" onClick={() => setPicked(new Set())} data-select-none
            className="order-5 h-8 rounded-lg px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink sm:order-4">
            {t("genv3.selectNone")}
          </button>
          <span className="order-6 hidden flex-1 sm:order-5 sm:block" />
          {/* Icons with tooltips, not three long buttons: the row has to
              survive a 375px screen without wrapping into a wall of text. */}
          <span className="order-7 ml-auto flex items-center gap-1 sm:order-6 sm:ml-0">
            <BulkAction icon={Heart} label={t("genv3.favSelected")} busy={bulkBusy === "fav"}
              disabled={!!bulkBusy} onClick={favoriteSelected} testId="fav" />
            <BulkAction icon={Trash2} label={t("genv3.deleteSelected")} busy={bulkBusy === "del"}
              disabled={!!bulkBusy} onClick={deleteSelected} danger testId="delete" />
            <button type="button" onClick={downloadSelected} disabled={zipping || !!bulkBusy} data-download-selected
              title={t("genv3.downloadSelected")} aria-label={`${t("genv3.downloadSelected")} (${chosen.length})`}
              className={cn("cta flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold",
                (zipping || !!bulkBusy) && "cursor-not-allowed opacity-50")}>
              {zipping ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />}
              <span className="hidden sm:inline">{zipping ? t("genv3.downloadPreparing") : t("genv3.downloadSelected")}</span>
              <span className="tabular-nums">{chosen.length}</span>
            </button>
            <button type="button" onClick={exitSelection} aria-label={t("genv3.selectOff")} title={t("genv3.selectOff")}
              className="hidden h-9 w-9 items-center justify-center rounded-xl text-faint transition-colors hover:bg-raised hover:text-ink sm:flex">
              <X size={15} aria-hidden />
            </button>
          </span>
        </div>
      )}

      {merged.length === 0 && pendingCount === 0 && !loading ? (
        <div className="panel rounded-2xl px-6 py-14 text-center">
          <Sparkles size={22} aria-hidden className="mx-auto mb-3 text-faint" />
          <p className="font-display text-[15px] font-semibold">
            {isDefault ? emptyTitle ?? t("genv3.emptyTitle") : t("genv3.emptyFiltered")}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted">
            {isDefault ? emptyBody ?? t("genv3.emptyBody") : t("genv3.emptyFilteredBody")}
          </p>
        </div>
      ) : view === "grid" ? (
        // Density is a REAL layout change, not a transform: the tracks are
        // auto-filled from a minimum card width, so the column count follows
        // the slider AND the width the gallery column actually has. Nothing
        // remounts, so scroll position and loaded images survive a change.
        <div
          className="grid gap-1 [&>*]:min-w-0"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${DENSITY_STEPS[density]}px), 1fr))` }}
        >
          {Array.from({ length: pendingCount }, (_, i) => (
            <div key={`pending-${i}`} className="skeleton rounded-xl" style={{ aspectRatio: skeletonRatio }} />
          ))}
          {merged.map((item) => (
            <GalleryCard
              key={item.assetId}
              item={item}
              compact={density <= 1}
              canRegenerate={models.length > 0}
              selecting={selecting}
              picked={picked.has(item.assetId)}
              onPick={() => togglePick(item.assetId)}
              onOpen={() => setDetailsId(item.assetId)}
              onRegenerate={() => setRegenItem(item)}
              onDownload={() => void download(item)}
              onFavorite={() => toggleFavorite(item)}
              onDelete={() => remove(item)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {merged.map((item) => (
            // A row, not one big button: it carries its own favourite toggle,
            // and a button inside a button is invalid markup.
            <div key={item.assetId}
              data-gallery-row data-picked={picked.has(item.assetId) || undefined}
              className={cn("flex w-full items-center gap-3 rounded-xl border bg-surface/60 p-2 transition-colors hover:bg-raised",
                picked.has(item.assetId) ? "border-[rgb(var(--accent)/0.6)] bg-accent-soft/20" : "border-line")}>
              <button type="button"
                onClick={() => selecting ? togglePick(item.assetId) : setDetailsId(item.assetId)}
                aria-pressed={selecting ? picked.has(item.assetId) : undefined}
                aria-label={selecting ? t("genv3.selectCard") : t("genv3.openImage")}
                className="flex min-w-0 flex-1 items-center gap-3 text-left">
                {selecting && (
                  <span aria-hidden className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-2 transition-colors",
                    picked.has(item.assetId) ? "bg-accent text-white ring-accent" : "ring-[rgb(var(--hairline)/calc(var(--hairline-alpha)*3))]")}>
                    {picked.has(item.assetId) && <Check size={11} strokeWidth={3} />}
                  </span>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.thumbUrl} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13px] font-semibold">{item.product ?? t("genv3.noProduct")}</span>
                    {item.fresh && <span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] font-bold uppercase text-white">{t("genv3.newBadge")}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-faint">
                    {[item.model, item.ratio, item.sessionType ? t(item.sessionType === "advertising" ? "genv3.sessionAd" : "genv3.sessionLife") : null]
                      .filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="hidden shrink-0 text-[11px] tabular-nums text-faint sm:block">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </button>
              <button type="button" data-row-favorite
                onClick={() => toggleFavorite(item)}
                aria-pressed={item.favorite}
                title={item.favorite ? t("library.unfavorite") : t("library.favorite")}
                aria-label={item.favorite ? t("library.unfavorite") : t("library.favorite")}
                className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                  item.favorite ? "text-accent hover:bg-accent-soft/50" : "text-faint hover:bg-raised hover:text-ink")}>
                <Heart size={14} aria-hidden fill={item.favorite ? "currentColor" : "none"} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div ref={sentinelRef} aria-hidden className="h-px" />
      {loading && (
        <p className="flex items-center justify-center gap-2 py-5 text-[12px] font-medium text-faint">
          <Loader2 size={13} className="animate-spin" aria-hidden />{t("common.loading")}
        </p>
      )}

      {(() => {
        const detailsIdx = detailsId ? merged.findIndex((i) => i.assetId === detailsId) : -1;
        return detailsIdx >= 0 ? (
        <ImageDetails
          items={merged}
          index={detailsIdx}
          onIndex={(i) => merged[i] && setDetailsId(merged[i].assetId)}
          onClose={() => setDetailsId(null)}
          canRegenerate={models.length > 0}
          onRegenerate={(item) => { setDetailsId(null); setRegenItem(item); }}
          onFavorite={toggleFavorite}
          onDelete={remove}
          onNote={(item, note) => mutate(item.generationId, { note })}
        />
        ) : null;
      })()}

      {regenItem && (
        <RegenerateModal
          item={regenItem}
          siblings={merged}
          models={models}
          balance={balance}
          onPick={setRegenItem}
          onClose={() => setRegenItem(null)}
          onDone={async (credits) => {
            onBalance((b) => Math.max(0, b - credits));
            setRegenItem(null);
            await onAbsorb(1);
          }}
        />
      )}
    </div>
  );
}

/* ── One image card ───────────────────────────────────────────────────── */

function GalleryCard({
  item, compact, canRegenerate, selecting, picked, onPick, onOpen, onRegenerate, onDownload, onFavorite, onDelete,
}: {
  item: GalleryItem;
  /** False where no engine can serve a retake (a tool's own gallery) — the
   *  action is then absent rather than present and broken. */
  canRegenerate: boolean;
  /** Contact-sheet densities: the card is barely bigger than the rail, so it
   *  carries only the two primary actions. */
  compact: boolean;
  selecting: boolean;
  picked: boolean;
  onPick: () => void;
  onOpen: () => void;
  onRegenerate: () => void;
  onDownload: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div data-gallery-card data-picked={picked || undefined}
      className={cn("group relative overflow-hidden rounded-xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]",
        picked && "ring-2 ring-accent")}>
      {/* In selection mode the whole card is the tick target. */}
      <button type="button" onClick={selecting ? onPick : onOpen}
        aria-label={selecting ? t("genv3.selectCard") : t("genv3.openImage")}
        aria-pressed={selecting ? picked : undefined}
        className="block w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.thumbUrl} alt={item.product ?? ""} loading="lazy" decoding="async"
          className={cn("aspect-square w-full object-cover transition-transform duration-300",
            !selecting && "group-hover:scale-[1.02]", picked && "scale-[0.94] rounded-lg")} />
      </button>
      {/* THE TICK — on hover and focus outside selection mode, always while
          selecting or picked. Ticking a card outside the mode enters it.
          `pointer-events-none` while invisible is not cosmetic: opacity keeps
          a control clickable, and a phone has no hover to reveal it, so a tap
          near the thumbnail's corner used to enter selection mode instead of
          opening the image — a hit target nobody could see. */}
      <button type="button" role="checkbox" aria-checked={picked} aria-label={t("genv3.selectCard")} data-pick
        onClick={(e) => { e.stopPropagation(); onPick(); }}
        className={cn(
          "absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full ring-2 transition-all duration-150",
          picked ? "bg-accent text-white ring-accent" : "bg-black/45 text-white/85 ring-white/60 backdrop-blur hover:bg-black/65",
          selecting || picked
            ? "opacity-100"
            : "pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
        )}>
        {picked && <Check size={13} strokeWidth={3} aria-hidden />}
      </button>
      {item.fresh && (
        <span className="absolute bottom-2 left-2 rounded-md bg-accent px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white shadow-e2">
          {t("genv3.newBadge")}
        </span>
      )}
      {item.favorite && !item.fresh && (
        <span aria-hidden className="absolute bottom-2 left-2 text-accent"><Heart size={14} fill="currentColor" /></span>
      )}
      {/* THE ACTION RAIL — a vertical glass column at the top-right instead
          of a kebab that hid every action behind a second click. `card-rail`
          (globals.css) reveals it on hover where hover exists and keeps it
          permanently visible where it does not, so a phone is not left
          tapping at nothing. */}
      {!selecting && (
        <div className={cn(
          "card-rail absolute right-2 top-2 z-10 flex flex-col items-center rounded-xl border border-white/15 bg-black/45 backdrop-blur-md transition-opacity duration-200",
          compact ? "gap-0.5 p-0.5" : "gap-1 p-1",
        )}>
          {/* Built as a list, then TRIMMED: at the contact-sheet densities the
              thumbnail is barely taller than the rail, so it keeps only its
              first two actions — and "first two" has to be computed from what
              this gallery actually offers, or a surface without a retake (a
              tool's own results) would be left showing one lonely button.
              Nothing is lost: everything lives in the image view a click
              away. No "open" button anywhere — the image is the way in. */}
          {[
            ...(canRegenerate ? [{ key: "regen", icon: RefreshCw, label: t("genv3.regen"), onClick: onRegenerate }] : []),
            {
              key: "fav", icon: Heart, onClick: onFavorite,
              label: item.favorite ? t("library.unfavorite") : t("library.favorite"),
              active: item.favorite, filled: item.favorite,
            },
            { key: "dl", icon: Download, label: t("common.download"), onClick: onDownload },
            { key: "del", icon: Trash2, label: t("common.delete"), onClick: onDelete, danger: true },
          ].slice(0, compact ? 2 : undefined).map((a) => (
            <CardAction key={a.key} icon={a.icon} label={a.label} onClick={a.onClick}
              danger={a.danger} active={a.active} filled={a.filled} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One button in a card's rail: icon only, its name in the tooltip. */
function CardAction({ icon: Icon, label, onClick, danger, active, filled, compact }: {
  icon: typeof Download; label: string; onClick: () => void;
  danger?: boolean; active?: boolean; filled?: boolean; compact?: boolean;
}) {
  return (
    <button type="button" title={label} aria-label={label} data-card-action
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "flex items-center justify-center rounded-lg transition-colors",
        compact ? "h-6 w-6" : "h-7 w-7",
        danger ? "text-white/85 hover:bg-danger/80 hover:text-white"
          : active ? "text-accent hover:bg-white/15"
            : "text-white/85 hover:bg-white/15 hover:text-white",
      )}>
      <Icon size={13} aria-hidden fill={filled ? "currentColor" : "none"} />
    </button>
  );
}

/** One bulk action in the selection bar: icon, tooltip, busy spinner. */
function BulkAction({ icon: Icon, label, onClick, busy, disabled, danger, testId }: {
  icon: typeof Heart; label: string; onClick: () => void;
  busy?: boolean; disabled?: boolean; danger?: boolean; testId?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      data-bulk-action={testId}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-xl border border-line transition-colors",
        danger ? "text-muted hover:border-[rgb(var(--danger)/0.5)] hover:bg-danger/10 hover:text-danger"
          : "text-muted hover:border-[rgb(var(--accent)/0.5)] hover:bg-accent-soft/40 hover:text-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}>
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Icon size={14} aria-hidden />}
    </button>
  );
}

