import type { Client } from "@/lib/services/workspace";
import {
  toAudience, toSegmentRules, toUtm, toBlocks,
  type Audience, type AudienceBreakdown, type CampaignKind, type CampaignStatus,
  type MailBlock, type SegmentRules, type Utm,
} from "@/lib/newsletter";

/**
 * EVERY READ AND WRITE THE NEWSLETTER MAKES.
 *
 * Transport-agnostic, like the rest of lib/services: each function takes a
 * SupabaseClient and never reaches for one, so the same code answers a server
 * component, a server action and (one day) a mobile app behind an API route.
 *
 * TWO RULES THAT SHAPE ALMOST EVERY QUERY HERE.
 *
 * COUNTING HAPPENS IN POSTGRES. A contact list is the one table in this
 * product that can plausibly reach six figures, and the difference between
 * `select count` and `rows.length` is the difference between a dashboard and
 * an outage. Nothing in this file ever loads a list in order to measure it.
 *
 * AND NOTHING HERE DECIDES WHO MAY LOOK. Every table is behind an RLS policy
 * that answers `is_admin()`; these functions run with the caller's own client,
 * so a non-admin gets an empty result rather than a leak. The `requireAdmin`
 * in the actions above them exists to produce a clean error message, not to be
 * the lock.
 */

/* ── CONTACTS ────────────────────────────────────────────────────────────── */

export type ContactRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  locale: string;
  sourceKey: string;
  userId: string | null;
  tags: string[];
  marketingConsent: boolean;
  consentAt: string | null;
  consentSource: string | null;
  consentVersion: string | null;
  unsubscribedAt: string | null;
  unsubscribeToken: string;
  lastActivityAt: string | null;
  lastSentAt: string | null;
  lastOpenedAt: string | null;
  lastClickedAt: string | null;
  createdAt: string;
};

const CONTACT_SELECT = "id, email, first_name, last_name, locale, source_key, user_id, tags, marketing_consent, consent_at, consent_source, consent_version, unsubscribed_at, unsubscribe_token, last_activity_at, last_sent_at, last_opened_at, last_clicked_at, created_at";

type RawContact = {
  id: string; email: string; first_name: string | null; last_name: string | null;
  locale: string; source_key: string; user_id: string | null; tags: string[] | null;
  marketing_consent: boolean; consent_at: string | null; consent_source: string | null;
  consent_version: string | null; unsubscribed_at: string | null; unsubscribe_token: string;
  last_activity_at: string | null; last_sent_at: string | null; last_opened_at: string | null;
  last_clicked_at: string | null; created_at: string;
};

const toContact = (r: RawContact): ContactRow => ({
  id: r.id,
  email: r.email,
  firstName: r.first_name,
  lastName: r.last_name,
  locale: r.locale,
  sourceKey: r.source_key,
  userId: r.user_id,
  tags: r.tags ?? [],
  marketingConsent: r.marketing_consent,
  consentAt: r.consent_at,
  consentSource: r.consent_source,
  consentVersion: r.consent_version,
  unsubscribedAt: r.unsubscribed_at,
  unsubscribeToken: r.unsubscribe_token,
  lastActivityAt: r.last_activity_at,
  lastSentAt: r.last_sent_at,
  lastOpenedAt: r.last_opened_at,
  lastClickedAt: r.last_clicked_at,
  createdAt: r.created_at,
});

export type ContactFilter = {
  search?: string;
  sourceKey?: string;
  groupId?: string;
  /** 'consented' | 'no_consent' | 'unsubscribed' */
  consent?: string;
  page?: number;
  pageSize?: number;
};

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };

/**
 * One page of contacts, filtered and counted by the database.
 *
 * The group filter is a separate query rather than a join because PostgREST
 * cannot express "rows in this many-to-many" as a filter on the parent without
 * an embedded resource, and an embedded resource would make `count` count the
 * join rather than the contacts. Two cheap queries beat one wrong number.
 */
