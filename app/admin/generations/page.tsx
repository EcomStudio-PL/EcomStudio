import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";

/**
 * GENERACJE — the output log for every job the platform has run.
 *
 * It is a LOG, not a configuration screen: what a tool runs on lives in
 * Narzędzia i silniki, what it costs lives in Modele, API i koszty. So this
 * page only has to answer "what ran, for whom, and did it work" — one page of
 * fifty at a time, because a table of every generation ever is a slow query
 * and an unreadable screen at the same time.
 */

const PAGE_SIZE = 50;
const STATUSES = ["queued", "processing", "completed", "failed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

const TONE: Record<Status, "success" | "warning" | "accent" | "danger" | "neutral"> = {
  queued: "neutral",
  processing: "accent",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export default async function AdminGenerations({ searchParams }: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);

  const status = (STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as Status) : null;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("generation_jobs")
    .select("id, status, credits_charged, created_at, products(name), workspaces(name)",
      { count: "exact" })
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // A filter link always returns to page 1 — page 4 of "wszystkie" is not
  // page 4 of "błąd".
  const href = (next: Status | null) => next ? `/admin/generations?status=${next}` : "/admin/generations";
  const pageHref = (n: number) =>
    `/admin/generations?${new URLSearchParams({ ...(status ? { status } : {}), page: String(n) })}`;

  return (
    <div>
      <PageHeader title={t("admin.nav.generations")} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {[null, ...STATUSES].map((s) => (
          <Link key={s ?? "all"} href={href(s)} scroll={false}
            className={cn(
              "inline-flex min-h-[32px] items-center rounded-full px-3 text-[13px] font-medium transition-colors",
              s === status
                ? "bg-accent2-soft text-accent2"
                : "bg-raised text-muted hover:text-ink"
            )}>
            {s ? t(`history.st.${s}`) : t("common.all")}
          </Link>
        ))}
      </div>

      <AdminTable
        headers={[t("history.product"), "Workspace", t("common.status"), t("history.creditsCol"), t("common.date")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((j) => [
          j.products?.name ?? "—",
          j.workspaces?.name ?? "—",
          <Badge key="s" tone={TONE[j.status as Status] ?? "neutral"} dot>
            {t(`history.st.${j.status}`)}
          </Badge>,
          j.credits_charged,
          formatDate(j.created_at, locale),
        ])}
      />

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-muted">
          <span className="tabular-nums">
            {t("common.pageOf", { a: page, b: pages })} · {total}
          </span>
          <div className="flex items-center gap-2">
            <PageLink href={pageHref(page - 1)} disabled={page <= 1} label={t("common.back")}>‹</PageLink>
            <PageLink href={pageHref(page + 1)} disabled={page >= pages} label={t("common.next")}>›</PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

/** A disabled pager step is not a link at all — nothing to tab to, nothing to
 *  click that does nothing. */
function PageLink({ href, disabled, label, children }: {
  href: string; disabled: boolean; label: string; children: React.ReactNode;
}) {
  const cls = "inline-grid size-9 place-items-center rounded-lg text-base";
  if (disabled) {
    return <span aria-hidden className={cn(cls, "text-faint opacity-40")}>{children}</span>;
  }
  return (
    <Link href={href} aria-label={label}
      className={cn(cls, "text-muted transition-colors hover:bg-raised hover:text-ink")}>
      <span aria-hidden>{children}</span>
    </Link>
  );
}
