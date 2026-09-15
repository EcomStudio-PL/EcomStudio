"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Images, Loader2, PenLine, Search, Sparkles, User, Video, Wrench, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { CLIENT_NAV, ADMIN_NAV } from "@/lib/navigation";
import { allDefaults, menuVisible, type AvailabilityMap, type FeatureKey } from "@/lib/features";
import {
  ALL_TOOLS_HREF, SEARCHABLE, buildToolIndex, matchTools, splitPopular,
  type ToolEntry, type ToolFacet,
} from "@/lib/tool-search";
import { MenuVeil } from "./menu-veil";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/app/api/search/route";

const KIND_ICON: Record<SearchHit["kind"], LucideIcon> = {
  session: PenLine, prompt: Sparkles, generation: Images, user: User,
};

/** Which tab a result belongs to. A result can belong to several. */
type Facet = ToolFacet;
type Tab = "all" | Facet;

type Row = {
  key: string;
  label: string;
  sub: string | null;
  href: string;
  icon: LucideIcon;
  facets: Facet[];
  accent?: string;
  section: "tools" | "yours" | "pages";
};

const RECENT_KEY = "ecs_recent_search";
const ALL_TABS: readonly Tab[] = ["all", "image", "video", "tools"] as const;

/** The two lists the modal opens with. Fixed by the design: 1–3, then 4–9. */
const TOP_COUNT = 3;
const POPULAR_COUNT = 6;

/**
 * GLOBAL SEARCH — one overlay, opened from the magnifier, never a page.
 *
 * It opens on WHAT PEOPLE USE: the three most-run tools as cards, then six more
 * as links, then the way to the whole catalogue. Typing switches the body to
 * results — tools first and instantly, because they are matched locally, then
 * the account's own products, sessions and generations when the debounced
 * request comes back.
 *
 * ONE COMPONENT, TWO LAYOUTS. The desktop design puts the three cards in a row
 * straight under the field; the phone turns that row into a snapping strip with
 * the next card visibly waiting, gives it its own heading and a dot indicator,
 * and stacks the six links full-width. Both come out of the same markup with
 * responsive classes — squeezing the desktop grid onto 360px is what makes a
 * card unreadable, and a second component is what makes the two drift.
 *
 * THE BACKDROP IS THE MEGA-MENU'S. `MenuVeil` paints at z-30, UNDER the
 * `sticky z-40` header, so the page behind softens while the logo and the menu
 * stay completely sharp — the same picture opening "Obrazy" gives, which is
 * what makes the two feel like one product rather than two overlays. The dialog
 * layer above it is transparent: it exists to catch the click that closes and
 * to hold the panel, not to paint a second scrim over the header.
 *
 * NOTHING IS FETCHED TO OPEN IT. The ranking arrives as a prop from the
 * customer layout, which already reads one settings row inside a batch it was
 * running anyway; the tool index is built from module-scope data and memoised
 * per language. Pressing the magnifier does no work beyond a render.
 */
