"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Images, Loader2, Package, PenLine, Search, Sparkles, User, Video, Wrench, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { CLIENT_NAV, ADMIN_NAV } from "@/lib/navigation";
import { IMAGE_CREATE, IMAGE_EDIT } from "@/lib/topnav";
import { VIDEO_CREATE_WF } from "@/lib/categories";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/app/api/search/route";

const KIND_ICON: Record<SearchHit["kind"], LucideIcon> = {
  product: Package, session: PenLine, prompt: Sparkles, generation: Images, user: User,
};

/** Which tab a row belongs to. A row can belong to several. */
type Facet = "image" | "video" | "tools" | "products";
type Tab = "all" | Facet;
type Section = "recent" | "suggested" | "generators" | "products" | "tools" | "video";

type Row = {
  key: string;
  label: string;
  sub: string | null;
  href: string;
  icon: LucideIcon;
  section: Section;
  facets: Facet[];
  accent?: string;
};

const RECENT_KEY = "ecs_recent_search";
const TABS: readonly Tab[] = ["all", "image", "video", "tools", "products"] as const;

/**
 * SEARCH — one overlay for navigating and for finding the account's own work.
 *
 * Structure follows the spec: a field, a row of tabs that genuinely filter
 * (Wszystko / Obraz / Wideo / Narzędzia / Produkty), then sections —
 * OSTATNIE (this browser's history), SUGEROWANE, GENERATORY, PRODUKTY.
 * Typing switches the body to live results from the user's own data,
 * filtered by the same tabs. Ctrl/⌘K opens, Escape closes, ↑↓ + Enter work
 * throughout.
 */
