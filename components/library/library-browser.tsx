"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownAZ, Check, ChevronDown, Download, Film, Heart, Image as ImageIcon,
  LayoutGrid, List, Loader2, Maximize2, Play, SlidersHorizontal, Trash2, Wrench, X,
} from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import type { GalleryItem, GalleryPage } from "@/lib/server/gallery";
import { libraryKey, patchLibrary, readLibrary, writeLibrary } from "@/lib/library-cache";
import { ImageDetails } from "@/components/genv3/image-details";
import { saveBlob, saveImageFrom, stamp } from "@/lib/save-image";
import { cn } from "@/lib/utils";

/**
 * BIBLIOTEKA — the asset manager.
 *
 * ONE DATA LAYER, NOT A SECOND ONE. Everything here is the same projection the
 * generator's gallery reads (`lib/server/gallery.ts`) through the same
 * endpoint (`/api/generations`): keyset-paginated, prompt-safe, and already
 * signing a small derivative beside every original. The library used to have
 * its own query — `listAssets`, sixty rows, no cursor — which signed and
 * shipped every full-size render in the workspace on every visit. That query
 * is gone; nothing about generations, credits or permissions moved with it.
 *
 * WHAT MAKES IT FEEL INSTANT, in the order it matters:
 *   · The grid loads `thumbUrl` — a 640px WebP of about 50KB — where it used
 *     to load the original, which is megabytes. Everything else is arithmetic
 *     next to that.
 *   · The first page is rendered on the server into the HTML, so the shelf is
 *     on screen before any JavaScript asks a question.
 *   · Pages after that arrive when the sentinel below the grid comes into
 *     view, 24 at a time.
 *   · Leaving and coming back paints from `lib/library-cache` — the pages
 *     already fetched, the scroll offset, no spinner — and revalidates the
 *     first page behind it.
 *   · A favourite, a delete or a selection patches the item in place. None of
 *     them refetches the collection.
 *
 * EVERY TILE RESERVES ITS BOX before the picture exists, so nothing below it
 * moves when one arrives.
 */

type View = "grid" | "list";
type Order = "desc" | "asc";
type Shelf = "image" | "video";

/** Tile widths the density control steps through, narrow to wide. */
const DENSITY = [132, 168, 210, 260, 320] as const;
const DEFAULT_DENSITY = 2;

/** How many missing derivatives one visit asks the server to make. */
const BACKFILL_BATCH = 6;

/**
 * Merge a freshly fetched page one over what the session already had: the
 * fresh rows lead (newest first, freshly signed), and everything the session
 * had paged past that the fresh page does not mention keeps its place behind
 * them. Replacing outright would throw away deep pagination and strand the
 * customer in blank space below the end of a 24-item grid.
 */
function mergeHead(fresh: GalleryItem[], old: GalleryItem[]): GalleryItem[] {
  const head = new Set(fresh.map((i) => i.assetId));
  return [...fresh, ...old.filter((i) => !head.has(i.assetId))];
}

/** What one page costs. Enough to fill a 2560px monitor's first screen. */
const PAGE = 24;

/** The one shelf the server renders into the HTML: photos, newest first. */
const SERVER_KEY = libraryKey({ type: "image", fav: false, order: "desc" });

