import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { usageByService } from "@/lib/services/usage";
import { customerEconomics } from "@/lib/services/economics";
import { Profitability } from "@/components/admin/profitability";
import { rolePresentation } from "@/lib/roles";
import { Card, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { UserActions } from "@/components/admin/user-actions";
import { ManagerSelect, CrmNotes } from "@/components/admin/crm-widgets";
import { CustomerActions } from "@/components/admin/customer-actions";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatCredits, formatDate, formatInstantShort } from "@/lib/utils";
import { blockStateOf } from "@/lib/server/account-block";

const pln = (cents: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(cents / 100);

export default async function CrmProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { dict, locale } = await getDictionary();
  const t = makeT(dict);
  const { data: { user: me } } = await supabase.auth.getUser();

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!profile) notFound();

  const { data: membership } = await supabase.from("workspace_members")
    .select("workspace_id, workspaces(id, name, created_at)")
    .eq("user_id", id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  const workspaceId = membership?.workspace_id;

  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const SETTLED = new Set(["succeeded", "paid", "completed"]);

  // No products query. The Produkty module is DISABLED — a customer cannot add
  // one — so "Produkty: 12" was a frozen number under a live service list, and
  // the round-trip that fetched it bought nothing.
  const [walletRes, paymentsRes, subRes, notesRes, managersRes, actsRes, serviceUsage] =
    await Promise.all([
      workspaceId
        ? supabase.from("credit_wallets").select("id, balance").eq("workspace_id", workspaceId).maybeSingle()
        : Promise.resolve({ data: null }),
      workspaceId
        ? supabase.from("payments").select("amount_cents, status, created_at").eq("workspace_id", workspaceId)
        : Promise.resolve({ data: [] }),
      workspaceId
        ? supabase.from("subscriptions").select("status, subscription_plans(name, price_cents)")
            .eq("workspace_id", workspaceId).eq("status", "active").maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("crm_notes").select("id, body, pinned, reminder_date, created_at, author:profiles!crm_notes_author_id_fkey(full_name, email)")
        .eq("user_id", id).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(30),
      supabase.from("profiles").select("id, full_name, email").in("role", ["admin", "manager"]),
      workspaceId
        ? supabase.from("activity_logs").select("id, action, created_at").eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false }).limit(15)
        : Promise.resolve({ data: [] }),
      workspaceId ? usageByService(supabase, { workspaceId }) : Promise.resolve([]),
    ]);

  // Verification and last sign-in live in auth.users; 0068 exposes exactly
  // those two facts to admins. A missing row reads as "not verified" rather
  // than as a broken page.
  const { data: facts } = await supabase.rpc("admin_user_facts", { p_ids: [id] });
  const auth = (facts ?? [])[0] ?? null;
  const verified = auth?.email_confirmed_at != null;
  // The same rule the gate uses, so this page cannot show "blocked" for a
  // pause that expired an hour ago.
  const block = blockStateOf(profile);

  // Contribution economics: settled payments minus the REAL provider cost
  // recorded on each usage event.
  const economics = workspaceId ? await customerEconomics(supabase, workspaceId) : null;

  const wallet = walletRes.data as { id: string; balance: number } | null;
  const { data: txs } = wallet
    ? await supabase.from("credit_transactions").select("id, amount, type, description, created_at, balance_after")
        .eq("wallet_id", wallet.id).order("created_at", { ascending: false }).limit(15)
    : { data: [] };

  const settled = (paymentsRes.data ?? []).filter((p) => SETTLED.has(p.status));
  const revTotal = settled.reduce((s, p) => s + p.amount_cents, 0);
  const rev30 = settled.filter((p) => p.created_at >= d30).reduce((s, p) => s + p.amount_cents, 0);
  const rev7 = settled.filter((p) => p.created_at >= d7).reduce((s, p) => s + p.amount_cents, 0);
  const purchaseCount = settled.length;
  const avgPurchase = purchaseCount > 0 ? revTotal / purchaseCount : 0;
  const mrr = subRes.data?.subscription_plans?.price_cents ?? 0;

  const creditStats = (txs ?? []).length >= 0 ? await creditBreakdown(wallet?.id) : null;
  async function creditBreakdown(walletId?: string) {
    if (!walletId) return { purchased: 0, bonus: 0, used: 0, lastTopup: null as string | null };
    const { data } = await supabase.from("credit_transactions").select("amount, type, created_at").eq("wallet_id", walletId).limit(5000);
    const rows = data ?? [];
    return {
      purchased: rows.filter((r) => (r.type === "topup" || r.type === "purchase") && r.amount > 0).reduce((s, r) => s + r.amount, 0),
      bonus: rows.filter((r) => (r.type === "bonus" || r.type === "promotion" || r.type === "admin_grant") && r.amount > 0).reduce((s, r) => s + r.amount, 0),
      used: rows.filter((r) => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0),
      lastTopup: rows.filter((r) => r.type === "topup" && r.amount > 0).map((r) => r.created_at).sort().pop() ?? null,
    };
  }

  // Timeline: activity log + credit transactions, merged, newest first.
  const timeline = [
    ...(actsRes.data ?? []).map((a) => ({ at: a.created_at, label: a.action, tone: "neutral" as const })),
    ...(txs ?? []).map((tx) => ({
      at: tx.created_at,
      label: `${t(`credits.tt.${tx.type}`)} ${tx.amount > 0 ? "+" : ""}${tx.amount}`,
      tone: tx.amount >= 0 ? ("green" as const) : ("red" as const),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);

  const rp = rolePresentation(profile.role);
  const initial = (profile.full_name ?? profile.email).charAt(0).toUpperCase();

  return (
    <div>
      <div className="mb-4"><Link href="/admin/users" className="text-sm text-muted hover:text-ink">← {t("admin.nav.users")}</Link></div>

      {/* Header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className="brand-gradient flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white">
              {initial}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-xl font-semibold">{profile.full_name ?? profile.email}</h1>
                <Badge tone={profile.role === "admin" ? "info" : "neutral"}>{t(rp.labelKey)}</Badge>
                {block.blocked && (block.until
                  ? <Badge tone="warning" dot>
                      {t("crm.blockedUntil", { when: formatInstantShort(block.until, locale) })}
                    </Badge>
                  : <Badge tone="danger">{t("crm.blocked")}</Badge>)}
                <Badge tone={verified ? "success" : "neutral"}>
                  {verified ? t("crm.verified") : t("crm.unverified")}
                </Badge>
              </div>
              <p className="truncate text-sm text-muted">{profile.email}</p>
              <p className="mt-0.5 text-xs text-faint">
                {t("common.created")}: {formatDate(profile.created_at, locale)}
                {auth?.last_sign_in_at
                  ? <> · {t("crm.lastActive")}: <RelativeTime at={auth.last_sign_in_at} locale={locale} t={t} /></>
                  : ""}
                {membership?.workspaces?.name ? ` · ${membership.workspaces.name}` : ""}
                {subRes.data?.subscription_plans?.name ? ` · ${subRes.data.subscription_plans.name}` : " · Free"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <UserActions userId={profile.id} role={profile.role} isSelf={profile.id === me?.id} balance={wallet?.balance ?? null} />
            {/* The same ⋯ menu as the list — suspend lives in it, so the
                stand-alone block button would have been a second door to the
                same room. */}
            <CustomerActions userId={profile.id} email={profile.email} blocked={block.blocked}
              blockedUntil={block.until} verified={verified} isSelf={profile.id === me?.id} />
            <ManagerSelect userId={profile.id} current={profile.account_manager_id}
              managers={(managersRes.data ?? []).map((m) => ({ id: m.id, label: m.full_name ?? m.email }))} />
          </div>
        </div>
      </Card>

      {/* Finance + credits */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("crm.spentTotal")} value={pln(revTotal)} accent2 />
        <Stat label={t("crm.spent30")} value={pln(rev30)} hint={`7d: ${pln(rev7)}`} />
        <Stat label={t("crm.avgPurchase")} value={pln(avgPurchase)} hint={`${purchaseCount} ${t("crm.purchases")}`} />
        <Stat label="MRR" value={pln(mrr)} />
        <Stat label={t("crm.creditsBalance")} value={formatCredits(wallet?.balance ?? 0)} accent />
        <Stat label={t("crm.creditsPurchased")} value={formatCredits(creditStats?.purchased ?? 0)} />
        <Stat label={t("crm.creditsBonus")} value={formatCredits(creditStats?.bonus ?? 0)} />
        <Stat label={t("crm.creditsUsed")} value={formatCredits(creditStats?.used ?? 0)}
          hint={creditStats?.lastTopup ? `${t("crm.lastTopup")}: ${formatDate(creditStats.lastTopup, locale)}` : undefined} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* Dynamic service usage — driven by the service catalog */}
        {economics && (
          <div className="lg:col-span-2">
            <Profitability locale={locale} data={{
              slices: economics.slices, models: economics.models,
              anomalies: economics.anomalies, usdToPln: economics.usdToPln,
            }} />
          </div>
        )}

        <Card>
          <CardHeader title={t("crm.aiUsage")} sub={t("crm.aiUsageSub")} />
          {serviceUsage.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {serviceUsage.map((s) => (
                <li key={s.slug} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.slug}</p>
                    <p className="text-xs text-muted">
                      {s.succeeded}/{s.total} OK · {formatCredits(s.credits)} {t("nav.credits").toLowerCase()}
                      {s.lastAt ? ` · ${formatDate(s.lastAt, locale)}` : ""}
                    </p>
                  </div>
                  <Badge tone={s.failed > 0 ? "accent" : "success"}>{s.total}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader title={t("crm.timeline")} />
          {timeline.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {timeline.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.tone === "green" ? "bg-success" : e.tone === "red" ? "bg-danger" : "bg-faint"}`} />
                    <code className="truncate text-xs">{e.label}</code>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{formatDate(e.at, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Notes + recent credit ledger */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("crm.notes")} sub={t("crm.notesSub")} />
          <div className="px-4 pb-5 sm:px-5">
            <CrmNotes userId={profile.id}
              notes={(notesRes.data ?? []).map((n) => ({
                id: n.id, body: n.body, pinned: n.pinned, reminder_date: n.reminder_date,
                created_at: n.created_at, author: n.author?.full_name ?? n.author?.email ?? null,
              }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("credits.historyTitle")} action={
            workspaceId ? <Link href={`/admin/credits`} className="text-sm text-accent">{t("common.viewAll")}</Link> : undefined
          } />
          {(txs ?? []).length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{t("admin.noData")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(txs ?? []).map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{t(`credits.tt.${tx.type}`)}</p>
                    <p className="truncate text-xs text-muted">{tx.description ?? formatDate(tx.created_at, locale)}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={tx.amount >= 0 ? "success" : "danger"}>{tx.amount >= 0 ? "+" : ""}{tx.amount}</Badge>
                    {tx.balance_after != null && <span className="text-xs text-faint">→ {tx.balance_after}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
