"use client";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useInflight } from "@/lib/inflight/store";
import { cn } from "@/lib/utils";

/**
 * ONE FRAME FOR EVERY GENERATING TOOL — GENERATOR UX V3.
 *
 *   header   the way back, the tool's name (or its mode tabs) and the
 *            tutorial's "?" — the gallery portals its guide button into the
 *            slot here, so the tutorial sits beside the name it explains;
 *   switch   on a phone, "Utwórz | Wyniki (24)": the settings and the gallery
 *            are two views of one screen instead of one long page. Both stay
 *            MOUNTED — the inactive one is only hidden — so the gallery keeps
 *            its filters, its scroll, its picks and its tiles, and nothing is
 *            fetched again;
 *   columns  the desktop's two columns: settings scrolling inside their own
 *            white card with the Generate bar right below it, the gallery
 *            beside them.
 *
 * Nothing about what a tool DOES lives here; a panel hands its own settings,
 * bar and gallery in.
 */

export type ToolView = "create" | "results";

type FrameValue = {
  view: ToolView;
  setView: (v: ToolView) => void;
  /** The gallery's own count, or null while unknown. */
  results: number | null;
  setResults: (n: number | null) => void;
  /** Where the tutorial button goes (the gallery portals it in). */
  helpSlot: HTMLElement | null;
  setHelpSlot: (el: HTMLElement | null) => void;
  /** The server accepted a job: on a phone, show the results it will become —
   *  unless the customer has touched the screen since `since` (the click's
   *  `performance.now()`): someone already editing again is not pulled away. */
  accepted: (since?: number) => void;
};

const FrameContext = createContext<FrameValue | null>(null);

/** The frame around this component, if there is one (a gallery used
 *  elsewhere — an admin preview, a test — simply has none). For the panel
 *  that RENDERS the frame, see `useToolFrameController`. */
export function useToolFrame(): FrameValue | null {
  return useContext(FrameContext);
}

const PHONE = "(max-width: 1023.98px)";

/**
 * The frame's state, owned by the panel that renders `<ToolFrame>`: the
 * panel itself sits ABOVE the frame's context, so it cannot read it — it
 * holds the state here and hands it down (`<ToolFrame frame={…}>`), and its
 * own code (a job accepted → `accepted()`) talks to the very same frame.
 */
export function useToolFrameController(): FrameValue {
  const [view, setViewState] = useState<ToolView>("create");
  const [results, setResults] = useState<number | null>(null);
  const [helpSlot, setHelpSlot] = useState<HTMLElement | null>(null);
  // Each view keeps its own place on the page: going back to the settings
  // does not land at the depth the gallery had been scrolled to, and back.
  const scrollOf = useRef<Record<ToolView, number>>({ create: 0, results: 0 });

  const setView = useCallback((next: ToolView) => {
    setViewState((cur) => {
      if (cur === next) return cur;
      scrollOf.current[cur] = window.scrollY;
      const y = scrollOf.current[next];
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior }));
      return next;
    });
  }, []);

  // The last touch, click or key anywhere on the page.
  const lastInput = useRef(0);
  useEffect(() => {
    const mark = () => { lastInput.current = performance.now(); };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    return () => {
      document.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("keydown", mark, true);
    };
  }, []);
  const accepted = useCallback((since?: number) => {
    if (!window.matchMedia(PHONE).matches) return;
    if (since !== undefined && lastInput.current > since) return;
    setView("results");
  }, [setView]);

  return useMemo<FrameValue>(() => ({ view, setView, results, setResults, helpSlot, setHelpSlot, accepted }),
    [view, setView, results, helpSlot, accepted]);
}

