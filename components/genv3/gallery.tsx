"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check, Download, Heart, LayoutGrid, List, Loader2, Megaphone, Minus, MoreVertical,
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
  models, balance, onBalance, onAbsorb,
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
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>({ session: "all", fav: false, q: "", order: "desc" });
  const [view, setView] = useState<"grid" | "list">("grid");
  // Presentation only — remembered per browser, never a round trip.
  const [density, setDensity] = useState(DENSITY_DEFAULT);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(DENSITY_KEY));
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
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // ── Multi-select ───────────────────────────────────────────────────────
  // A MODE, as in the Library: enter it from the toolbar or by ticking any
  // card, tap cards to toggle, leave with Anuluj or Escape. Keyed by asset
  // id because that is what a card is. Several picks download as ONE ZIP
  // through the Library's endpoint (it verifies every path against this
  // workspace's own assets); a single pick saves the file itself.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [zipping, setZipping] = useState(false);
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
    p.set("limit", "24");
    return `/api/generations?${p.toString()}`;
  }, []);

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

  function download(item: GalleryItem) {
    window.open(item.url, "_blank", "noopener");
  }

  const chips: { key: Filter["session"]; label: string; icon?: typeof Megaphone }[] = [
    { key: "all", label: t("genv3.filterAll"), icon: Sparkles },
    { key: "advertising", label: t("genv3.sessionAd"), icon: Megaphone },
    { key: "lifestyle", label: t("genv3.sessionLife"), icon: Sun },
  ];

  const skeletonRatio = pendingRatio.includes(":") ? pendingRatio.replace(":", "/") : "1/1";

  return (
    <div className="min-w-0">
      <h2 className="mb-2.5 font-display text-lg font-semibold tracking-tight">{t("genv3.galleryTitle")}</h2>

      {/* ONE toolbar row: session chips on the left, view/search/filter/sort
          on the right, every control the same 36px height on a shared centre
          line. Below `lg` the two groups wrap onto their own rows instead of
          being squeezed. */}
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="thin-scroll -mx-1 order-2 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 pb-0.5 lg:order-1">
          {chips.map((c) => {
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

      {/* SELECTION BAR — count, select all / none, the download, and the way
          out. On desktop it sticks to the top of the gallery's own scroller
          so the action stays reachable deep in a long history. */}
      {selecting && (
        // Sticky on EVERY size: on a phone the page itself scrolls, so a bar
        // that only stuck from `lg` left the customer scrolling back up
        // through pages of history to reach "Pobierz wybrane". Below `lg` it
        // parks under the app header (which is sticky at z-40, so the offset
        // has to clear it); on desktop it sticks to the top of the gallery's
        // own scroller, where there is no header in the way.
        <div data-select-bar
          className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top)+0.25rem)] z-20 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--surface))] px-2.5 py-2 shadow-e2 lg:top-0">
          {/* Phones: count + close on the first line, the two toggles on the
              second, the download full-width beneath. From `sm` up it is one
              line with the close at the far end. */}
          <span className="order-1 px-1 text-[12.5px] font-semibold tabular-nums" data-selected-count>
            {t("genv3.selectedCount", { n: chosen.length })}
          </span>
          <button type="button" onClick={exitSelection} aria-label={t("genv3.selectOff")} title={t("genv3.selectOff")}
            className="order-2 ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-faint transition-colors hover:bg-raised hover:text-ink sm:order-7 sm:ml-0">
            <X size={15} aria-hidden />
          </button>
          {/* Forces the line break after the close button on phones. */}
          <span aria-hidden className="order-3 h-0 basis-full sm:hidden" />
          <span aria-hidden className="hidden h-4 w-px bg-line sm:order-2 sm:mx-0.5 sm:block" />
          <button type="button" onClick={selectAll} disabled={merged.length === 0} data-select-all
            className="order-4 h-8 rounded-lg px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 sm:order-3">
            {t("genv3.selectAll")}
          </button>
          <button type="button" onClick={() => setPicked(new Set())} disabled={chosen.length === 0} data-select-none
            className="order-5 h-8 rounded-lg px-2.5 text-[12px] font-semibold text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 sm:order-4">
            {t("genv3.selectNone")}
          </button>
          <span className="hidden sm:order-5 sm:block sm:flex-1" />
          <button type="button" onClick={downloadSelected} disabled={chosen.length === 0 || zipping} data-download-selected
            className={cn("cta order-6 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-semibold sm:order-6 sm:w-auto",
              (chosen.length === 0 || zipping) && "cursor-not-allowed opacity-50")}>
            {zipping ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />}
            <span>{zipping ? t("genv3.downloadPreparing") : t("genv3.downloadSelected")}</span>
            {!zipping && chosen.length > 0 && <span className="tabular-nums opacity-80">({chosen.length})</span>}
          </button>
        </div>
      )}

      {merged.length === 0 && pendingCount === 0 && !loading ? (
        <div className="panel rounded-2xl px-6 py-14 text-center">
          <Sparkles size={22} aria-hidden className="mx-auto mb-3 text-faint" />
          <p className="font-display text-[15px] font-semibold">{isDefault ? t("genv3.emptyTitle") : t("genv3.emptyFiltered")}</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted">
            {isDefault ? t("genv3.emptyBody") : t("genv3.emptyFilteredBody")}
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
              menuOpen={menuFor === item.assetId}
              selecting={selecting}
              picked={picked.has(item.assetId)}
              onPick={() => togglePick(item.assetId)}
              onMenu={(open) => setMenuFor(open ? item.assetId : null)}
              onOpen={() => setDetailsId(item.assetId)}
              onRegenerate={() => setRegenItem(item)}
              onDownload={() => download(item)}
              onFavorite={() => toggleFavorite(item)}
              onDelete={() => remove(item)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {merged.map((item) => (
            <button key={item.assetId} type="button"
              onClick={() => selecting ? togglePick(item.assetId) : setDetailsId(item.assetId)}
              aria-pressed={selecting ? picked.has(item.assetId) : undefined}
              data-gallery-row data-picked={picked.has(item.assetId) || undefined}
              className={cn("flex w-full items-center gap-3 rounded-xl border bg-surface/60 p-2 text-left transition-colors hover:bg-raised",
                picked.has(item.assetId) ? "border-[rgb(var(--accent)/0.6)] bg-accent-soft/20" : "border-line")}>
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
              <span className="shrink-0 text-[11px] tabular-nums text-faint">
                {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </button>
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
  item, menuOpen, selecting, picked, onPick, onMenu, onOpen, onRegenerate, onDownload, onFavorite, onDelete,
}: {
  item: GalleryItem;
  menuOpen: boolean;
  selecting: boolean;
  picked: boolean;
  onPick: () => void;
  onMenu: (open: boolean) => void;
  onOpen: () => void;
  onRegenerate: () => void;
  onDownload: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  // Close on any press outside the menu — scrolling past a card with an
  // open menu must not leave it floating.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onMenu(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen, onMenu]);
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
        <span className="absolute bottom-2 left-2 text-accent"><Heart size={14} fill="currentColor" aria-hidden /></span>
      )}
      {!selecting && <div className={cn(
        "absolute right-2 top-2 flex items-center gap-1.5 transition-opacity duration-200",
        menuOpen ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
      )}>
        <button type="button" aria-label={t("genv3.regen")} title={t("genv3.regen")}
          onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75">
          <RefreshCw size={13} aria-hidden />
        </button>
        <div className="relative" ref={menuRef}>
          <button type="button" aria-label={t("common.actions")} aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); onMenu(!menuOpen); }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75">
            <MoreVertical size={13} aria-hidden />
          </button>
          {menuOpen && (
            <div className="panel absolute right-0 top-9 z-20 w-44 rounded-xl p-1 shadow-e3" onClick={(e) => e.stopPropagation()}>
              <CardMenuItem icon={Sparkles} label={t("genv3.open")} onClick={() => { onMenu(false); onOpen(); }} />
              <CardMenuItem icon={RefreshCw} label={t("genv3.regen")} onClick={() => { onMenu(false); onRegenerate(); }} />
              <CardMenuItem icon={Download} label={t("common.download")} onClick={() => { onMenu(false); onDownload(); }} />
              <CardMenuItem icon={Heart} label={item.favorite ? t("library.unfavorite") : t("library.favorite")}
                onClick={() => { onMenu(false); onFavorite(); }} />
              <CardMenuItem icon={Trash2} label={t("common.delete")} danger onClick={() => { onMenu(false); onDelete(); }} />
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}

function CardMenuItem({ icon: Icon, label, onClick, danger }: {
  icon: typeof Download; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors hover:bg-sunken",
        danger ? "text-danger" : "text-ink")}>
      <Icon size={13} aria-hidden className={danger ? "text-danger" : "text-muted"} />
      {label}
    </button>
  );
}