export function CommandPalette({ isAdmin, wide = false, iconOnly = false }: {
  isAdmin: boolean; wide?: boolean;
  /** Icon-only trigger for the mobile top bar; the overlay is full-screen. */
  iconOnly?: boolean;
}) {
  // The bar mounts two triggers — a wide field for desktop and an icon for
  // phones — but only ONE may own Ctrl/⌘K, or the shortcut opens two
  // overlays at once and the second one fights the first for focus.
  const ownsShortcut = !iconOnly;
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => { setOpen(false); setQ(""); setHits([]); setCursor(0); setTab("all"); }, []);

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

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setRecent(raw ? (JSON.parse(raw) as string[]).slice(0, 5) : []);
    } catch { setRecent([]); }
  }, [open]);

  // Debounced live search against the caller's own data.
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

  /** SUGEROWANE / GENERATORY / NARZĘDZIA / WIDEO — the standing catalogue. */
  const catalogue = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    for (const e of IMAGE_CREATE) {
      rows.push({
        key: `cat:${e.key}`, label: t(`cats.${e.key}`), sub: t(`cats.${e.key}Sub`),
        href: e.href, icon: e.icon, section: "generators", facets: ["image"],
        accent: e.accent?.rgb,
      });
    }
    rows.push({
      key: "gen:custom", label: t("mega.custom"), sub: null, href: "/generator",
      icon: PenLine, section: "generators", facets: ["image"],
    });
    for (const e of IMAGE_EDIT) {
      rows.push({
        key: `tool:${e.key}`, label: t(`tools.${e.key}.name`), sub: null,
        href: e.href, icon: e.icon, section: "tools", facets: ["tools"],
      });
    }
    for (const w of VIDEO_CREATE_WF) {
      rows.push({
        key: `vid:${w.key}`, label: t(`video.wf.${w.key}.name`), sub: t(`video.wf.${w.key}.sub`),
        href: "/wideo", icon: w.icon, section: "video", facets: ["video"],
      });
    }
    for (const g of CLIENT_NAV) {
      for (const i of g.items) {
        rows.push({
          key: `nav:${i.href}`, label: t(`nav.${i.key}`), sub: null, href: i.href,
          icon: i.icon, section: "suggested",
          facets: i.href.startsWith("/products") ? ["products"] : [],
        });
      }
    }
    if (isAdmin) {
      for (const g of ADMIN_NAV) {
        for (const i of g.items) {
          rows.push({
            key: `adm:${i.href}`, label: `${t("admin.title")} · ${t(`admin.nav.${i.key}`)}`,
            sub: null, href: i.href, icon: i.icon, section: "suggested", facets: [],
          });
        }
      }
    }
    return rows;
  }, [t, isAdmin]);

  /** The rows the body renders, already tab-filtered. */
  const rows = useMemo<Row[]>(() => {
    const term = q.trim().toLowerCase();
    const inTab = (r: Row) => tab === "all" || r.facets.includes(tab);

    if (!term) {
      // Empty state: recents, then a short suggested set, then the catalogue.
      const recentRows: Row[] = tab === "all"
        ? recent.map((r) => ({
          key: `recent:${r}`, label: r, sub: null, href: "", icon: Search,
          section: "recent" as const, facets: [],
        }))
        : [];
      const suggested = catalogue
        .filter((r) => r.section === "suggested" && inTab(r))
        .slice(0, tab === "all" ? 4 : 8);
      const rest = catalogue.filter((r) => r.section !== "suggested" && inTab(r));
      return [...recentRows, ...suggested, ...rest];
    }

    const hitRows: Row[] = hits.map((h) => ({
      key: `${h.kind}:${h.id}`, label: h.title, sub: h.sub, href: h.href,
      icon: KIND_ICON[h.kind],
      section: h.kind === "product" ? "products" : "suggested",
      facets: h.kind === "product" ? ["products"] : h.kind === "generation" ? ["image"] : ["image"],
    }));
    const matched = catalogue.filter((r) => r.label.toLowerCase().includes(term)).slice(0, 8);
    return [...hitRows, ...matched].filter(inTab);
  }, [catalogue, hits, q, tab, recent]);

  useEffect(() => { setCursor(0); }, [q, tab, hits.length]);

  const go = useCallback((row: Row) => {
    if (!row.href) { setQ(row.label); inputRef.current?.focus(); return; }
    rememberQuery(q);
    close();
    router.push(row.href);
  }, [close, router, q, recent]); // eslint-disable-line react-hooks/exhaustive-deps

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      const i = TABS.indexOf(tab);
      setTab(TABS[(i + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length]);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => {
        const next = e.key === "ArrowDown" ? c + 1 : c - 1;
        const clamped = Math.max(0, Math.min(rows.length - 1, next));
        listRef.current?.querySelector(`[data-row="${clamped}"]`)?.scrollIntoView({ block: "nearest" });
        return clamped;
      });
      return;
    }
    if (e.key === "Enter" && rows[cursor]) { e.preventDefault(); go(rows[cursor]); }
  }

  const tabIcon: Record<Tab, LucideIcon | null> = {
    all: null, image: Images, video: Video, tools: Wrench, products: Package,
  };

  let lastSection: Section | "" = "";

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

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[11vh]"
          role="dialog" aria-modal="true" aria-label={t("search.title")}>
          <div className="scrim animate-fade absolute inset-0 backdrop-blur-[2px]" onClick={close} />
          <div className="overlay animate-pop relative flex max-h-[82dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl">
            {/* FIELD */}
            <div className="flex items-center gap-2 px-4">
              <Search size={16} className="shrink-0 text-faint" aria-hidden />
              <input
                ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                placeholder={t("search.placeholder")} aria-label={t("common.search")}
                className="w-full bg-transparent py-4 text-[15px] outline-none placeholder:text-faint"
              />
              {loading && <Loader2 size={15} className="shrink-0 animate-spin text-faint" aria-hidden />}
              <button type="button" onClick={close} aria-label={t("common.close")}
                className="shrink-0 rounded-lg p-1.5 text-faint transition-colors duration-200 hover:bg-raised hover:text-ink">
                <X size={15} />
              </button>
            </div>

            {/* TABS — these actually filter the body below. */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 pb-3">
              {TABS.map((tb) => {
                const Icon = tabIcon[tb];
                const active = tab === tb;
                return (
                  <button
                    key={tb}
                    type="button"
                    onClick={() => setTab(tb)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-colors duration-200",
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

            {/* BODY */}
            <div ref={listRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
              {rows.map((row, i) => {
                const Icon = row.icon;
                const header = row.section !== lastSection ? row.section : null;
                lastSection = row.section;
                return (
                  <div key={row.key}>
                    {header && (
                      <p className="overline flex items-center justify-between px-3 pb-1 pt-3">
                        {t(`search.sections.${header}`)}
                        {header === "recent" && recent.length > 0 && (
                          <button type="button"
                            onClick={() => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecent([]); }}
                            className="text-[10px] font-semibold normal-case tracking-normal text-faint transition-colors duration-200 hover:text-ink">
                            {t("search.clearRecent")}
                          </button>
                        )}
                      </p>
                    )}
                    <button type="button" data-row={i} onMouseEnter={() => setCursor(i)} onClick={() => go(row)}
                      aria-current={i === cursor ? "true" : undefined}
                      className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200",
                        i === cursor ? "bg-accent-soft text-ink" : "text-muted hover:bg-raised")}>
                      <span aria-hidden
                        className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          row.accent ? "text-[rgb(var(--cat))]" : "bg-raised text-accent")}
                        style={row.accent ? {
                          ["--cat" as string]: row.accent,
                          background: `rgb(${row.accent} / 0.16)`,
                        } : undefined}>
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{row.label}</span>
                        {row.sub && <span className="block truncate text-xs text-faint">{row.sub}</span>}
                      </span>
                    </button>
                  </div>
                );
              })}
              {rows.length === 0 && (
                <p className="px-3 py-10 text-center text-sm text-muted">
                  {q.trim().length < 2
                    ? t("search.emptyTab")
                    : loading ? t("search.searching") : t("search.noResults", { q: q.trim() })}
                </p>
              )}
            </div>

            <p className="border-t border-line px-4 py-2 text-[11px] text-faint">{t("search.keys")}</p>
          </div>
        </div>
      )}
    </>
  );
}