export function ToolFrame({ frame, tools, back, title, children, className }: {
  /** The panel's `useToolFrameController()`. */
  frame: FrameValue;
  /** Inflight tools whose tiles live in this gallery (the "Wyniki" spinner). */
  tools: readonly string[];
  /** Omit on a screen that has no way back of its own (none today). */
  back?: { href: string; label: string };
  /** The tool's name, or its mode tabs. */
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  // No wrapper element: the page shell lays out its DIRECT children
  // (`.gen-shell > .gen-shell-body` in globals.css), so the header, the
  // switch and the columns must stay exactly that.
  return (
    <FrameContext.Provider value={frame}>
      <ToolHeader back={back} title={title} onSlot={frame.setHelpSlot} className={className} />
      <ToolViewSwitch tools={tools} />
      {children}
    </FrameContext.Provider>
  );
}

/**
 * The tutorial's "?" beside the tool's name: whoever owns the guide (the
 * gallery, a workbench) hands its button here. Without a frame it renders
 * nothing, and the owner keeps placing it where it always did.
 */
export function HelpPortal({ children }: { children: React.ReactNode }) {
  const slot = useContext(FrameContext)?.helpSlot ?? null;
  return slot && children ? createPortal(children, slot) : null;
}

/**
 * ← · name · ?   in ONE row, the height the old back link already had — so
 * the name and the tutorial cost the screen nothing. On a phone the way back
 * is the arrow alone (the catalogue); on a desktop it keeps its words.
 */
function ToolHeader({ back, title, onSlot, className }: {
  back?: { href: string; label: string };
  title: React.ReactNode;
  onSlot: (el: HTMLElement | null) => void;
  className?: string;
}) {
  return (
    <div data-tool-frame data-tool-header className={cn("mb-3 flex min-w-0 items-center gap-2", className)}>
      {back && (
        <Link href={back.href} data-tool-back aria-label={back.label}
          className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-ink lg:ml-0 lg:h-auto lg:w-auto lg:gap-1.5 lg:rounded-none lg:text-[13px] lg:font-medium lg:hover:bg-transparent">
          <ArrowLeft size={16} aria-hidden className="lg:h-3.5 lg:w-3.5" />
          <span className="hidden lg:inline">{back.label}</span>
        </Link>
      )}
      {back && <span aria-hidden className="hidden text-faint lg:inline">/</span>}
      <div className="min-w-0 flex-1 lg:flex-none">{title}</div>
      <span ref={onSlot} data-tool-help-slot className="flex shrink-0 items-center empty:hidden" />
    </div>
  );
}

/** The phone's two views. The count is the gallery's own (the database's),
 *  and a spinner says something of this tool is still on its way. */
function ToolViewSwitch({ tools }: { tools: readonly string[] }) {
  const { t, locale } = useI18n();
  const frame = useContext(FrameContext)!;
  const { tiles } = useInflight();
  const working = tiles.some((tile) => tile.resolved === null && tools.includes(tile.tool));
  const n = frame.results;
  const item = (key: ToolView, label: React.ReactNode) => {
    const on = frame.view === key;
    return (
      <button type="button" role="tab" aria-selected={on} data-tool-view-tab={key}
        onClick={() => frame.setView(key)}
        className={cn(
          "flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-all duration-150",
          on ? "bg-surface text-ink shadow-e2 ring-1 ring-[rgb(var(--accent)/0.45)]" : "text-muted hover:text-ink",
        )}>
        {label}
      </button>
    );
  };
  return (
    <div role="tablist" aria-label={t("toolFrame.views")} data-tool-views
      className="mb-3 flex w-full items-stretch gap-1 rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*0.8))] bg-sunken/80 p-1 lg:hidden">
      {item("create", t("toolFrame.create"))}
      {item("results", (
        <>
          <span>{t("toolFrame.results")}</span>
          {n !== null && <span className="tabular-nums text-faint">({new Intl.NumberFormat(locale).format(n)})</span>}
          {working && <Loader2 size={13} aria-label={t("toolFrame.working")} className="animate-spin text-accent" />}
        </>
      ))}
    </div>
  );
}

/**
 * THE TWO COLUMNS.
 *
 * LEFT: the settings card takes the height of what it holds — few settings, a
 * short card with the bar right under it; many, and the card stops at the
 * column's height and scrolls inside itself while the bar stays put, a soft
 * fade saying there is more. RIGHT: the gallery, scrolling in its own column.
 *
 * Below `lg` the page scrolls as a page; the frame's view decides which half
 * is shown and the bar docks itself to the bottom of the screen.
 */
export function ToolColumns({ cols, panel, bar, gallery, overlay, attrs }: {
  /** The settings column's width, e.g. `lg:grid-cols-[clamp(420px,29vw,470px)_minmax(0,1fr)]`. */
  cols: string;
  panel: React.ReactNode;
  bar: React.ReactNode;
  gallery: React.ReactNode;
  /** Mounted beside the columns (drop overlay, fixed-position modals). */
  overlay?: React.ReactNode;
  /** Data attributes the panel's tests and styles already key on. */
  attrs?: Record<`data-${string}`, string | boolean | undefined>;
}) {
  const frame = useToolFrame();
  const view = frame?.view ?? "create";
  const panelRef = useRef<HTMLDivElement>(null);
  const fade = useOverflowFade(panelRef);
  return (
    <div {...attrs} data-tool-view={view} className={cn(
      "gen-shell-body relative grid min-w-0 items-start gap-5 [&>*]:min-w-0",
      "lg:items-stretch lg:gap-6 lg:overflow-hidden lg:pb-0",
      cols,
    )}>
      {overlay}
      <div data-tool-create className="flex min-w-0 flex-col gap-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div ref={panelRef} data-tool-panel className={cn(
          "panel thin-scroll relative min-h-0 space-y-6 overflow-y-auto rounded-2xl p-4 sm:p-5 lg:flex-initial lg:pb-6",
          view === "results" && "max-lg:hidden",
        )}>
          {panel}
          {/* The fade over the last visible line while there is more below.
              In the flow (with a matching negative margin) so it adds no
              height, sticky so it rides the bottom edge of the card. */}
          <div aria-hidden data-tool-fade={fade || undefined}
            className={cn(
              // `!` beats the card's own `space-y` rhythm, which would
              // otherwise push this 24px down and add a gap of its own.
              "pointer-events-none sticky bottom-0 z-10 -mx-5 !-mt-10 hidden h-10 bg-gradient-to-t from-[rgb(var(--surface))] to-transparent transition-opacity duration-200 lg:block",
              fade ? "opacity-100" : "opacity-0",
            )} />
        </div>
        {bar}
      </div>
      <div data-tool-results className={cn(
        "thin-scroll min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-4 lg:pr-1",
        view === "create" && "max-lg:hidden",
      )}>
        {gallery}
      </div>
    </div>
  );
}

/** True while a scrolling box has more below its visible edge. */
function useOverflowFade(ref: React.RefObject<HTMLElement | null>): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The content changes height without the box doing so (a section opens).
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); mo.disconnect(); };
  }, [ref]);
  return more;
}
