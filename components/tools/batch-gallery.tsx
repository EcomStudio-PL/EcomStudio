"use client";
import { useMemo } from "react";
import {
  AlertTriangle, CheckCircle2, Download, Heart, LayoutGrid, List, Loader2,
  Minus, Plus, Search, SquareDashedMousePointer, X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * THE BATCH GALLERY — one workspace for every tool that takes 200 photos.
 *
 * Resize and Compression were each drawing their own list of cards, and the
 * two had already drifted. This is the single surface both use: the toolbar
 * (grid/list, thumbnail size, search, selection, favourites, filters) and the
 * cards under it.
 *
 * What is deliberately NOT here: what a card says about its own photo. Resize
 * talks about pixels and Compression talks about bytes, so each passes its own
 * `meta` line. Everything around it — the frame, the states, the actions, the
 * empty results — is shared, which is the point.
 *
 * Favourites are per-batch and live in memory. A star on a file that exists
 * only until the tab closes does not deserve a table, and the Library's
 * favourites are about saved generations, not about a queue.
 */

export type BatchStatus = "queued" | "running" | "done" | "error";

export type BatchItem = {
  id: string;
  name: string;
  /** Object URL of the downscaled preview, once the decode finishes. */
  thumbUrl?: string;
  status: BatchStatus;
  /** Already-translated error line, when the status is "error". */
  errorText?: string;
  /** Bytes of the source file — used by the size sort, which both tools want. */
  bytes: number;
  canDownload: boolean;
};

export type BatchFilter = {
  q: string;
  /** "all", or one of the statuses actually present in the queue. */
  status: string;
  /** A file extension present in the queue, or "all". */
  format: string;
  favOnly: boolean;
  selectedOnly: boolean;
  sort: "added" | "name" | "size";
};

export const DEFAULT_BATCH_FILTER: BatchFilter = {
  q: "", status: "all", format: "all", favOnly: false, selectedOnly: false, sort: "added",
};

/**
 * Thumbnail size, in the only unit that matters here: how wide a tile is
 * allowed to get before the grid adds another column. The slider moves through
 * these rather than through arbitrary pixels, so every step is a layout
 * somebody has looked at.
 */
export const ZOOM_STEPS = [104, 132, 168, 216, 280] as const;
export const DEFAULT_ZOOM = 2;

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** The queue, filtered and ordered. Pure, so both tools and the tests agree. */
export function applyBatchFilter<T extends BatchItem>(
  items: readonly T[],
  filter: BatchFilter,
  favourites: ReadonlySet<string>,
  selected: ReadonlySet<string>,
): T[] {
  const needle = filter.q.trim().toLowerCase();
  const kept = items.filter((item) => {
    if (needle && !item.name.toLowerCase().includes(needle)) return false;
    if (filter.status !== "all" && item.status !== filter.status) return false;
    if (filter.format !== "all" && extensionOf(item.name) !== filter.format) return false;
    if (filter.favOnly && !favourites.has(item.id)) return false;
    if (filter.selectedOnly && !selected.has(item.id)) return false;
    return true;
  });
  if (filter.sort === "name") {
    return [...kept].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (filter.sort === "size") {
    return [...kept].sort((a, b) => b.bytes - a.bytes);
  }
  // "added" is the order they arrived in — the order the seller dropped them.
  return kept;
}

/* ── the toolbar ────────────────────────────────────────────────────────── */

export function BatchGalleryToolbar({
  items, view, onView, zoom, onZoom, filter, onFilter, selecting, onSelecting, disabled = false,
}: {
  /** The WHOLE queue, so the filters can offer only values that exist in it. */
  items: readonly BatchItem[];
  view: "grid" | "list";
  onView: (view: "grid" | "list") => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  filter: BatchFilter;
  onFilter: (filter: BatchFilter) => void;
  selecting: boolean;
  onSelecting: (selecting: boolean) => void;
  /**
   * Nothing in the queue yet. The bar stays on screen — it is part of the
   * workspace, not of its contents — but everything that acts ON photos is
   * genuinely disabled rather than left live over an empty list. The view
   * switch and the zoom are NOT: they are preferences that decide how the
   * first photo will land, and they still take effect.
   */
  disabled?: boolean;
}) {
  const { t } = useI18n();

  // Only the statuses and formats the queue actually contains. An empty
  // filter — "błąd (0)" on a queue with no failures — is a control that
  // cannot do anything, and this screen does not ship those.
  const statuses = useMemo(() => {
    const seen = new Set(items.map((i) => i.status));
    return (["queued", "running", "done", "error"] as const).filter((s) => seen.has(s));
  }, [items]);
  const formats = useMemo(
    () => [...new Set(items.map((i) => extensionOf(i.name)).filter(Boolean))].sort(),
    [items],
  );

  const patch = (next: Partial<BatchFilter>) => onFilter({ ...filter, ...next });
  const control = "h-9 rounded-xl border border-line bg-sunken/60 text-[12.5px] font-medium text-ink outline-none";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {/* GRID / LIST */}
      <div className="flex shrink-0 items-center rounded-xl border border-line p-0.5" role="group"
        aria-label={t("batch.viewLabel")}>
        {([["grid", LayoutGrid], ["list", List]] as const).map(([key, Icon]) => (
          <button key={key} type="button" aria-pressed={view === key}
            aria-label={t(`batch.view.${key}`)} title={t(`batch.view.${key}`)}
            onClick={() => onView(key)}
            className={cn("rounded-[9px] p-1.5 transition-colors",
              view === key ? "bg-raised text-ink" : "text-faint hover:text-ink")}>
            <Icon size={14} aria-hidden />
          </button>
        ))}
      </div>

      {/* THUMBNAIL SIZE — the tiles, never the files. */}
      {view === "grid" && (
        <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line px-2"
          title={t("batch.zoomHint")}>
          <button type="button" aria-label={t("batch.zoomOut")} disabled={zoom === 0}
            onClick={() => onZoom(zoom - 1)}
            className="text-faint transition-colors hover:text-ink disabled:opacity-35">
            <Minus size={13} aria-hidden />
          </button>
          <input type="range" min={0} max={ZOOM_STEPS.length - 1} step={1} value={zoom}
            onChange={(e) => onZoom(Number(e.target.value))}
            aria-label={t("batch.zoomLabel")}
            className="h-1 w-16 cursor-pointer accent-[rgb(var(--accent))] xl:w-20" />
          <button type="button" aria-label={t("batch.zoomIn")} disabled={zoom === ZOOM_STEPS.length - 1}
            onClick={() => onZoom(zoom + 1)}
            className="text-faint transition-colors hover:text-ink disabled:opacity-35">
            <Plus size={13} aria-hidden />
          </button>
        </div>
      )}

      {/* SEARCH — by file name, inside this batch. On a phone it takes a row
          of its own: squeezed between the view switch and the filters it had
          room for the word "Sz", which is not a search field. */}
      <div className="relative order-last w-full min-w-0 basis-full sm:order-none sm:w-56 sm:basis-auto lg:w-64">
        <Search size={14} aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input value={filter.q} onChange={(e) => patch({ q: e.target.value })}
          disabled={disabled}
          placeholder={t("batch.searchPh")} aria-label={t("batch.searchLabel")}
          className={cn(control, "w-full pl-8 pr-2 placeholder:text-faint focus:border-[rgb(var(--accent)/0.55)]",
            disabled && "opacity-45")} />
      </div>

      {/* SELECTION MODE */}
      <button type="button" aria-pressed={selecting} disabled={disabled}
        aria-label={selecting ? t("batch.selectOff") : t("batch.selectOn")}
        title={selecting ? t("batch.selectOff") : t("batch.selectOn")}
        onClick={() => onSelecting(!selecting)}
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-45",
          selecting ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft/40 text-accent"
            : "border-line text-faint hover:text-ink")}>
        <SquareDashedMousePointer size={14} aria-hidden />
      </button>

      {/* FAVOURITES */}
      <button type="button" aria-pressed={filter.favOnly} disabled={disabled}
        aria-label={t("batch.favFilter")} title={t("batch.favFilter")}
        onClick={() => patch({ favOnly: !filter.favOnly })}
        className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-45",
          filter.favOnly ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft/40 text-accent"
            : "border-line text-faint hover:text-ink")}>
        <Heart size={14} aria-hidden fill={filter.favOnly ? "currentColor" : "none"} />
      </button>

      {/* FILTERS — each offered only while it has something to filter. */}
      {statuses.length > 1 && (
        <select value={filter.status} onChange={(e) => patch({ status: e.target.value })}
          aria-label={t("batch.statusLabel")} className={cn(control, "px-2")}>
          <option value="all">{t("batch.statusAll")}</option>
          {statuses.map((s) => <option key={s} value={s}>{t(`batch.status.${s}`)}</option>)}
        </select>
      )}
      {formats.length > 1 && (
        <select value={filter.format} onChange={(e) => patch({ format: e.target.value })}
          aria-label={t("batch.formatLabel")} className={cn(control, "px-2")}>
          <option value="all">{t("batch.formatAll")}</option>
          {formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
        </select>
      )}
      {selecting && (
        <button type="button" aria-pressed={filter.selectedOnly}
          onClick={() => patch({ selectedOnly: !filter.selectedOnly })}
          className={cn("h-9 shrink-0 rounded-xl border px-2.5 text-[12.5px] font-semibold transition-colors",
            filter.selectedOnly ? "border-[rgb(var(--accent)/0.5)] bg-accent-soft/40 text-accent"
              : "border-line text-faint hover:text-ink")}>
          {t("batch.selectedOnly")}
        </button>
      )}

      <select value={filter.sort} onChange={(e) => patch({ sort: e.target.value as BatchFilter["sort"] })}
        disabled={disabled}
        aria-label={t("batch.sortLabel")} className={cn(control, "px-2", disabled && "opacity-45")}>
        <option value="added">{t("batch.sort.added")}</option>
        <option value="name">{t("batch.sort.name")}</option>
        <option value="size">{t("batch.sort.size")}</option>
      </select>
    </div>
  );
}

