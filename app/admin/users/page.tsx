import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { CustomerTable } from "@/components/admin/customer-table";
import {
  CUSTOMER_SORTS, REGISTERED_WINDOWS, readCustomerPlans, readCustomers,
  type CustomerSort,
} from "@/lib/services/admin-crm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ADMIN → KLIENCI.
 *
 * The same CRM as before, doing its job properly: search over name and
 * e-mail, filters that map to states the database can actually answer for,
 * sorting that sorts every customer rather than the page that happened to be
 * fetched, and paging with a real total.
 */

const PER_PAGE = 50;

type Search = {
  q?: string; role?: string; status?: string; verified?: string;
  plan?: string; registered?: string; sort?: string; page?: string;
};

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user: me } } = await supabase.auth.getUser();

  const page = Math.max(Number(sp.page) || 1, 1);
  const sort = (CUSTOMER_SORTS as readonly string[]).includes(sp.sort ?? "")
    ? (sp.sort as CustomerSort) : "newest";

  const [plans, result] = await Promise.all([
    readCustomerPlans(supabase),
    readCustomers(supabase, {
      search: sp.q, role: sp.role, status: sp.status, verified: sp.verified,
      plan: sp.plan, registered: Number(sp.registered) || undefined,
      sort, page, perPage: PER_PAGE,
    }),
  ]);

  const pages = Math.max(Math.ceil(result.total / PER_PAGE), 1);
  const linkTo = (next: number) => {
    const params = new URLSearchParams(
      Object.entries(sp).filter(([, v]) => v).map(([k, v]) => [k, String(v)]),
    );
    if (next > 1) params.set("page", String(next)); else params.delete("page");
    return `/admin/users${params.size ? `?${params}` : ""}`;
  };

  return (
    <div>
      <PageHeader title={t("admin.nav.users")} sub={t("crm.total", { n: result.total })} />

      <FilterBar
        filters={[
          {
            param: "status", labelKey: "crm.filterStatus",
            options: [
              { value: "active", label: t("crm.active") },
              { value: "blocked", label: t("crm.blocked") },
              // The subset an operator actually chases: paused accounts that
              // will come back on their own, so somebody can look before they do.
              { value: "temp", label: t("crm.statusTemp") },
            ],
          },
          {
            param: "verified", labelKey: "crm.filterVerified",
            options: [
              { value: "yes", label: t("crm.verified") },
              { value: "no", label: t("crm.unverified") },
            ],
          },
          // Only the plans that exist right now; a filter for a plan nobody is
          // on would always return nothing.
          ...(plans.length
            ? [{
                param: "plan", labelKey: "crm.filterPlan",
                options: [
                  { value: "free", label: t("crm.planFree") },
                  ...plans.map((p) => ({ value: p, label: p })),
                ],
              }]
            : []),
          {
            param: "registered", labelKey: "crm.filterRegistered",
            options: REGISTERED_WINDOWS.map((d) => ({ value: String(d), label: t("crm.lastDays", { n: d }) })),
          },
          {
            param: "role", labelKey: "admin.role",
            options: [
              { value: "admin", label: "admin" },
              { value: "manager", label: "manager" },
              { value: "user", label: "user" },
            ],
          },
          {
            param: "sort", labelKey: "crm.sortNewest",
            options: [
              { value: "oldest", label: t("crm.sortOldest") },
              { value: "name", label: t("crm.sortName") },
              { value: "spent", label: t("crm.sortSpent") },
              { value: "credits", label: t("crm.sortCredits") },
              { value: "active", label: t("crm.sortActive") },
            ],
          },
        ]}
      />

      <CustomerTable rows={result.rows} adminId={me?.id ?? null} locale={locale} />

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label={t("crm.pagination")}>
          <PageLink href={linkTo(page - 1)} disabled={page <= 1} label={t("common.back")}>
            <ChevronLeft size={16} aria-hidden />
          </PageLink>
          <span className="text-sm text-muted">{t("crm.pageOf", { page, pages })}</span>
          <PageLink href={linkTo(page + 1)} disabled={page >= pages} label={t("common.viewAll")}>
            <ChevronRight size={16} aria-hidden />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function PageLink({ href, disabled, label, children }: {
  href: string; disabled: boolean; label: string; children: React.ReactNode;
}) {
  const className = cn(
    "grid size-9 place-items-center rounded-lg border border-line transition-colors",
    disabled ? "pointer-events-none opacity-40" : "hover:border-accent hover:text-accent",
  );
  if (disabled) return <span aria-disabled className={className}>{children}</span>;
  return <Link href={href} aria-label={label} className={className}>{children}</Link>;
}
