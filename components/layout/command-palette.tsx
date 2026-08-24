"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Images, Loader2, Package, PenLine, Search, Sparkles, User, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { CLIENT_NAV, ADMIN_NAV } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/app/api/search/route";

const KIND_ICON: Record<SearchHit["kind"], LucideIcon> = {
  product: Package, session: PenLine, prompt: Sparkles, generation: Images, user: User,
};

type Row = { key: string; label: string; sub: string | null; href: string; icon: LucideIcon; group: string };

/**
 * Desktop search: navigation commands plus REAL results from the user's own
 * products, prompt sessions, prompts and generations (admins additionally get
 * customer lookup). Debounced server search, full keyboard control, client-side
 * navigation only — no page reloads.
 */
export function CommandPalette({ isAdmin, wide = false }: { isAdmin: boolean; wide?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = useCallback(() => { setOpen(false); setQ(""); setHits([]); setCursor(0); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Autofocus as soon as the dialog mounts — the field must be usable instantly.
  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);

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

  // Navigation commands come from the SAME nav config as the sidebars.
  const commands = useMemo<Row[]>(() => {
    const rows: Row[] = CLIENT_NAV.flatMap((g) => g.items.map((i) => ({
      key: `nav:${i.href}`, label: t(`nav.${i.key}`), sub: null, href: i.href,
      icon: i.icon, group: t("search.pages"),
    })));
    if (isAdmin) {
      for (const g of ADMIN_NAV) {
        for (const i of g.items) {
          rows.push({
            key: `adm:${i.href}`, label: `${t("admin.title")} · ${t(`admin.nav.${i.key}`)}`,
            sub: null, href: i.href, icon: i.icon, group: t("search.pages"),
          });
        }
      }
    }
    return rows;
  }, [t, isAdmin]);

  const rows = useMemo<Row[]>(() => {
    const term = q.trim().toLowerCase();
    const matchedCommands = term
      ? commands.filter((c) => c.label.toLowerCase().includes(term)).slice(0, 6)
      : commands.slice(0, 8);
    const resultRows: Row[] = hits.map((h) => ({
      key: `${h.kind}:${h.id}`, label: h.title, sub: h.sub, href: h.href,
      icon: KIND_ICON[h.kind], group: t(`search.kind.${h.kind}`),
    }));
    return [...resultRows, ...matchedCommands];
  }, [commands, hits, q, t]);

  useEffect(() => { setCursor(0); }, [q, hits.length]);

  function go(row: Row) { close(); router.push(row.href); }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => {
        const next = e.key === "ArrowDown" ? c + 1 : c - 1;
        const clamped = Math.max(0, Math.min(rows.length - 1, next));
        listRef.current?.children[clamped]?.scrollIntoView({ block: "nearest" });
        return clamped;
      });
      return;
    }
    if (e.key === "Enter" && rows[cursor]) { e.preventDefault(); go(rows[cursor]); }
  }

  let lastGroup = "";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t("common.search")}
        aria-keyshortcuts="Control+K"
        className={cn(
          "hidden h-9 items-center gap-2 rounded-lg border border-line bg-surface/60 px-3 text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink sm:flex",
          // Wide variant: the top bar's search field, Higgsfield-style.
          wide && "w-56 justify-between rounded-xl xl:w-72",
        )}>
        <span className="flex min-w-0 items-center gap-2">
          <Search size={13} aria-hidden className="shrink-0" />
          <span className="truncate">{t("common.search")}</span>
        </span>
        <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
          role="dialog" aria-modal="true" aria-label={t("common.search")}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] anim-fade" onClick={close} />
          <div className="overlay anim-pop relative w-full max-w-xl overflow-hidden rounded-2xl">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search size={15} className="shrink-0 text-faint" aria-hidden />
              <input
                ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
                placeholder={t("search.placeholder")} aria-label={t("common.search")}
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-faint"
              />
              {loading && <Loader2 size={14} className="shrink-0 animate-spin text-faint" aria-hidden />}
              <button type="button" onClick={close} aria-label={t("common.close")}
                className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink">
                <X size={14} />
              </button>
            </div>

            <ul ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {rows.map((row, i) => {
                const Icon = row.icon;
                const header = row.group !== lastGroup ? row.group : null;
                lastGroup = row.group;
                return (
                  <li key={row.key}>
                    {header && (
                      <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                        {header}
                      </p>
                    )}
                    <button type="button" onMouseEnter={() => setCursor(i)} onClick={() => go(row)}
                      aria-current={i === cursor ? "true" : undefined}
                      className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        i === cursor ? "bg-accent-soft text-ink" : "text-muted hover:bg-raised")}>
                      <Icon size={15} className="shrink-0 text-accent" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{row.label}</span>
                        {row.sub && <span className="block truncate text-xs text-faint">{row.sub}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
              {rows.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-muted">
                  {q.trim().length < 2 ? t("search.hint") : loading ? t("search.searching") : t("search.noResults", { q: q.trim() })}
                </li>
              )}
            </ul>

            <p className="border-t border-line px-4 py-2 text-[11px] text-faint">{t("search.keys")}</p>
          </div>
        </div>
      )}
    </>
  );
}