export function LibraryBrowser({ first, locale }: { first: GalleryPage; locale: string }) {
  const { t } = useI18n();

  const [shelf, setShelf] = useState<Shelf>("image");
  const [view, setView] = useState<View>("grid");
  const [density, setDensity] = useState(DEFAULT_DENSITY);
  const [favOnly, setFavOnly] = useState(false);
  const [order, setOrder] = useState<Order>("desc");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [items, setItems] = useState<GalleryItem[]>(first.items);
  const [cursor, setCursor] = useState<string | null>(first.nextCursor);
  const [loading, setLoading] = useState(false);
  const [booted, setBooted] = useState(false);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<GalleryItem | null>(null);

  const sentinel = useRef<HTMLDivElement>(null);
  const seenKey = useRef<string>("");
  /** Assets this session has already asked to have a derivative made for. */
  const tried = useRef<Set<string>>(new Set());
  /** True while a backfill run is in flight, so a re-render cannot start a second. */
  const backfilling = useRef(false);

  const key = libraryKey({ type: shelf, fav: favOnly, order });
  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  const url = useCallback((from: string | null) => {
    const p = new URLSearchParams({ limit: String(PAGE), type: shelf, order });
    if (favOnly) p.set("fav", "1");
    if (from) p.set("cursor", from);
    return `/api/generations?${p}`;
  }, [shelf, favOnly, order]);

  /**
   * SWITCHING SHELVES, and coming back to one.
   *
   * Three cases, and only one of them touches the network:
   *   · the default photo shelf — the server already rendered it, so its
   *     fresh page one is merged over the session's cache and nothing is
   *     fetched at all;
   *   · a shelf the session has seen — painted from cache immediately, then
   *     revalidated underneath and merged, so the grid never goes blank;
   *   · a shelf never seen — one fetch, with skeletons while it runs.
   *
   * In none of them does the customer watch an empty grid that used to have
   * their work in it.
   */
  useEffect(() => {
    if (seenKey.current === key) return;
    seenKey.current = key;

    const cached = readLibrary(key);
    const restore = (y: number) => {
      if (y) requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
    };

    /**
     * THE SERVER RENDER *IS* A FRESH PAGE ONE.
     *
     * /library is a dynamic route, so arriving here — by link, by Back, by
     * anything — has already cost one `listGalleryItems` and one signing
     * round trip, and `first` is the result. Fetching page one again from the
     * client would be the same twenty-four rows a second time, for nothing.
     * So the default shelf revalidates from the props it was handed.
     */
    if (key === SERVER_KEY) {
      // Merge, never replace: a session that paged to item 120 keeps its
      // tail (and its cursor, and its scroll position) while the head is
      // refreshed with freshly signed URLs and anything generated since.
      const merged = cached ? mergeHead(first.items, cached.items) : first.items;
      const nextCursor = cached ? cached.cursor : first.nextCursor;
      const y = cached?.scrollY ?? 0;
      setItems(merged);
      setCursor(nextCursor);
      writeLibrary(key, { items: merged, cursor: nextCursor, scrollY: y });
      restore(y);
      setBooted(true);
      return;
    }

    if (cached) {
      setItems(cached.items);
      setCursor(cached.cursor);
      restore(cached.scrollY);
      setBooted(true);
    } else {
      setItems([]);
      setCursor(null);
      setLoading(true);
    }

    // Stale-while-revalidate for every other shelf: what the session already
    // has is on screen while this runs, and the result is merged into its
    // head the same way, so paging work survives the refresh.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url(null), { cache: "no-store" });
        const json = await res.json() as { ok: boolean; items?: GalleryItem[]; nextCursor?: string | null };
        if (cancelled || !json.ok || !json.items) return;
        setItems((prev) => {
          const merged = prev.length > 0 ? mergeHead(json.items!, prev) : json.items!;
          writeLibrary(key, {
            items: merged,
            cursor: prev.length > 0 ? (readLibrary(key)?.cursor ?? json.nextCursor ?? null) : json.nextCursor ?? null,
            scrollY: window.scrollY,
          });
          return merged;
        });
        if (!cached) setCursor(json.nextCursor ?? null);
      } catch { /* the cached view stays on screen */ }
      finally { if (!cancelled) { setLoading(false); setBooted(true); } }
    })();
    return () => { cancelled = true; };
  }, [key, url, first]);

  /** The next page, when the end of the list comes into view. */
  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(url(cursor), { cache: "no-store" });
      const json = await res.json() as { ok: boolean; items?: GalleryItem[]; nextCursor?: string | null };
      if (json.ok && json.items) {
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.assetId));
          const next = [...prev, ...json.items!.filter((i) => !seen.has(i.assetId))];
          writeLibrary(key, { items: next, cursor: json.nextCursor ?? null, scrollY: window.scrollY });
          return next;
        });
        setCursor(json.nextCursor ?? null);
      }
    } catch { /* the sentinel will try again on the next intersection */ }
    finally { setLoading(false); }
  }, [cursor, loading, url, key]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;
    // 600px of lead time: the next page is usually there before the customer
    // reaches the bottom, which is the difference between "infinite" and
    // "loads when I stop".
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  /** Remember where they were, so coming back is coming back. */
  useEffect(() => {
    const save = () => writeLibrary(key, { items, cursor, scrollY: window.scrollY });
    window.addEventListener("pagehide", save);
    return () => { save(); window.removeEventListener("pagehide", save); };
  }, [key, items, cursor]);

  /**
   * THE DERIVATIVE BACKFILL, for what is actually on screen.
   *
   * Assets made before the generator wrote thumbnails have none, and the grid
   * falls back to the original for those — the old behaviour, megabytes a
   * tile. Rather than a migration over a history nobody may ever open, the
   * first few such items in the current page are handed to
   * `/api/library/thumb` one at a time, after the page has painted. Six at a
   * time, sequential, and only ever for items already fetched: it is a trickle
   * that costs the customer nothing and makes the next visit fast.
   */
  useEffect(() => {
    if (!booted) return;
    // The queue lives in a ref, and every asset is attempted ONCE per session.
    // Reading `items` in the dependency array instead would re-arm this effect
    // on its own `setItems` — cancelling the loop after each success and
    // restarting it — which turns "a few, after paint" into an unbounded
    // one-at-a-time trickle with a full re-render per thumbnail.
    const queue = items.filter((i) =>
      !i.hasThumb && i.assetType === "image" && !tried.current.has(i.assetId));
    if (queue.length === 0 || backfilling.current) return;
    backfilling.current = true;

    let cancelled = false;
    void (async () => {
      try {
        for (const item of queue.slice(0, BACKFILL_BATCH)) {
          if (cancelled) return;
          tried.current.add(item.assetId);
          try {
            const res = await fetch("/api/library/thumb", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assetId: item.assetId }),
            });
            const json = await res.json() as { ok: boolean; url?: string | null; previewUrl?: string | null };
            if (cancelled || !json.ok || !json.url) continue;
            setItems((prev) => prev.map((i) => i.assetId === item.assetId
              ? { ...i, thumbUrl: json.url!, hasThumb: true, previewUrl: json.previewUrl ?? i.previewUrl }
              : i));
          } catch { /* the original is still on screen; try again next visit */ }
        }
      } finally { backfilling.current = false; }
    })();
    return () => { cancelled = true; backfilling.current = false; };
  }, [booted, items]);

  /* ── acting on items ───────────────────────────────────────────────────── */

  const togglePick = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** Favourite is per GENERATION — every asset of it moves together, which is
   *  what the RPC does and what the heart has always meant here. */
  async function toggleFavorite(item: GalleryItem) {
    const next = !item.favorite;
    const apply = (list: GalleryItem[]) =>
      list.map((i) => (i.generationId === item.generationId ? { ...i, favorite: next } : i));
    setItems(apply);
    patchLibrary(apply);
    const { error } = await createClient().rpc("set_generation_favorite", { gen_id: item.generationId, value: next });
    if (error) {
      const undo = (list: GalleryItem[]) =>
        list.map((i) => (i.generationId === item.generationId ? { ...i, favorite: !next } : i));
      setItems(undo);
      patchLibrary(undo);
      toast.error(t("common.error"));
      return;
    }
    // A favourites-only view drops what was just un-starred, without asking
    // the server for the shelf again.
    if (favOnly && !next) setItems((list) => list.filter((i) => i.generationId !== item.generationId));
  }

  /**
   * DELETING IS PER GENERATION, because that is what the database offers:
   * `delete_generation` is the definer RPC that checks membership, removes the
   * rows and hands back the storage paths. There is no per-asset primitive,
   * and inventing one here would mean a second deletion path with its own
   * permission story.
   *
   * So a selection is resolved to the DISTINCT generations behind it and each
   * is deleted once — and the confirmation says plainly that the other images
   * from the same generation go with it, because they do.
   */
  async function removeSelected() {
    if (picked.size === 0 || busy) return;
    const gens = [...new Set(items.filter((i) => picked.has(i.assetId)).map((i) => i.generationId))];
    await removeGenerations(gens);
  }

  /** The details view deletes the one image it is showing — the same
   *  per-generation primitive, for a selection of exactly one. */
  async function removeOne(item: GalleryItem) {
    if (busy) return;
    setPreview(null);
    await removeGenerations([item.generationId]);
  }

  async function removeGenerations(gens: string[]) {
    if (gens.length === 0 || busy) return;
    if (!window.confirm(t("library.confirmDelete"))) return;
    setBusy(true);
    try {
      const done: string[] = [];
      for (const generationId of gens) {
        const res = await fetch("/api/generations/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId }),
        });
        if (res.ok) done.push(generationId);
      }
      if (done.length === 0) { toast.error(t("common.error")); return; }
      const gone = new Set(done);
      const apply = (list: GalleryItem[]) => list.filter((i) => !gone.has(i.generationId));
      // The removed items leave every cached view too, so going to another
      // shelf and back cannot resurrect them.
      setItems(apply);
      patchLibrary(apply);
      setPicked(new Set());
      toast.success(t("library.deleted", { n: done.length }));
      if (done.length < gens.length) toast.error(t("common.error"));
    } catch { toast.error(t("common.error")); }
    finally { setBusy(false); }
  }

  /** ONE IMAGE. The share sheet on a phone, a real download everywhere else —
   *  and never a trip to the storage host. */
  async function downloadOne(item: GalleryItem) {
    try {
      // No toast on success: a share sheet that closed, or a file that
      // landed in Downloads, is its own confirmation.
      await saveImageFrom(item.url, { seed: item.product ?? item.model });
    } catch { toast.error(t("genv3.downloadFailed")); }
  }

  async function downloadSelected() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    try {
      const paths = items.filter((i) => picked.has(i.assetId)).map((i) => i.path);
      const res = await fetch("/api/library/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      if (!res.ok) { toast.error(t("common.error")); return; }
      await saveBlob(await res.blob(), `grovbase-${stamp()}.zip`);
      setPicked(new Set());
    } catch { toast.error(t("common.error")); }
    finally { setBusy(false); }
  }

  /* ── the toolbar ───────────────────────────────────────────────────────── */

  const tile = DENSITY[density];
  const empty = booted && !loading && items.length === 0;

  return (
    <div className="min-w-0">
      {/* THE BAR. Left: what you are looking at and how. Right: what you have
          picked and how it is ordered. On a phone the same two halves stack
          into one scroll-free row of compact controls. */}
      <div data-library-toolbar
        className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4 sm:gap-2.5">
        <Segmented
          options={[
            { key: "image", label: t("library.photos"), icon: ImageIcon },
            { key: "video", label: t("library.videos"), icon: Film },
          ]}
          value={shelf}
          onChange={(v) => { setShelf(v as Shelf); setPicked(new Set()); }}
        />

        <Segmented
          compact
          options={[
            { key: "grid", label: t("library.viewGrid"), icon: LayoutGrid, iconOnly: true },
            { key: "list", label: t("library.viewList"), icon: List, iconOnly: true },
          ]}
          value={view}
          onChange={(v) => setView(v as View)}
        />

        {/* DENSITY — the mockup's slider. Hidden on a phone, where two columns
            is the only sensible answer and a slider is a control nobody asked
            for taking the width of the screen. */}
        {view === "grid" && (
          <div className="hidden items-center gap-2 rounded-xl border border-line bg-sunken/60 px-2.5 py-1.5 md:flex">
            <LayoutGrid size={13} aria-hidden className="shrink-0 text-faint" />
            <input
              type="range"
              min={0}
              max={DENSITY.length - 1}
              step={1}
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
              aria-label={t("library.density")}
              className="gb-range h-1 w-24 cursor-pointer appearance-none rounded-full bg-[rgb(var(--ink)/0.14)] lg:w-28"
            />
            <LayoutGrid size={16} aria-hidden className="shrink-0 text-faint" />
          </div>
        )}

        <span className="flex-1" />

        {/* The count only exists once there is something to count — on every
            width, not just on a phone. */}
        {picked.size > 0 && (
          <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-[rgb(var(--accent)/0.35)] bg-[rgb(var(--accent)/0.12)] px-3 text-[12.5px] font-semibold text-ink">
            {t("library.selected", { n: picked.size })}
            <button type="button" onClick={() => setPicked(new Set())}
              aria-label={t("library.clearSelection")}
              className="-mr-1 flex h-6 w-6 items-center justify-center rounded-lg text-muted transition-colors hover:text-ink">
              <X size={13} aria-hidden />
            </button>
          </span>
        )}

        <button
          type="button"
          onClick={() => { setFavOnly((v) => !v); setPicked(new Set()); }}
          aria-pressed={favOnly}
          title={t("library.onlyFavorites")}
          aria-label={t("library.onlyFavorites")}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200",
            favOnly
              ? "border-[rgb(var(--accent)/0.45)] bg-[rgb(var(--accent)/0.14)] text-accent"
              : "border-line bg-sunken/60 text-muted hover:text-ink",
          )}
        >
          <Heart size={15} aria-hidden fill={favOnly ? "currentColor" : "none"} />
        </button>

        <label className="relative hidden h-9 items-center sm:flex">
          <span className="sr-only">{t("library.sort")}</span>
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value as Order)}
            className="h-9 appearance-none rounded-xl border border-line bg-sunken/60 pl-3 pr-8 text-[12.5px] font-semibold text-ink outline-none transition-colors hover:border-[rgb(var(--accent)/0.35)]"
          >
            <option value="desc">{t("library.sortNewest")}</option>
            <option value="asc">{t("library.sortOldest")}</option>
          </select>
          <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 text-faint" />
        </label>

        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          title={t("library.filters")}
          aria-label={t("library.filters")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-sunken/60 text-muted transition-colors duration-200 hover:text-ink"
        >
          <SlidersHorizontal size={15} aria-hidden />
        </button>
      </div>

      {/* BULK ACTIONS appear with the selection and take no room without it. */}
      {picked.size > 0 && (
        <div className="animate-fade mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadSelected} disabled={busy}
            className={cn("cta inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12.5px] font-semibold", busy && "opacity-60")}>
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
            {t("library.zip", { n: picked.size })}
          </button>
          <button type="button" onClick={removeSelected} disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-[rgb(var(--danger)/0.4)] bg-[rgb(var(--danger)/0.10)] px-3.5 text-[12.5px] font-semibold text-danger transition-colors hover:bg-[rgb(var(--danger)/0.16)]">
            <Trash2 size={14} aria-hidden />
            {t("library.deleteMany", { n: picked.size })}
          </button>
        </div>
      )}

      {/* THE GRID — `.library-grid` in globals.css, driven by `--tile`.
          `auto-fill` with a minimum tile is what makes this adaptive without a
          single hard-coded column count: the browser fits as many columns of
          at least `--tile` as the width allows, at every viewport and every
          density step. A phone is the one deliberate exception — see the rule
          for why two columns are pinned there. */}
      {empty ? (
        <EmptyShelf shelf={shelf} favOnly={favOnly} t={t} />
      ) : view === "grid" ? (
        <div
          className="library-grid grid gap-2 sm:gap-2.5"
          style={{ "--tile": `${tile}px` } as React.CSSProperties}
        >
          {items.map((item) => (
            <Tile
              key={item.assetId}
              item={item}
              picked={picked.has(item.assetId)}
              onPick={() => togglePick(item.assetId)}
              onOpen={() => setPreview(item)}
              onFavorite={() => toggleFavorite(item)}
              onDownload={() => void downloadOne(item)}
              t={t}
            />
          ))}
          {loading && Array.from({ length: 8 }, (_, i) => (
            <div key={`sk-${i}`} className="skeleton aspect-square rounded-xl" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {items.map((item) => (
            <Row
              key={item.assetId}
              item={item}
              picked={picked.has(item.assetId)}
              onPick={() => togglePick(item.assetId)}
              onOpen={() => setPreview(item)}
              onFavorite={() => toggleFavorite(item)}
              when={fmt.format(new Date(item.createdAt))}
              t={t}
            />
          ))}
        </ul>
      )}

      {/* The end of the list, and the trigger for the next page. */}
      <div ref={sentinel} className="h-px w-full" aria-hidden />
      {cursor ? (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loading}
            className="plate inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-muted transition-colors hover:text-ink">
            {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {loading ? t("library.loading") : t("library.loadMore")}
          </button>
        </div>
      ) : items.length > 0 ? (
        <p className="mt-5 text-center text-[12px] text-faint">{t("library.endOfList")}</p>
      ) : null}

      {filtersOpen && (
        <FilterSheet
          t={t}
          order={order}
          favOnly={favOnly}
          onOrder={setOrder}
          onFav={setFavOnly}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {/* ONE DETAILS VIEW FOR THE WHOLE PRODUCT. The library used to open a
          bare lightbox of its own while the generator opened the real thing —
          two answers to "show me this image", and the poorer one on the page
          named after the collection. This is the same component, handed the
          shelf the customer is looking at, so arrows walk the grid they came
          from.

          `canRegenerate` is false here and that is deliberate: a retake needs
          the model catalogue, a price and the regeneration modal, all of
          which live in the generator. A button that cannot do its job is
          worse than no button. */}
      {preview && (() => {
        const idx = items.findIndex((i) => i.assetId === preview.assetId);
        return idx < 0 ? null : (
          <ImageDetails
            items={items}
            index={idx}
            onIndex={(i) => items[i] && setPreview(items[i])}
            onClose={() => setPreview(null)}
            canRegenerate={false}
            onRegenerate={() => { /* not offered from the library — see above */ }}
            // The details view speaks the generator's narrower item type, so
            // each callback resolves back to the library's own row before
            // acting on it. Same asset, the shape this component owns.
            onFavorite={(g) => { const full = items.find((i) => i.assetId === g.assetId); if (full) void toggleFavorite(full); }}
            onDelete={(g) => { const full = items.find((i) => i.assetId === g.assetId); if (full) void removeOne(full); }}
            onNote={(item, note) => {
              const apply = (list: GalleryItem[]) =>
                list.map((i) => (i.generationId === item.generationId ? { ...i, note } : i));
              setItems(apply);
              patchLibrary(apply);
              setPreview((p) => (p ? { ...p, note } : p));
            }}
          />
        );
      })()}
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

type T = (k: string, v?: Record<string, string | number>) => string;

/** The bar's switches: one shape for both, so the row reads as one control
 *  strip rather than as a collection of buttons that happen to be adjacent. */
function Segmented({ options, value, onChange, compact = false }: {
  options: { key: string; label: string; icon: typeof ImageIcon; iconOnly?: boolean }[];
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-xl border border-line bg-sunken/60 p-1", compact && "shrink-0")}>
      {options.map((o) => {
        const on = o.key === value;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={on}
            title={o.label}
            aria-label={o.iconOnly ? o.label : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-lg text-[12.5px] font-semibold transition-colors duration-200",
              o.iconOnly ? "w-8 justify-center" : "px-2.5 sm:px-3",
              on
                ? "bg-[rgb(var(--accent)/0.16)] text-ink ring-1 ring-[rgb(var(--accent)/0.42)]"
                : "text-muted hover:text-ink",
            )}
          >
            <Icon size={14} aria-hidden />
            {!o.iconOnly && <span className="hidden min-[400px]:inline">{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ONE TILE. Checkbox top-left, heart top-right, duration bottom-left on a
 * video, and — where there is a pointer — a vertical rail of actions that
 * appears on hover. Nothing is written across the picture: a library of
 * captions is a file listing, and this is meant to be looked at.
 */
function Tile({ item, picked, onPick, onOpen, onFavorite, onDownload, t }: {
  item: GalleryItem;
  picked: boolean;
  onPick: () => void;
  onOpen: () => void;
  onFavorite: () => void;
  onDownload: () => void;
  t: T;
}) {
  return (
    <div
      className={cn(
        "group relative aspect-square overflow-hidden rounded-xl border bg-raised transition-all duration-200",
        picked
          ? "border-[rgb(var(--accent)/0.75)] ring-2 ring-[rgb(var(--accent)/0.35)]"
          : "border-[rgb(var(--line)/0.16)] hover:border-[rgb(var(--accent)/0.35)]",
      )}
    >
      <button type="button" onClick={onOpen} aria-label={t("library.open")} className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </button>

      {/* SELECT. Always visible, the way an asset manager's is — a checkbox
          that only appears on hover is a checkbox a touch screen never has. */}
      <button
        type="button"
        onClick={onPick}
        role="checkbox"
        aria-checked={picked}
        aria-label={t("library.selectOn")}
        className={cn(
          "absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-[6px] border transition-colors duration-200",
          picked
            ? "border-accent bg-accent text-white"
            : "border-white/60 bg-black/35 text-transparent backdrop-blur-[2px] hover:border-white",
        )}
      >
        <Check size={12} strokeWidth={3.2} aria-hidden />
      </button>

      <button
        type="button"
        onClick={onFavorite}
        aria-pressed={item.favorite}
        aria-label={item.favorite ? t("library.unfavorite") : t("library.favorite")}
        className={cn(
          "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-lg transition-colors duration-200",
          item.favorite ? "text-accent" : "text-white/75 hover:text-white",
        )}
      >
        <Heart size={15} aria-hidden fill={item.favorite ? "currentColor" : "none"}
          className="drop-shadow-[0_1px_3px_rgb(0_0_0/0.55)]" />
      </button>

      {item.assetType === "video" && (
        <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-[2px]">
          <Play size={9} aria-hidden fill="currentColor" />
          {formatDuration(item.durationSec)}
        </span>
      )}

      {/* HOVER RAIL — pointer devices only. On touch the tile opens and the
          preview carries the same actions, which is one place instead of a
          rail that needs a long press to reach. */}
      <div className="pointer-events-none absolute right-2 top-10 hidden flex-col gap-1 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:hover)]:flex">
        <RailButton label={t("library.quickOpen")} onClick={onOpen}><Maximize2 size={13} /></RailButton>
        <RailButton label={t("common.download")} onClick={onDownload}><Download size={13} /></RailButton>
        <RailButton label={t("library.editAsset")} href="/tools"><Wrench size={13} /></RailButton>
      </div>
    </div>
  );
}

function RailButton({ children, label, onClick, href }: {
  children: React.ReactNode; label: string; onClick?: () => void; href?: string;
}) {
  const cls = "flex h-7 w-7 items-center justify-center rounded-lg bg-black/55 text-white ring-1 ring-white/25 backdrop-blur-[2px] transition-colors duration-200 hover:bg-black/75";
  return href ? (
    <a href={href} title={label} aria-label={label} target={href.startsWith("/") ? undefined : "_blank"}
      rel="noreferrer noopener" className={cls} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  ) : (
    <button type="button" title={label} aria-label={label} className={cls}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      {children}
    </button>
  );
}

/** The list view: the same items, one line each, for when the picture matters
 *  less than the date. */
function Row({ item, picked, onPick, onOpen, onFavorite, when, t }: {
  item: GalleryItem; picked: boolean; onPick: () => void; onOpen: () => void;
  onFavorite: () => void; when: string; t: T;
}) {
  return (
    <li className={cn("flex items-center gap-3 px-2.5 py-2 transition-colors", picked ? "bg-[rgb(var(--accent)/0.08)]" : "hover:bg-raised/60")}>
      <button type="button" onClick={onPick} role="checkbox" aria-checked={picked}
        aria-label={t("library.selectOn")}
        className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
          picked ? "border-accent bg-accent text-white" : "border-line text-transparent hover:border-[rgb(var(--accent)/0.6)]")}>
        <Check size={12} strokeWidth={3.2} aria-hidden />
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.thumbUrl} alt="" loading="lazy" decoding="async"
          className="h-11 w-11 shrink-0 rounded-lg bg-raised object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{item.product ?? item.model ?? "—"}</span>
          <span className="block truncate text-[11.5px] text-faint">{when}</span>
        </span>
      </button>
      {item.assetType === "video" && (
        <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10px] font-semibold text-muted">
          {formatDuration(item.durationSec)}
        </span>
      )}
      <button type="button" onClick={onFavorite} aria-pressed={item.favorite}
        aria-label={item.favorite ? t("library.unfavorite") : t("library.favorite")}
        className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          item.favorite ? "text-accent" : "text-faint hover:text-ink")}>
        <Heart size={15} aria-hidden fill={item.favorite ? "currentColor" : "none"} />
      </button>
    </li>
  );
}

/** Sorting and the shelves that are not pictures, in a sheet — a phone gets a
 *  bottom sheet, a desktop the same panel centred. Built to grow: type, tool,
 *  model and date are rows waiting for a column to filter on. */
function FilterSheet({ t, order, favOnly, onOrder, onFav, onClose }: {
  t: T; order: Order; favOnly: boolean;
  onOrder: (v: Order) => void; onFav: (v: boolean) => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={t("library.filters")}>
      <div className="scrim animate-fade absolute inset-0" onClick={onClose} />
      <div className="animate-sheet relative w-full max-w-md rounded-t-2xl border border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-e3 sm:rounded-2xl sm:pb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{t("library.filters")}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink">
            <X size={16} aria-hidden />
          </button>
        </div>

        <p className="overline mb-1.5">{t("library.sort")}</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {([["desc", t("library.sortNewest")], ["asc", t("library.sortOldest")]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => onOrder(v as Order)}
              aria-pressed={order === v}
              className={cn("inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border text-[12.5px] font-semibold transition-colors",
                order === v ? "border-[rgb(var(--accent)/0.45)] bg-[rgb(var(--accent)/0.12)] text-ink" : "border-line text-muted hover:text-ink")}>
              <ArrowDownAZ size={14} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => onFav(!favOnly)} aria-pressed={favOnly}
          className={cn("mb-4 flex h-11 w-full items-center gap-2.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors",
            favOnly ? "border-[rgb(var(--accent)/0.45)] bg-[rgb(var(--accent)/0.12)] text-ink" : "border-line text-muted hover:text-ink")}>
          <Heart size={15} aria-hidden fill={favOnly ? "currentColor" : "none"} />
          {t("library.onlyFavorites")}
        </button>

        <p className="overline mb-1.5">{t("library.more")}</p>
        <div className="grid gap-2">
          <Link href="/library?tab=tools" onClick={onClose}
            className="flex h-11 items-center gap-2.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-raised">
            <Wrench size={15} aria-hidden className="text-muted" />
            {t("library.toolResults")}
          </Link>
          <Link href="/library?tab=history" onClick={onClose}
            className="flex h-11 items-center gap-2.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-raised">
            <List size={15} aria-hidden className="text-muted" />
            {t("library.history")}
          </Link>
        </div>

        <button type="button" onClick={onClose} className="cta mt-4 h-11 w-full rounded-xl text-[13px] font-semibold">
          {t("library.filtersApply")}
        </button>
      </div>
    </div>
  );
}

/** An empty shelf says which shelf is empty — "no results" three times over
 *  is the same sentence about three different situations. */
function EmptyShelf({ shelf, favOnly, t }: { shelf: Shelf; favOnly: boolean; t: T }) {
  const [title, body] = favOnly
    ? [t("library.emptyFavorites"), t("library.emptyFavoritesBody")]
    : shelf === "video"
      ? [t("library.emptyVideos"), t("library.emptyVideosBody")]
      : [t("library.emptyTitle"), t("library.emptyBody")];
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">{body}</p>
    </div>
  );
}

function formatDuration(sec: number | null): string {
  if (!sec || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
