"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Chip, ChipRow } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

/**
 * PRODUCT BROWSER FILTERS — a search field that looks like a search field and
 * status as a scrollable chip track, instead of a native <select> that reads
 * as a form control from 2014. Same URL-param contract as before, so the
 * server filtering is untouched.
 */
export function BrowserFilters({ statuses }: { statuses: { value: string; label: string }[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "";

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  return (
    <div className="mb-5 space-y-3">
      <form
        onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() }); }}
        className="relative"
      >
        <Search aria-hidden size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
          className={cn(
            "w-full rounded-2xl bg-sunken/70 py-3.5 pl-11 pr-11 text-base sm:text-sm",
            "border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.2))] placeholder:text-faint",
            "transition-[background-color,border-color,box-shadow] duration-150",
            "focus:bg-surface focus:border-[rgb(var(--accent)/0.55)] focus:outline-none focus:ring-4 focus:ring-[rgb(var(--accent)/0.14)]"
          )}
        />
        {q && (
          <button
            type="button"
            aria-label={t("common.clearFilters")}
            onClick={() => { setQ(""); apply({ q: "" }); }}
            className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={14} />
          </button>
        )}
      </form>

      <ChipRow>
        <Chip active={!status} onClick={() => apply({ status: "" })}>{t("common.all")}</Chip>
        {statuses.map((s) => (
          <Chip key={s.value} active={status === s.value}
            onClick={() => apply({ status: status === s.value ? "" : s.value })}>
            {s.label}
          </Chip>
        ))}
      </ChipRow>
    </div>
  );
}
