import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { AdminTable } from "@/components/ui/admin-table";
import { Badge } from "@/components/ui/badge";
import { UserActions } from "@/components/admin/user-actions";
import { FilterBar } from "@/components/ui/filter-bar";
import { formatDate } from "@/lib/utils";

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
  if (role === "admin" || role === "user") query = query.eq("role", role);
  const { data } = await query;
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("user_id, workspaces(name, credit_wallets(balance))");
  const wsByUser = new Map(
    (memberships ?? []).map((m) => [m.user_id, m.workspaces])
  );
  return (
    <div>
      <PageHeader title={t("admin.nav.users")} />
      <FilterBar filters={[{
        param: "role",
        labelKey: "admin.role",
        options: [{ value: "admin", label: "admin" }, { value: "user", label: "user" }],
      }]} />
      <AdminTable
        headers={[t("admin.user"), t("auth.email"), t("admin.role"), t("settings.workspace"), t("nav.credits"), t("common.created"), t("common.actions")]}
        empty={t("admin.noData")}
        rows={(data ?? []).map((u) => {
          const ws = wsByUser.get(u.id);
          return [
            u.full_name ?? "—",
            u.email,
            <Badge key="r" tone={u.role === "admin" ? "green" : "neutral"}>{u.role}</Badge>,
            ws?.name ?? "—",
            ws?.credit_wallets?.balance ?? "—",
            formatDate(u.created_at, locale),
            <UserActions key="a" userId={u.id} role={u.role} isSelf={u.id === me?.id}
              balance={ws?.credit_wallets?.balance ?? null} />,
          ];
        })}
      />
    </div>
  );
}