/* ── the cards ──────────────────────────────────────────────────────────── */

export function BatchGrid({
  items, view, zoom, selecting, selected, favourites, running,
  meta, onDownload, onRemove, onToggleFavourite, onToggleSelected,
}: {
  items: readonly BatchItem[];
  view: "grid" | "list";
  zoom: number;
  selecting: boolean;
  selected: ReadonlySet<string>;
  favourites: ReadonlySet<string>;
  /** While the batch runs, nothing may be pulled out from under it. */
  running: boolean;
  /** The one line only this tool can write: pixels, or bytes. */
  meta: (id: string) => React.ReactNode;
  onDownload: (id: string) => void;
  onRemove: (id: string) => void;
  onToggleFavourite: (id: string) => void;
  onToggleSelected: (id: string) => void;
}) {
  const { t } = useI18n();

  if (items.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted">{t("batch.noMatches")}</p>
    );
  }

  if (view === "list") {
    return (
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id}
            className={cn("plate flex items-center gap-3 rounded-xl p-2",
              selecting && selected.has(item.id) && "ring-1 ring-[rgb(var(--accent)/0.55)]")}
            style={{ contentVisibility: "auto", containIntrinsicSize: "auto 4rem" }}>
            {selecting && (
              <input type="checkbox" checked={selected.has(item.id)}
                onChange={() => onToggleSelected(item.id)}
                aria-label={item.name}
                className="size-4 shrink-0 accent-[rgb(var(--accent))]" />
            )}
            <Thumb item={item} className="h-14 w-14" />
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                {/* The state, next to the name. A row is the compact view, and
                    a compact view that cannot say whether a file is done is
                    missing the one thing a queue is watched for; the grid has
                    carried this mark over its thumbnail all along. */}
                <StatusMark status={item.status} />
                <span className="truncate">{item.name}</span>
              </p>
              {item.status === "error" && item.errorText
                ? <p className="truncate text-[11px] text-danger">{item.errorText}</p>
                : meta(item.id)}
            </div>
            <Actions item={item} favourite={favourites.has(item.id)} running={running}
              onDownload={onDownload} onRemove={onRemove} onToggleFavourite={onToggleFavourite} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    // The tile width is a ceiling, not a floor: `min(step, 46%)` keeps two
    // columns on a 390px phone, where a 168px minimum would have left one
    // enormous tile per row and turned the zoom slider into a no-op.
    <ul className="grid gap-2 [&>*]:min-w-0"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${ZOOM_STEPS[zoom]}px, 46%), 1fr))` }}>
      {items.map((item) => (
        <li key={item.id}
          className={cn("plate group relative overflow-hidden rounded-xl p-2",
            selecting && selected.has(item.id) && "ring-1 ring-[rgb(var(--accent)/0.55)]")}
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 12rem" }}>
          <div className="relative">
            <Thumb item={item} className="aspect-square w-full" />
            {selecting && (
              <label className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-lg bg-[rgb(var(--surface)/0.85)] backdrop-blur">
                <input type="checkbox" checked={selected.has(item.id)}
                  onChange={() => onToggleSelected(item.id)} aria-label={item.name}
                  className="size-3.5 accent-[rgb(var(--accent))]" />
              </label>
            )}
            <span className="absolute right-1.5 top-1.5"><StatusMark status={item.status} /></span>
          </div>
          <p className="mt-1.5 truncate text-[12px] font-semibold" title={item.name}>{item.name}</p>
          {item.status === "error" && item.errorText
            ? <p className="truncate text-[11px] text-danger">{item.errorText}</p>
            : meta(item.id)}
          <div className="mt-1 flex items-center justify-end gap-0.5">
            <Actions item={item} favourite={favourites.has(item.id)} running={running} compact
              onDownload={onDownload} onRemove={onRemove} onToggleFavourite={onToggleFavourite} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Thumb({ item, className }: { item: BatchItem; className?: string }) {
  return (
    <span className={cn("relative block shrink-0 overflow-hidden rounded-lg bg-checker", className)}>
      {item.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumbUrl} alt="" loading="lazy" decoding="async"
          className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden className="block h-full w-full animate-pulse bg-sunken" />
      )}
    </span>
  );
}

function Actions({ item, favourite, running, compact, onDownload, onRemove, onToggleFavourite }: {
  item: BatchItem;
  favourite: boolean;
  running: boolean;
  compact?: boolean;
  onDownload: (id: string) => void;
  onRemove: (id: string) => void;
  onToggleFavourite: (id: string) => void;
}) {
  const { t } = useI18n();
  const button = "shrink-0 rounded-lg p-1.5 transition-colors";
  return (
    <>
      <button type="button" aria-pressed={favourite}
        aria-label={t("batch.favourite")} title={t("batch.favourite")}
        onClick={() => onToggleFavourite(item.id)}
        className={cn(button, favourite ? "text-accent" : "text-faint hover:bg-sunken hover:text-ink")}>
        <Heart size={15} aria-hidden fill={favourite ? "currentColor" : "none"} />
      </button>
      {!compact && <StatusMark status={item.status} />}
      {item.canDownload && (
        <button type="button" onClick={() => onDownload(item.id)} aria-label={t("common.download")}
          title={t("common.download")}
          className={cn(button, "text-muted hover:bg-sunken hover:text-ink")}>
          <Download size={15} aria-hidden />
        </button>
      )}
      {!running && item.status !== "running" && (
        <button type="button" aria-label={t("common.remove")} title={t("common.remove")}
          onClick={() => onRemove(item.id)}
          className={cn(button, "text-faint hover:bg-sunken hover:text-danger")}>
          <X size={15} aria-hidden />
        </button>
      )}
    </>
  );
}

export function StatusMark({ status }: { status: BatchStatus }) {
  if (status === "running") return <Loader2 size={16} className="shrink-0 animate-spin text-accent" aria-hidden />;
  if (status === "done") return <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />;
  if (status === "error") return <AlertTriangle size={16} className="shrink-0 text-danger" aria-hidden />;
  return <span aria-hidden className="block h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--hairline)/0.5)]" />;
}
