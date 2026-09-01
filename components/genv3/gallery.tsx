"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download, Heart, LayoutGrid, List, Loader2, Megaphone, MoreVertical,
  RefreshCw, Search, Sparkles, Sun, Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { GalleryItem, GallerySessionType, GenModel } from "@/components/genv3/types";
import { ImageDetails } from "@/components/genv3/image-details";
import { RegenerateModal } from "@/components/genv3/regenerate";

type Filter = { session: GallerySessionType | "all"; fav: boolean; q: string; order: "desc" | "asc" };

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
  const [items, setItems] = useState<GalleryItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [regenItem, setRegenItem] = useState<GalleryItem | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
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

      {merged.length === 0 && pendingCount === 0 && !loading ? (
        <div className="panel rounded-2xl px-6 py-14 text-center">
          <Sparkles size={22} aria-hidden className="mx-auto mb-3 text-faint" />
          <p className="font-display text-[15px] font-semibold">{isDefault ? t("genv3.emptyTitle") : t("genv3.emptyFiltered")}</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted">
            {isDefault ? t("genv3.emptyBody") : t("genv3.emptyFilteredBody")}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: pendingCount }, (_, i) => (
            <div key={`pending-${i}`} className="skeleton rounded-xl" style={{ aspectRatio: skeletonRatio }} />
          ))}
          {merged.map((item, idx) => (
            <GalleryCard
              key={item.assetId}
              item={item}
              menuOpen={menuFor === item.assetId}
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
          {merged.map((item, idx) => (
            <button key={item.assetId} type="button" onClick={() => setDetailsId(item.assetId)}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface/60 p-2 text-left transition-colors hover:bg-raised">
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

function GalleryCard({ item, menuOpen, onMenu, onOpen, onRegenerate, onDownload, onFavorite, onDelete }: {
  item: GalleryItem;
  menuOpen: boolean;
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
    <div className="group relative overflow-hidden rounded-xl bg-sunken ring-1 ring-[rgb(var(--hairline)/var(--hairline-alpha))]">
      <button type="button" onClick={onOpen} aria-label={t("genv3.openImage")} className="block w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.thumbUrl} alt={item.product ?? ""} loading="lazy" decoding="async"
          className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
      </button>
      {item.fresh && (
        <span className="absolute left-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white shadow-e2">
          {t("genv3.newBadge")}
        </span>
      )}
      {item.favorite && !item.fresh && (
        <span className="absolute left-2 top-2 text-accent"><Heart size={14} fill="currentColor" aria-hidden /></span>
      )}
      <div className={cn(
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
      </div>
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
