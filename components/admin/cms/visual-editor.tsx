"use client";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { PenLine, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/lib/notify";
import { iceSetEditAction } from "@/app/actions/ice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * ADMIN → EDYTOR WIZUALNY — the two interactive pieces of the entry screen.
 *
 * Everything else on that screen is rendered on the server from plain data;
 * these get plain data too (names already translated, no registry import), so
 * the editor's registry never reaches the admin bundle.
 */

/** The refusals setEdit names; anything else reads as the generic one. */
const KNOWN_ERRORS = new Set(["step_up_required", "unsupported", "not_admin", "unauthenticated", "unavailable"]);

/**
 * "Edytuj wizualnie": starts an edit session for `path` (a path-scoped
 * cookie, set by the server after it re-checks the role, the step-up and the
 * page) and then opens that page — with `#ice=<element id>` when one element
 * was asked for, which the editor opens on arrival.
 */
export function IceEditButton({ path, elementId, className }: {
  path: string;
  elementId?: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [leaving, setLeaving] = useState(false);

  const open = () => start(async () => {
    let error = "generic";
    try {
      const res = await iceSetEditAction(true, path);
      if (res.ok) {
        setLeaving(true);
        window.location.assign(elementId ? `${path}#ice=${encodeURIComponent(elementId)}` : path);
        return;
      }
      error = res.error;
    } catch {
      // A dropped connection is the generic failure, not a crash of the list.
    }
    notify.error(t(KNOWN_ERRORS.has(error) ? `iceAdmin.error.${error}` : "iceAdmin.error.generic"));
  });

  const busy = pending || leaving;
  return (
    <Button type="button" size="sm" variant="secondary" onClick={open} disabled={busy} aria-busy={busy}
      data-ice-admin-edit={path} className={cn("h-11 shrink-0 lg:h-9", className)}>
      <PenLine size={14} aria-hidden />
      {busy ? t("iceAdmin.opening") : t("iceAdmin.edit")}
    </Button>
  );
}

export type IceFindPage = { path: string; name: string };
/** One element: `p` is its page's index in `pages`. */
export type IceFindItem = { p: number; id: string; label: string; value: string | null; slots: string | null };

/** Lower case, no diacritics (ł folded by hand — it has no combining mark). */
const fold = (s: string) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const SHOWN = 50;

/**
 * "Znajdź stronę lub element" — filters in the browser over what the server
 * passed: every page (name, address) and every element (its label, the page
 * it is on, the Polish copy it shows now, the slot it fills). Every word of
 * the query has to match, so "plany faq" narrows to the pricing FAQ.
 */
export function IceFind({ pages, items }: { pages: IceFindPage[]; items: IceFindItem[] }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);

  const index = useMemo(() => ({
    pages: pages.map((p) => fold(`${p.name} ${p.path}`)),
    items: items.map((it) => {
      const page = pages[it.p];
      return fold(`${it.label} ${page?.name ?? ""} ${page?.path ?? ""} ${it.value ?? ""} ${it.slots ?? ""}`);
    }),
  }), [pages, items]);

  const results = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const hit = (hay: string) => words.every((w) => hay.includes(w));
    const pageHits = pages.flatMap((p, i) => (hit(index.pages[i]) ? [{ page: p, item: null }] : []));
    const itemHits = items.flatMap((it, i) => (hit(index.items[i]) && pages[it.p] ? [{ page: pages[it.p], item: it }] : []));
    return [...pageHits, ...itemHits];
  }, [query, index, pages, items]);

  return (
    <section aria-labelledby="ice-find-title" data-ice-find>
      <label id="ice-find-title" htmlFor="ice-find" className="mb-1.5 block text-[13px] font-semibold tracking-tight text-ink">
        {t("iceAdmin.search.label")}
      </label>
      <div className="relative">
        <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <Input id="ice-find" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t("iceAdmin.search.placeholder")} autoComplete="off" spellCheck={false}
          className="pl-9 pr-10 [&::-webkit-search-cancel-button]:hidden" />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label={t("common.clear")}
            className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-faint hover:text-ink">
            <X size={15} aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("iceAdmin.search.hint")}</p>

      {results && (
        <div className="mt-3" aria-live="polite">
          {results.length === 0 ? (
            <p className="panel rounded-2xl px-4 py-3.5 text-[13px] text-muted">
              {t("iceAdmin.search.empty", { q: query.trim() })}
            </p>
          ) : (
            <>
              <p className="mb-2 text-[11.5px] text-faint">
                {results.length > SHOWN
                  ? t("iceAdmin.search.more", { shown: SHOWN, total: results.length })
                  : t("iceAdmin.search.count", { n: results.length })}
              </p>
              <ul className="panel rounded-2xl">
                {results.slice(0, SHOWN).map(({ page, item }) => (
                  <li key={item ? `${page.path}|${item.id}` : page.path} data-ice-find-result={item?.id ?? page.path}
                    className="flex flex-col gap-2 border-b border-line/60 px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-ink">{item ? item.label : page.name}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-faint">
                        {item ? <>{page.name} · </> : <>{t("iceAdmin.search.wholePage")} · </>}
                        <code>{page.path}</code>
                      </p>
                      {item?.value && (
                        <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-muted">{item.value}</p>
                      )}
                      {item?.slots && (
                        <code className="mt-1 block truncate text-[11px] text-faint">{item.slots}</code>
                      )}
                    </div>
                    <IceEditButton path={page.path} elementId={item?.id ?? null} className="self-start sm:self-center" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