export function CommandPalette({
  isAdmin, navAdmin, availability, popular: popularKeys, wide = false, iconOnly = false,
}: {
  isAdmin: boolean; wide?: boolean;
  /**
   * The same map the menus read. Search is a menu too: a module the drawer
   * hides must not stay reachable through a tab and a row here.
   */
  availability?: AvailabilityMap;
  /** What MODULE VISIBILITY should treat as admin — `isAdmin` normally, but
   *  false while an admin is previewing the app as a customer. `isAdmin`
   *  itself still governs the admin destinations this palette lists. */
  navAdmin?: boolean;
  /**
   * The weekly usage ranking, most-used first (lib/server/tool-popularity.ts).
   * Absent means the caller has none to give and the registry order stands in —
   * the modal is never empty and never claims a popularity it cannot back up.
   */
  popular?: readonly FeatureKey[];
  /** Icon-only trigger for the mobile top bar; the overlay is full-screen. */
  iconOnly?: boolean;
}) {
  // The bar mounts two triggers — a wide field for desktop and an icon for
  // phones — but only ONE may own Ctrl/⌘K, or the shortcut opens two
  // overlays at once and the second one fights the first for focus.
  const ownsShortcut = !iconOnly;
  // Memoised: allDefaults() builds a NEW object each call, and an unstable
  // map here would rebuild the whole catalogue on every keystroke.
  const avail = useMemo(() => availability ?? allDefaults(), [availability]);
  const seesRestricted = navAdmin ?? isAdmin;
  const TABS = ALL_TABS;
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const [card, setCard] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false); setQ(""); setHits([]); setCursor(-1); setTab("all"); setCard(0);
  }, []);

  // The binding is ⌘K on Apple hardware, Ctrl K everywhere else. SSR renders
  // the Mac glyph; the effect corrects it post-hydration to avoid a mismatch.
  const [kbdHint, setKbdHint] = useState("⌘K");
  useEffect(() => {
    if (!/Mac|iPhone|iPad|iPod/.test(navigator.platform)) setKbdHint("Ctrl K");
  }, []);

  useEffect(() => {
    if (!ownsShortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ownsShortcut]);

  // Escape closes from anywhere inside the dialog, not only from the field —
  // after arrowing into the grid the focus is on a tile, and the design asks
  // for Esc, the X and the backdrop to be equivalent.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setRecent(raw ? (JSON.parse(raw) as string[]).slice(0, 5) : []);
    } catch { setRecent([]); }
  }, [open]);

  /**
   * The account's OWN content — products, sessions, prompts, generations.
   * Debounced and never per-character: the tool results above it are already
   * on screen by then, so this request is the slow half of a two-speed list
   * rather than something the customer waits on.
   */
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const json = await res.json() as { hits?: SearchHit[] };
        setHits(json.hits ?? []);
      } catch { /* aborted or offline — keep the previous list */ }
      finally { setLoading(false); }
    }, 220);
    return () => { clearTimeout(id); ctrl.abort(); };
  }, [q]);

  function rememberQuery(term: string) {
    if (term.trim().length < 2) return;
    try {
      const next = [term.trim(), ...recent.filter((r) => r !== term.trim())].slice(0, 5);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecent(next);
    } catch { /* storage unavailable — recents are a convenience, not state */ }
  }

  /* ── the opening view ──────────────────────────────────────────────────── */

  // Ranked, then filtered by availability, then sliced — in that order, so a
  // tool switched off this morning drops out and the next one moves up rather
  // than leaving a hole in the grid.
  const { top, popular } = useMemo(
    () => splitPopular(popularKeys ?? [], avail, seesRestricted, { top: TOP_COUNT, popular: POPULAR_COUNT }),
    [popularKeys, avail, seesRestricted],
  );

  /* ── local tool matching ───────────────────────────────────────────────── */

  // Rebuilt only when the language changes: matching itself is a substring
  // scan over a few dozen short strings, which is why no keystroke here
  // touches the network and none of it needs debouncing.
  const toolIndex = useMemo(
    () => buildToolIndex(SEARCHABLE.filter((e) => menuVisible(avail, e.href, seesRestricted)), t),
    [t, avail, seesRestricted],
  );

  const entryRow = useCallback((entry: ToolEntry): Row => ({
    key: `tool:${entry.id}`, label: t(entry.nameKey), sub: t(entry.descKey), href: entry.href,
    icon: entry.icon, accent: entry.accent, facets: [entry.facet], section: "tools",
  }), [t]);

  /** Pages that are not tools — the library, settings, credits, admin. */
  const pageRows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    for (const g of CLIENT_NAV) {
      for (const i of g.items) {
        // Same rule as the drawer and the dock: a module the customer cannot
        // open is not offered here either.
        if (!menuVisible(avail, i.href, seesRestricted)) continue;
        rows.push({
          key: `nav:${i.href}`, label: t(`nav.${i.key}`), sub: null, href: i.href,
          icon: i.icon, section: "pages", facets: [],
        });
      }
    }
    if (isAdmin) {
      for (const g of ADMIN_NAV) {
        for (const i of g.items) {
          rows.push({
            key: `adm:${i.href}`, label: `${t("admin.title")} · ${t(`admin.nav.${i.key}`)}`,
            sub: null, href: i.href, icon: i.icon, section: "pages", facets: [],
          });
        }
      }
    }
    return rows;
  }, [t, isAdmin, seesRestricted, avail]);

  /** The result rows, already tab-filtered. Empty while nothing is typed. */
  const rows = useMemo<Row[]>(() => {
    const term = q.trim();
    if (!term) return [];
    const inTab = (r: Row) => tab === "all" || r.facets.includes(tab);

    const tools = matchTools(toolIndex, term).map(entryRow);
    const pages = pageRows.filter((r) => r.label.toLowerCase().includes(term.toLowerCase())).slice(0, 5);
    const yours: Row[] = hits.map((h) => ({
      key: `${h.kind}:${h.id}`, label: h.title, sub: h.sub, href: h.href,
      icon: KIND_ICON[h.kind], section: "yours", facets: ["image"],
    }));
    return [...tools, ...yours, ...pages].filter(inTab);
  }, [toolIndex, entryRow, pageRows, hits, q, tab]);

  const searching = q.trim().length > 0;

  /** Everything ↑↓ can land on, in the order it is painted. */
  const navigable = useMemo<{ href: string }[]>(
    () => searching ? rows.map((r) => ({ href: r.href })) : [...top, ...popular].map((c) => ({ href: c.href })),
    [searching, rows, top, popular],
  );

  useEffect(() => { setCursor(-1); }, [q, tab, hits.length]);

  const go = useCallback((href: string) => {
    if (!href) return;
    rememberQuery(q);
    close();
    router.push(href);
  }, [close, router, q, recent]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The round button at the end of the field. It is a real submit, never
   * decoration: with something typed it opens the highlighted result (or the
   * best match), and with an empty field it opens the catalogue — which is what
   * "search" means when you have not said what for. When a query matches
   * nothing there is nothing to open, and it is disabled rather than silently
   * doing nothing.
   */
  // The highlight wins wherever it is. Enter inside the field submits the
  // form — it never reaches the key handler below — so if this ignored the
  // cursor, arrowing onto a card and pressing Enter would open the catalogue
  // instead of the card, which is exactly what it did until it was measured.
  const highlighted = navigable[cursor]?.href;
  const submitHref = highlighted ?? (searching ? rows[0]?.href ?? "" : ALL_TOOLS_HREF);
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitHref) go(submitHref);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab" && searching) {
      e.preventDefault();
      const i = TABS.indexOf(tab);
      setTab(TABS[(i + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length]);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => {
        const next = e.key === "ArrowDown" ? c + 1 : c - 1;
        const clamped = Math.max(0, Math.min(navigable.length - 1, next));
        bodyRef.current?.querySelector(`[data-row="${clamped}"]`)?.scrollIntoView({ block: "nearest" });
        return clamped;
      });
    }
  }

  const tabIcon: Record<Tab, LucideIcon | null> = {
    all: null, image: Images, video: Video, tools: Wrench,
  };

  /* ── the shared pieces ─────────────────────────────────────────────────── */

  /** The accent tile every tool wears, in its own category colour. */
  const accentStyle = (accent?: string) => accent
    ? { ["--cat" as string]: accent, background: `rgb(${accent} / 0.16)`, color: `rgb(${accent})` }
    : undefined;

  /**
   * The card's picture. GrovBase ships no photograph per tool, so rather than a
   * black rectangle pretending an image is loading, this is the tool's own
   * category colour as a lit gradient with its icon set into it — a real
   * surface, built from what the tool actually has.
   */
  const thumbStyle = (entry: ToolEntry) => {
    // `--accent` and `--accent2` are already `r g b` triples, so a tool with no
    // category of its own borrows the product's two brand stops rather than
    // having a third colour invented for it.
    const a = entry.accent ?? "var(--accent)";
    const b = entry.accent2 ?? "var(--accent2)";
    return {
      // Three layers, and the bottom one is the point: a lit gradient over a
      // DARK plate reads as a surface with depth, where the same gradient
      // alone reads as a flat swatch of brand colour.
      background: `radial-gradient(95% 125% at 22% -18%, rgb(${a} / 0.62), transparent 58%),`
        + ` linear-gradient(145deg, rgb(${b} / 0.34), rgb(${a} / 0.08) 66%),`
        + ` rgb(var(--raised) / 0.55)`,
      color: `rgb(${a})`,
    } as React.CSSProperties;
  };

  /** One of the three cards. Identical markup on both layouts. */
  const toolCard = (entry: ToolEntry, index: number) => (
    <button
      key={entry.id} type="button" data-row={index}
      onMouseEnter={() => setCursor(index)} onClick={() => go(entry.href)}
      aria-current={index === cursor ? "true" : undefined}
      className={cn(
        // The strip geometry lives here and nowhere else: on a phone each card
        // is 72% of the width so the next one is visibly waiting, and snapping
        // makes a swipe land on a card instead of between two.
        "group relative flex w-[72%] shrink-0 snap-start flex-col gap-2.5 rounded-2xl border p-2.5 text-left transition-colors duration-200 sm:w-auto sm:shrink",
        index === cursor
          ? "border-[rgb(var(--accent)/0.6)] bg-[rgb(var(--accent)/0.07)]"
          : "border-line bg-surface/50 hover:border-[rgb(var(--accent)/0.45)]",
      )}
    >
      <span aria-hidden
        className="relative flex h-[92px] w-full items-center justify-center overflow-hidden rounded-xl sm:h-[88px]"
        style={thumbStyle(entry)}>
        <entry.icon size={40} strokeWidth={1.2} className="opacity-45" />
        {entry.ai && (
          <span className="absolute left-2 top-2 rounded-lg border border-white/15 bg-black/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            {t("search.ai")}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        <span aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-raised text-accent"
          style={accentStyle(entry.accent)}>
          <entry.icon size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{t(entry.nameKey)}</span>
        <ArrowRight size={15} aria-hidden
          className="shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent" />
      </span>
      <span className="line-clamp-2 block px-0.5 pb-0.5 text-[12px] leading-snug text-faint">
        {t(entry.descKey)}
      </span>
    </button>
  );

  /** One of the six links, and the shape every result row uses. */
  const toolLink = (entry: ToolEntry, index: number) => (
    <button
      key={entry.id} type="button" data-row={index}
      onMouseEnter={() => setCursor(index)} onClick={() => go(entry.href)}
      aria-current={index === cursor ? "true" : undefined}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-200",
        index === cursor
          ? "border-[rgb(var(--accent)/0.6)] bg-[rgb(var(--accent)/0.07)]"
          : "border-line bg-surface/40 hover:border-[rgb(var(--accent)/0.42)]",
      )}
    >
      <span aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-raised text-accent"
        style={accentStyle(entry.accent)}>
        <entry.icon size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{t(entry.nameKey)}</span>
      <ArrowRight size={14} aria-hidden
        className="shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent" />
    </button>
  );

  let lastSection: Row["section"] | "" = "";

  return (
    <>
      {iconOnly ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={t("common.search")}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors duration-200 hover:bg-raised hover:text-ink">
          <Search size={18} aria-hidden />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} aria-label={t("common.search")}
          aria-keyshortcuts="Control+K"
          className={cn(
            "hidden h-9 items-center gap-2 rounded-lg border border-line bg-surface/60 px-3 text-xs text-muted transition-colors duration-200 hover:border-accent/40 hover:text-ink sm:flex",
            wide && "w-52 justify-between rounded-xl xl:w-64",
          )}>
          <span className="flex min-w-0 items-center gap-2">
            <Search size={13} aria-hidden className="shrink-0" />
            <span className="truncate">{t("common.search")}</span>
          </span>
          <kbd className="whitespace-nowrap rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">{kbdHint}</kbd>
        </button>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <>
          {/* The page softens; the header does not. Same veil, same z-30, same
              blur as an open "Obrazy" menu — see MenuVeil. */}
          <MenuVeil open />
          <div
            role="dialog" aria-modal="true" aria-label={t("search.title")}
            className={cn(
              "fixed inset-0 z-[60] flex items-start justify-center px-3 sm:px-4",
              // Under the header on every viewport, and clear of the phone's
              // fixed dock and home indicator at the bottom. The panel's own
              // max-height is `100%` of what is left after this padding, so it
              // can never leave the viewport or slide under either bar.
              "pt-[calc(env(safe-area-inset-top)+var(--header-h)+0.5rem)] pb-[var(--page-bottom)]",
              "sm:pt-[calc(env(safe-area-inset-top)+var(--header-h)+1.5rem)]",
              "lg:pb-10 lg:pt-[max(calc(var(--header-h)+3.5rem),9vh)]",
            )}
          >
            {/* Transparent: MenuVeil is what paints. This layer only catches
                the click that closes and keeps the page behind inert. */}
            <div className="absolute inset-0" onClick={close} aria-hidden />

            <div className="overlay search-panel animate-pop relative flex max-h-full w-full max-w-[800px] flex-col overflow-hidden rounded-[24px]">
              {/* CLOSE — top right of the panel, as in the design. */}
              <div className="flex justify-end px-4 pt-3.5 sm:px-6">
                <button type="button" onClick={close} aria-label={t("common.close")}
                  className="-mr-1 shrink-0 rounded-lg p-1.5 text-faint transition-colors duration-200 hover:bg-raised hover:text-ink">
                  <X size={18} />
                </button>
              </div>

              {/* THE FIELD */}
              <form onSubmit={onSubmit} className="px-4 pb-1 pt-1.5 sm:px-6">
                <div className="search-field flex items-center gap-2.5 rounded-full py-1.5 pl-4 pr-1.5">
                  <Search size={17} className="shrink-0 text-faint" aria-hidden />
                  <input
                    ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                    placeholder={t("search.toolPlaceholder")} aria-label={t("common.search")}
                    enterKeyHint="search" autoComplete="off" spellCheck={false}
                    className="w-full bg-transparent py-2 text-[14px] outline-none placeholder:text-faint sm:text-[15px]"
                  />
                  {loading && <Loader2 size={15} className="shrink-0 animate-spin text-faint" aria-hidden />}
                  {/* The shortcut hint belongs where the shortcut exists. A
                      phone has no ⌘K, and a badge advertising one would be a
                      small lie on the most-used surface in the product. */}
                  <kbd className="hidden shrink-0 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-[10px] font-semibold text-faint sm:inline-block">
                    {kbdHint}
                  </kbd>
                  <button type="submit" disabled={!submitHref}
                    aria-label={submitHref === ALL_TOOLS_HREF ? t("search.allTools") : t("common.search")}
                    className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-[0_4px_14px_-4px_rgb(var(--accent)/0.9)] transition-transform duration-200 hover:scale-[1.04] disabled:opacity-40 disabled:hover:scale-100">
                    <Search size={16} aria-hidden />
                  </button>
                </div>
              </form>

              {/* RECENT QUERIES — only for somebody who has some. A first-time
                  seller sees the two ranked lists and nothing else. */}
              {!searching && recent.length > 0 && (
                <div className="thin-scroll flex items-center gap-1.5 overflow-x-auto px-4 pt-2.5 sm:px-6">
                  {recent.map((r) => (
                    <button key={r} type="button" onClick={() => { setQ(r); inputRef.current?.focus(); }}
                      className="plate inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] text-muted transition-colors duration-200 hover:text-ink">
                      <Search size={11} aria-hidden />
                      {r}
                    </button>
                  ))}
                  <button type="button"
                    onClick={() => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecent([]); }}
                    className="shrink-0 px-1.5 text-[11px] font-semibold text-faint transition-colors duration-200 hover:text-ink">
                    {t("search.clearRecent")}
                  </button>
                </div>
              )}

              {/* TABS — they filter results, so they arrive with the results. */}
              {searching && (
                <div className="thin-scroll mt-2 flex items-center gap-1.5 overflow-x-auto px-4 pb-3 sm:flex-wrap sm:overflow-visible sm:px-6">
                  {TABS.map((tb) => {
                    const Icon = tabIcon[tb];
                    const active = tab === tb;
                    return (
                      <button
                        key={tb} type="button" onClick={() => setTab(tb)} aria-pressed={active}
                        className={cn(
                          "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-colors duration-200",
                          active
                            ? "bg-[rgb(var(--accent)/0.16)] text-ink ring-1 ring-[rgb(var(--accent)/0.45)]"
                            : "plate text-muted hover:text-ink",
                        )}
                      >
                        {Icon && <Icon size={13} aria-hidden />}
                        {t(`search.tabs.${tb}`)}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* BODY */}
              <div ref={bodyRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 sm:px-6 sm:pt-3">
                {!searching ? (
                  <>
                    {/* The phone gives the strip a heading and a way out; the
                        desktop design has the three cards follow the field
                        directly, so the heading row is phone-only. */}
                    <div className="flex items-baseline justify-between gap-3 pb-2.5 sm:hidden">
                      {/* One line, always. At 360px the heading and the link
                          together are a few pixels from wrapping, and a
                          two-line heading pushes the whole strip down. */}
                      <p className="min-w-0 truncate whitespace-nowrap text-[14.5px] font-semibold text-ink">
                        {t("search.mostUsed")}
                      </p>
                      <button type="button" onClick={() => go(ALL_TOOLS_HREF)}
                        className="group inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] font-medium text-muted transition-colors duration-200 hover:text-ink">
                        {t("search.seeAll")}
                        <ArrowRight size={12} aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5" />
                      </button>
                    </div>

                    <div
                      ref={stripRef}
                      onScroll={(e) => {
                        // The pitch is read off the cards themselves rather than
                        // divided out of scrollWidth: the strip carries padding
                        // and a gap, and an approximated stride drifts by a
                        // whole card by the end of three.
                        const el = e.currentTarget;
                        const a = el.children[0]?.getBoundingClientRect().left ?? 0;
                        const b = el.children[1]?.getBoundingClientRect().left;
                        const pitch = b === undefined ? el.clientWidth : b - a;
                        setCard(Math.max(0, Math.min(top.length - 1,
                          Math.round(el.scrollLeft / Math.max(pitch, 1)))));
                      }}
                      className="thin-scroll -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0"
                    >
                      {top.map((entry, i) => toolCard(entry, i))}
                    </div>

                    {/* The three dots from the design — phone only, and they
                        follow the strip rather than decorating it. */}
                    {top.length > 1 && (
                      <div className="flex items-center justify-center gap-1.5 pb-1 pt-3 sm:hidden" aria-hidden>
                        {top.map((entry, i) => (
                          <span key={entry.id} className={cn(
                            "h-1.5 rounded-full transition-all duration-200",
                            i === card ? "w-4 bg-accent" : "w-1.5 bg-[rgb(var(--faint)/0.45)]",
                          )} />
                        ))}
                      </div>
                    )}

                    <p className="pb-2 pt-4 text-[15px] font-semibold text-ink sm:pt-5">
                      {t("search.popularTools")}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {popular.map((entry, i) => toolLink(entry, TOP_COUNT + i))}
                    </div>
                  </>
                ) : (
                  <>
                    {rows.map((row, i) => {
                      const Icon = row.icon;
                      const header = row.section !== lastSection ? row.section : null;
                      lastSection = row.section;
                      return (
                        <div key={row.key}>
                          {header && (
                            <p className={cn("overline pb-1.5", i === 0 ? "pt-0" : "pt-3")}>
                              {t(`search.sections.${header}`)}
                            </p>
                          )}
                          <button type="button" data-row={i} onMouseEnter={() => setCursor(i)}
                            onClick={() => go(row.href)}
                            aria-current={i === cursor ? "true" : undefined}
                            className={cn(
                              "group mb-1.5 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-200",
                              i === cursor
                                ? "border-[rgb(var(--accent)/0.6)] bg-[rgb(var(--accent)/0.07)]"
                                : "border-line bg-surface/40 hover:border-[rgb(var(--accent)/0.42)]",
                            )}>
                            <span aria-hidden
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-raised text-accent"
                              style={accentStyle(row.accent)}>
                              <Icon size={14} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13.5px] font-medium text-ink">{row.label}</span>
                              {row.sub && <span className="block truncate text-[11.5px] text-faint">{row.sub}</span>}
                            </span>
                            <ArrowRight size={14} aria-hidden
                              className="shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent" />
                          </button>
                        </div>
                      );
                    })}
                    {rows.length === 0 && (
                      <p className="px-3 py-10 text-center text-sm text-muted">
                        {loading ? t("search.searching") : t("search.noResults", { q: q.trim() })}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* THE WAY OUT OF THE LIST — the catalogue, once, at the foot.
                  Desktop only: the phone already carries "Zobacz wszystkie"
                  beside the strip heading, and two links to one place inside
                  one sheet is one too many. */}
              <button type="button" onClick={() => go(ALL_TOOLS_HREF)}
                className="group hidden items-center justify-center gap-2 border-t border-line px-6 py-3.5 text-[13px] text-muted transition-colors duration-200 hover:bg-raised hover:text-ink sm:flex">
                <Sparkles size={14} aria-hidden className="text-accent" />
                {t("search.browseAll")}
                <ArrowRight size={13} aria-hidden
                  className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </>,
        /**
         * PORTALLED TO THE BODY, AND IT HAS TO BE.
         *
         * The top bar is `.glass`, which means `backdrop-filter`, and an
         * element with a backdrop filter becomes the CONTAINING BLOCK for every
         * `position: fixed` descendant. Rendered inline — where this overlay
         * used to live — `fixed inset-0` therefore resolved against the 54px
         * header instead of the viewport, so the panel was laid out inside a
         * box two pixels tall and the whole modal collapsed. Nothing about that
         * is visible in the markup; it is visible the moment anything is
         * measured. The body is the only parent with no filter above it, which
         * is the same reason MenuVeil portals.
         */
        document.body,
      )}
    </>
  );
}