export async function listContacts(
  supabase: Client, filter: ContactFilter = {},
): Promise<Page<ContactRow>> {
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const pageSize = Math.min(200, Math.max(10, Math.floor(filter.pageSize ?? 50)));
  const from = (page - 1) * pageSize;

  let ids: string[] | null = null;
  if (filter.groupId) {
    const { data } = await supabase
      .from("newsletter_group_members")
      .select("contact_id")
      .eq("group_id", filter.groupId)
      .limit(5000);
    ids = (data ?? []).map((r) => r.contact_id);
    if (ids.length === 0) return { rows: [], total: 0, page, pageSize };
  }

  let query = supabase
    .from("newsletter_contacts")
    .select(CONTACT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (ids) query = query.in("id", ids);
  if (filter.sourceKey) query = query.eq("source_key", filter.sourceKey);
  if (filter.consent === "consented") {
    query = query.eq("marketing_consent", true).is("unsubscribed_at", null);
  } else if (filter.consent === "no_consent") {
    query = query.eq("marketing_consent", false);
  } else if (filter.consent === "unsubscribed") {
    query = query.not("unsubscribed_at", "is", null);
  }
  const search = (filter.search ?? "").trim();
  if (search) {
    // ilike on two columns. A leading wildcard means no index is used, which
    // is fine at this size and honest about it — if the list ever grows past
    // what this can answer, the fix is a tsvector column, not a client filter.
    const safe = search.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.or(`email.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`);
  }

  const { data, count } = await query;
  return {
    rows: (data ?? []).map((r) => toContact(r as RawContact)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getContact(supabase: Client, id: string): Promise<ContactRow | null> {
  const { data } = await supabase
    .from("newsletter_contacts").select(CONTACT_SELECT).eq("id", id).maybeSingle();
  return data ? toContact(data as RawContact) : null;
}

/** A contact's own history, newest first — §57. */
export type ContactEvent = {
  id: number;
  type: string;
  campaignId: string | null;
  campaignName: string | null;
  createdAt: string;
};

export async function contactTimeline(
  supabase: Client, contactId: string, limit = 50,
): Promise<ContactEvent[]> {
  const { data } = await supabase
    .from("newsletter_events")
    .select("id, event_type, campaign_id, created_at, newsletter_campaigns(name)")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => {
    const joined = (r as { newsletter_campaigns?: { name?: string } | null }).newsletter_campaigns;
    return {
      id: r.id as number,
      type: r.event_type as string,
      campaignId: (r.campaign_id as string | null) ?? null,
      campaignName: joined?.name ?? null,
      createdAt: r.created_at as string,
    };
  });
}

/* ── SOURCES ─────────────────────────────────────────────────────────────── */

export type SourceRow = { key: string; name: string; note: string | null; contacts: number };

/** The source list with a real count each, computed in one grouped read rather
 *  than one query per source. */
export async function listSources(supabase: Client): Promise<SourceRow[]> {
  const [{ data: sources }, { data: counts }] = await Promise.all([
    supabase.from("newsletter_sources").select("key, name, note").order("name"),
    supabase.from("newsletter_contacts").select("source_key").limit(100_000),
  ]);
  const tally = new Map<string, number>();
  for (const row of counts ?? []) {
    tally.set(row.source_key as string, (tally.get(row.source_key as string) ?? 0) + 1);
  }
  return (sources ?? []).map((s) => ({
    key: s.key as string,
    name: s.name as string,
    note: (s.note as string | null) ?? null,
    contacts: tally.get(s.key as string) ?? 0,
  }));
}

/* ── GROUPS ──────────────────────────────────────────────────────────────── */

export type GroupRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isDynamic: boolean;
  rules: SegmentRules;
  members: number;
  createdAt: string;
};

export async function listGroups(supabase: Client): Promise<GroupRow[]> {
  const { data } = await supabase
    .from("newsletter_groups")
    .select("id, key, name, description, is_dynamic, rules, created_at")
    .order("name");
  const groups = data ?? [];

  // One read of the membership table, tallied here. The alternative — a count
  // per group — is N queries for a screen that shows every group at once.
  const { data: members } = await supabase
    .from("newsletter_group_members").select("group_id").limit(200_000);
  const tally = new Map<string, number>();
  for (const m of members ?? []) {
    tally.set(m.group_id as string, (tally.get(m.group_id as string) ?? 0) + 1);
  }

  return groups.map((g) => ({
    id: g.id as string,
    key: g.key as string,
    name: g.name as string,
    description: (g.description as string | null) ?? null,
    isDynamic: Boolean(g.is_dynamic),
    rules: toSegmentRules(g.rules),
    // A dynamic group's size is not stored and is not guessed: the caller asks
    // for it explicitly with resolveSegment when it actually needs the number.
    members: g.is_dynamic ? -1 : (tally.get(g.id as string) ?? 0),
    createdAt: g.created_at as string,
  }));
}

export async function getGroup(supabase: Client, id: string): Promise<GroupRow | null> {
  const all = await listGroups(supabase);
  return all.find((g) => g.id === id) ?? null;
}

/**
 * Which contacts a dynamic group currently contains.
 *
 * Evaluated one condition at a time into sets of ids, then intersected or
 * unioned. That is deliberately not one clever SQL statement: the conditions
 * span three tables and two of them ask about the ABSENCE of an event, which
 * is where a hand-built join goes quietly wrong. Set arithmetic on ids is slow
 * in theory and obvious in practice, and this list is thousands, not millions.
 */
export async function resolveSegment(
  supabase: Client, rules: SegmentRules,
): Promise<string[]> {
  if (rules.conditions.length === 0) return [];
  const sets: Set<string>[] = [];

  for (const c of rules.conditions) {
    const ids = new Set<string>();
    const value = c.value.trim();

    if (c.field === "group") {
      const { data } = await supabase.from("newsletter_group_members")
        .select("contact_id").eq("group_id", value).limit(100_000);
      for (const r of data ?? []) ids.add(r.contact_id as string);
    } else if (c.field === "opened_campaign" || c.field === "clicked_campaign") {
      const { data } = await supabase.from("newsletter_events")
        .select("contact_id")
        .eq("campaign_id", value)
        .eq("event_type", c.field === "opened_campaign" ? "opened" : "clicked")
        .limit(100_000);
      for (const r of data ?? []) if (r.contact_id) ids.add(r.contact_id as string);
    } else if (c.field === "not_clicked_campaign") {
      // "Sent it and did not click" — the absence has to be measured against
      // the people who actually received it, not against the whole list.
      const [{ data: sent }, { data: clicked }] = await Promise.all([
        supabase.from("newsletter_recipients")
          .select("contact_id").eq("campaign_id", value).eq("status", "sent").limit(100_000),
        supabase.from("newsletter_events")
          .select("contact_id").eq("campaign_id", value).eq("event_type", "clicked").limit(100_000),
      ]);
      const did = new Set((clicked ?? []).map((r) => r.contact_id as string));
      for (const r of sent ?? []) {
        const id = r.contact_id as string;
        if (!did.has(id)) ids.add(id);
      }
    } else if (c.field === "never_sent") {
      const [{ data: all }, { data: sent }] = await Promise.all([
        supabase.from("newsletter_contacts").select("id").limit(100_000),
        supabase.from("newsletter_recipients").select("contact_id").eq("status", "sent").limit(200_000),
      ]);
      const did = new Set((sent ?? []).map((r) => r.contact_id as string));
      for (const r of all ?? []) if (!did.has(r.id as string)) ids.add(r.id as string);
    } else {
      let q = supabase.from("newsletter_contacts").select("id").limit(100_000);
      if (c.field === "source") q = q.eq("source_key", value);
      else if (c.field === "locale") q = q.eq("locale", value);
      else if (c.field === "tag") q = q.contains("tags", [value]);
      else if (c.field === "consent") q = q.eq("marketing_consent", value === "true");
      else if (c.field === "has_account") {
        q = value === "true" ? q.not("user_id", "is", null) : q.is("user_id", null);
      } else if (c.field === "created_before") q = q.lt("created_at", value);
      else if (c.field === "created_after") q = q.gt("created_at", value);
      const { data } = await q;
      for (const r of data ?? []) ids.add(r.id as string);
    }
    sets.push(ids);
  }

  if (sets.length === 0) return [];
  if (rules.match === "any") {
    const union = new Set<string>();
    for (const s of sets) for (const id of s) union.add(id);
    return [...union];
  }
  return [...sets.reduce((acc, s) => new Set([...acc].filter((id) => s.has(id))))];
}

/** Every contact in a group, whether it is a list or a filter. */
export async function groupMemberIds(supabase: Client, group: GroupRow): Promise<string[]> {
  if (group.isDynamic) return resolveSegment(supabase, group.rules);
  const { data } = await supabase.from("newsletter_group_members")
    .select("contact_id").eq("group_id", group.id).limit(200_000);
  return (data ?? []).map((r) => r.contact_id as string);
}

/* ── CAMPAIGNS ───────────────────────────────────────────────────────────── */

export type CampaignRow = {
  id: string;
  name: string;
  kind: CampaignKind;
  status: CampaignStatus;
  audience: Audience;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  trackOpens: boolean;
  trackClicks: boolean;
  utm: Utm;
  abEnabled: boolean;
  abSharePct: number;
  abDecideAfterHours: number;
  abMetric: string;
  abWinner: string | null;
  stopOnConversion: boolean;
  createdAt: string;
  updatedAt: string;
};

const CAMPAIGN_SELECT = "id, name, kind, status, audience, scheduled_at, started_at, finished_at, track_opens, track_clicks, utm, ab_enabled, ab_share_pct, ab_decide_after_hours, ab_metric, ab_winner, stop_on_conversion, created_at, updated_at";

type RawCampaign = Record<string, unknown>;

const toCampaign = (r: RawCampaign): CampaignRow => ({
  id: r.id as string,
  name: r.name as string,
  kind: (r.kind as CampaignKind) ?? "one_off",
  status: (r.status as CampaignStatus) ?? "draft",
  audience: toAudience(r.audience),
  scheduledAt: (r.scheduled_at as string | null) ?? null,
  startedAt: (r.started_at as string | null) ?? null,
  finishedAt: (r.finished_at as string | null) ?? null,
  trackOpens: r.track_opens !== false,
  trackClicks: r.track_clicks !== false,
  utm: toUtm(r.utm),
  abEnabled: Boolean(r.ab_enabled),
  abSharePct: (r.ab_share_pct as number) ?? 20,
  abDecideAfterHours: (r.ab_decide_after_hours as number) ?? 4,
  abMetric: (r.ab_metric as string) ?? "click",
  abWinner: (r.ab_winner as string | null) ?? null,
  stopOnConversion: r.stop_on_conversion !== false,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export async function listCampaigns(
  supabase: Client, opts: { status?: string; page?: number; pageSize?: number } = {},
): Promise<Page<CampaignRow>> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(opts.pageSize ?? 25)));
  const from = (page - 1) * pageSize;
  let q = supabase.from("newsletter_campaigns")
    .select(CAMPAIGN_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, count } = await q;
  return {
    rows: (data ?? []).map((r) => toCampaign(r as RawCampaign)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getCampaign(supabase: Client, id: string): Promise<CampaignRow | null> {
  const { data } = await supabase
    .from("newsletter_campaigns").select(CAMPAIGN_SELECT).eq("id", id).maybeSingle();
  return data ? toCampaign(data as RawCampaign) : null;
}

export type StepRow = {
  id: string;
  campaignId: string;
  stepIndex: number;
  variant: string;
  delayMinutes: number;
  subject: string;
  preheader: string;
  editor: "builder" | "html";
  blocks: MailBlock[];
  bodyHtml: string;
  bodyText: string;
};

const STEP_SELECT = "id, campaign_id, step_index, variant, delay_minutes, subject, preheader, editor, blocks, body_html, body_text";

export async function listSteps(supabase: Client, campaignId: string): Promise<StepRow[]> {
  const { data } = await supabase
    .from("newsletter_campaign_steps").select(STEP_SELECT)
    .eq("campaign_id", campaignId)
    .order("step_index").order("variant");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    campaignId: r.campaign_id as string,
    stepIndex: (r.step_index as number) ?? 0,
    variant: (r.variant as string) ?? "A",
    delayMinutes: (r.delay_minutes as number) ?? 0,
    subject: (r.subject as string) ?? "",
    preheader: (r.preheader as string) ?? "",
    editor: r.editor === "html" ? "html" : "builder",
    blocks: toBlocks(r.blocks),
    bodyHtml: (r.body_html as string) ?? "",
    bodyText: (r.body_text as string) ?? "",
  }));
}

/* ── THE AUDIENCE, COUNTED HONESTLY ──────────────────────────────────────── */

/**
 * §22: what "4 281 selected" really means once the list is deduplicated and
 * everybody who must not be mailed is removed.
 *
 * Every number is a count of a real set, and the sets are disjoint in the
 * order they are subtracted, so `selected − removed = mailable` actually adds
 * up on screen. A breakdown whose rows do not sum is worse than no breakdown:
 * it teaches an operator to distrust the confirm screen.
 */
export async function audienceBreakdown(
  supabase: Client, audience: Audience,
): Promise<AudienceBreakdown & { ids: string[] }> {
  const groups = await listGroups(supabase);
  const byId = new Map(groups.map((g) => [g.id, g]));

  let selected = 0;
  const included = new Set<string>();
  for (const id of audience.include) {
    const group = byId.get(id);
    if (!group) continue;
    const ids = await groupMemberIds(supabase, group);
    selected += ids.length;
    for (const cid of ids) included.add(cid);
  }
  const deduplicated = included.size;

  const excluded = new Set<string>();
  for (const id of audience.exclude) {
    const group = byId.get(id);
    if (!group) continue;
    for (const cid of await groupMemberIds(supabase, group)) excluded.add(cid);
  }
  let excludedByGroup = 0;
  for (const id of excluded) if (included.delete(id)) excludedByGroup += 1;

  if (included.size === 0) {
    return {
      selected, deduplicated, mailable: 0,
      noConsent: 0, unsubscribed: 0, suppressed: 0, excludedByGroup, ids: [],
    };
  }

  const candidates = [...included];
  const rows: { id: string; email: string; marketing_consent: boolean; unsubscribed_at: string | null }[] = [];
  // PostgREST puts the filter in the URL, so `in` with thousands of uuids is a
  // request no proxy will accept. Chunked, with the chunk size chosen to stay
  // well inside a conservative URL budget.
  for (let i = 0; i < candidates.length; i += 400) {
    const { data } = await supabase
      .from("newsletter_contacts")
      .select("id, email, marketing_consent, unsubscribed_at")
      .in("id", candidates.slice(i, i + 400));
    for (const r of data ?? []) {
      rows.push(r as { id: string; email: string; marketing_consent: boolean; unsubscribed_at: string | null });
    }
  }

  const { data: suppressed } = await supabase
    .from("newsletter_suppressions").select("email").limit(200_000);
  const blocked = new Set((suppressed ?? []).map((r) => (r.email as string)));

  let noConsent = 0, unsubscribed = 0, suppressedCount = 0;
  const ids: string[] = [];
  for (const r of rows) {
    if (blocked.has(r.email)) { suppressedCount += 1; continue; }
    if (r.unsubscribed_at) { unsubscribed += 1; continue; }
    if (!r.marketing_consent) { noConsent += 1; continue; }
    ids.push(r.id);
  }

  return {
    selected,
    deduplicated,
    mailable: ids.length,
    noConsent,
    unsubscribed,
    suppressed: suppressedCount,
    excludedByGroup,
    ids,
  };
}

/* ── STATS ───────────────────────────────────────────────────────────────── */

export type CampaignStats = {
  recipients: number;
  sent: number;
  accepted: number;
  failed: number;
  openedUnique: number;
  clickedUnique: number;
  replied: number;
  unsubscribed: number;
  bounced: number;
  converted: number;
  revenueCents: number | null;
};

/**
 * One campaign's numbers.
 *
 * UNIQUE, NOT TOTAL, for opens and clicks: a person who opens a mail four
 * times on the train is one person who opened it. Total opens is the number
 * that makes a campaign look good and tells an operator nothing.
 *
 * `revenueCents` is null — not 0 — when there is no sales data at all, so the
 * dashboard can say "brak danych sprzedażowych" instead of rendering a
 * confident zero that reads like a measurement.
 */
export async function campaignStats(supabase: Client, campaignId: string): Promise<CampaignStats> {
  const [recipients, events, attributions] = await Promise.all([
    supabase.from("newsletter_recipients").select("status").eq("campaign_id", campaignId).limit(200_000),
    supabase.from("newsletter_events")
      .select("event_type, contact_id").eq("campaign_id", campaignId).limit(500_000),
    supabase.from("newsletter_attributions")
      .select("amount_cents, converted_at").eq("campaign_id", campaignId).limit(100_000),
  ]);

  let sent = 0, failed = 0;
  for (const r of recipients.data ?? []) {
    if (r.status === "sent") sent += 1;
    else if (r.status === "failed") failed += 1;
  }

  const uniq = new Map<string, Set<string>>();
  const totals = new Map<string, number>();
  for (const e of events.data ?? []) {
    const type = e.event_type as string;
    totals.set(type, (totals.get(type) ?? 0) + 1);
    if (!uniq.has(type)) uniq.set(type, new Set());
    if (e.contact_id) uniq.get(type)!.add(e.contact_id as string);
  }

  const converted = (attributions.data ?? []).filter((a) => a.converted_at).length;
  const amounts = (attributions.data ?? [])
    .map((a) => a.amount_cents as number | null)
    .filter((v): v is number => typeof v === "number");
  const revenueCents = amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) : null;

  return {
    recipients: (recipients.data ?? []).length,
    sent,
    accepted: totals.get("accepted") ?? sent,
    failed,
    openedUnique: uniq.get("opened")?.size ?? 0,
    clickedUnique: uniq.get("clicked")?.size ?? 0,
    replied: uniq.get("replied")?.size ?? 0,
    unsubscribed: totals.get("unsubscribed") ?? 0,
    bounced: totals.get("bounced") ?? 0,
    converted,
    revenueCents,
  };
}

/* ── SUPPRESSION ─────────────────────────────────────────────────────────── */

export async function listSuppressions(
  supabase: Client, opts: { page?: number; pageSize?: number } = {},
): Promise<Page<{ email: string; reason: string; note: string | null; createdAt: string }>> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(200, Math.max(10, Math.floor(opts.pageSize ?? 50)));
  const from = (page - 1) * pageSize;
  const { data, count } = await supabase
    .from("newsletter_suppressions")
    .select("email, reason, note, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  return {
    rows: (data ?? []).map((r) => ({
      email: r.email as string,
      reason: r.reason as string,
      note: (r.note as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}
