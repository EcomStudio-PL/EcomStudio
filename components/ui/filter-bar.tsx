"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type FilterDef = {
  param: string;
  /** i18n key for the "all" option label */
  labelKey: string;
  options: { value: string; label: string }[];
};

/** URL-param backed filter bar: shareable, persistent, server-filtered. */
export function FilterBar({ searchParam = "q", filters = [] }: {
  searchParam?: string;
  filters?: FilterDef[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get(searchParam) ?? "");

  useEffect(() => setQ(params.get(searchParam) ?? ""), [params, searchParam]);

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  const activeCount =
    (params.get(searchParam) ? 1 : 0) + filters.filter((f) => params.get(f.param)).length;

  return (
    <form
      className="mb-5 flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); apply({ [searchParam]: q.trim() }); }}
    >
      <div className="w-full sm:w-64">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
        />
      </div>
      {filters.map((f) => (
        <div key={f.param} className="w-full sm:w-44">
          <Select
            value={params.get(f.param) ?? ""}
            aria-label={t(f.labelKey)}
            onChange={(e) => apply({ [f.param]: e.target.value })}
          >
            <option value="">{t(f.labelKey)}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
      ))}
      <Button type="submit" size="sm" variant="secondary">{t("common.search")}</Button>
      {activeCount > 0 && (
        <Button type="button" size="sm" variant="ghost" onClick={() => router.push(pathname)}>
          ✕ {t("common.clearFilters")} ({activeCount})
        </Button>
      )}
    </form>
  );
}
