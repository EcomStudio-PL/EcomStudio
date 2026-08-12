import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { UserActions } from "@/components/admin/user-actions";
import { FilterBar } from "@/components/ui/filter-bar";
import { formatDate } from "@/lib/utils";

const pln = (cents: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(cents / 100);
const SETTLED = new Set(["succeeded", "paid", "completed"]);

export default async function AdminUsers({ searchParams }: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  const { q, role } = await searchParams;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user: me } } = await supabase.auth.getUser();
  let query = supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(200);
  if (q) query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);
  if (role === "admin" || role === "user" || role === "manager") query = query.eq("role", role);
  const [{ data }, { data: memberships }, { data: payments }, { data: usage }, { data: subs }] = await Promise.all([
    query,
    supabase.from("workspace_members").select("user_id, workspaces(id, name, credit_wallets(balance))"),
    supabase.from("payments").select("workspace_id, amount_cents, status").limit(20000),
    supabase.from("usage_events").select("user_id, created_at").order("created_at", { ascending: false }).limit(20000),
    supabase.from("subscriptions").select("workspace_id, status, subscription_plans(name)").eq("status", "active"),
  ]);
  const wsByUser = new Map((memberships ?? []).map((m) => [m.user_id, m.workspaces]));
  const revByWs = new Map<string, number>();
  for (const p of payments ?? []) {
    if (SETTLED.has(p.status)) revByWs.set(p.workspace_id, (revByWs.get(p.workspace_id) ?? 0) + p.amount_cents);
  }
  const planByWs = new Map((subs ?? []).map((s) => [s.workspace_id, s.subscription_plans?.name]));
  const gensByUser = new Map<string, { n: number; last: string }>();
  for (const u of usage ?? []) {
    if (!u.user_id) continue;
    const cur = gensByUser.get(u.user_id);
    if (cur) cur.n += 1;
    else gensByUser.set(u.user_id, { n: 1, last: u.created_at });
  }

  return (
    <div>
      <PageHeader title={t("admin.nav.users")} />
      <FilterBar filters={[{
        param: "role",
        labelKey: "admin.role",
        options: [{ value: "admin", label: "admin" }, { value: "manager", label: "manager" }, { value: "user", label: "user" }],
      }]} />
      <AdminTable
        headers={[t("admin.user"), t("admin.role"), t("plan.title"), t("nav.credits"), t("crm.spentTotal"), t("analytics.generations"), t("crm.lastActive"), t("common.actions")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((u) => {
          const ws = wsByUser.get(u.id);
          const gens = gensByUser.get(u.id);
          return [
            <div key="n" className="min-w-0">
              <a href={`/admin/users/${u.id}`} className="font-medium text-accent hover:underline">
                {u.full_name ?? u.email}
              </a>
              <p className="truncate text-xs text-muted">{u.email}</p>
            </div>,
            <span key="r" className="flex gap-1">
              <Badge tone={u.role === "admin" ? "indigo" : "neutral"}>{u.role}</Badge>
              {u.blocked && <Badge tone="red">✕</Badge>}
            </span>,
            (ws ? planByWs.get(ws.id) : null) ?? "Free",
            ws?.credit_wallets?.balance ?? "—",
            ws ? pln(revByWs.get(ws.id) ?? 0) : "—",
            gens?.n ?? 0,
            gens?.last ? formatDate(gens.last, locale) : formatDate(u.created_at, locale),
            <UserActions key="a" userId={u.id} role={u.role} isSelf={u.id === me?.id}
              balance={ws?.credit_wallets?.balance ?? null} />,
          ];
        })}
      />
    </div>
  );
}
