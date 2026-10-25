import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { SectionHeader } from "@/components/ui/section-header";
import { AnnouncementsAdmin, type AnnouncementRow } from "@/components/admin/announcements-admin";

/**
 * KOMUNIKATY — messages an admin writes to customers (Powiadomienia V2).
 *
 * This render only READS: the list, its read figures and the plans on
 * offer. Nothing is sent from here — publishing is an explicit action, and a
 * scheduled message is sent by the database's own minute tick (0160).
 * Role: enforced by app/admin/layout.tsx and again by every action and SQL
 * function underneath.
 */
export default async function CommunicationAnnouncements() {
  const supabase = await createClient();
  const [{ dict, locale }, { data: rows }, { data: stats }, { data: plans }] = await Promise.all([
    getDictionary(),
    supabase.from("admin_announcements")
      .select("id, title, body, cta_label, cta_href, priority, audience_label, status, publish_at, published_at, expires_at, recipient_count, withdrawn_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.rpc("announcement_stats"),
    // The plans as they are configured now — never a list written into code.
    supabase.from("subscription_plans").select("id, name, price_cents, sort_order")
      .eq("active", true).gt("price_cents", 0).order("sort_order"),
  ]);
  const t = makeT(dict);
  const byId = new Map((stats ?? []).map((s) => [s.announcement_id, s]));
  const list: AnnouncementRow[] = (rows ?? []).map((r) => ({
    ...r,
    delivered: byId.get(r.id)?.delivered ?? 0,
    reads: byId.get(r.id)?.reads ?? 0,
  }));

  return (
    <div>
      <SectionHeader title={t("comm.ann.title")} sub={t("comm.ann.sub")} />
      <AnnouncementsAdmin rows={list} plans={(plans ?? []).map((p) => ({ id: p.id, name: p.name }))} locale={locale} />
    </div>
  );
}
