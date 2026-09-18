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
  /** The CONTACT's language — 'pl' | 'en' | 'de' — not the operator's. It is
   *  what decides which wording a campaign reaches them in, so it is a filter
   *  an operator picks an audience by, and the export honours it for the same
   *  reason the other four are honoured: the file has to be the list that was
   *  on screen when they asked for it. */
  locale?: string;
  /** Exactly these contacts, and nothing else — what the bulk bar's "export"
   *  means when an operator has ticked fourteen rows. It INTERSECTS with the
   *  other filters rather than replacing them, so a selection made under a
   *  filter cannot quietly widen into rows the operator never saw. */
  ids?: string[];
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
  if (filter.ids && filter.ids.length > 0) {
    const chosen = new Set(filter.ids);
    ids = ids ? ids.filter((id) => chosen.has(id)) : [...chosen];
    if (ids.length === 0) return { rows: [], total: 0, page, pageSize };
  }

  let query = supabase
    .from("newsletter_contacts")
    .select(CONTACT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (ids) query = query.in("id", ids);
  if (filter.sourceKey) query = query.eq("source_key", filter.sourceKey);
  if (filter.locale) query = query.eq("locale", filter.locale);
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

/* ── FREEZING AN AUDIENCE INTO A QUEUE ───────────────────────────────────── */

/**
 * The moment a campaign stops being a draft.
 *
 * Every message that will ever be sent becomes a row here, once, before
 * anything goes out. Three consequences worth stating, because each of them is
 * a decision:
 *
 * THE AUDIENCE IS FROZEN. A contact who joins the group after this runs is not
 * in this campaign. That is the honest reading of "send to these people" — the
 * alternative, a live query at send time, means the recipient count on the
 * confirm screen was never the truth.
 *
 * THE WHOLE SEQUENCE IS QUEUED AT ONCE, with each step's `send_after` computed
 * from the cumulative delay. A later step is therefore cancellable (stop on
 * conversion, unsubscribe) by flipping pending rows, and no step depends on a
 * worker invocation having survived to create it.
 *
 * AND IT IS SAFE TO RUN TWICE. Every insert lands on the unique index
 * (campaign, step, contact); a re-run inserts what is missing and collides
 * harmlessly with what is not. That is what makes a retried action, a
 * double-tapped button and a resumed campaign all the same operation.
 *
 * ── WHY IT REPORTS `queued` AS WELL AS `mailable` ───────────────────────────
 *
 * `mailable` is a fact about the AUDIENCE: how many people could be written to.
 * It is NOT how many will be, and the two diverge in two ordinary cases that
 * both used to be reported to the operator as the larger number:
 *
 *   · A/B IS ON. Only the test share is queued for the first message (see
 *     below), so "4 281 odbiorców" on the confirm screen described a send of
 *     856. Nothing in the product picks a winner yet, so the other 3 425 are
 *     not waiting for anything — they are simply not in this campaign.
 *   · THE CAMPAIGN WAS CANCELLED AND RESCHEDULED. Cancelling sets every queued
 *     row to 'cancelled', and those rows still occupy the unique index, so the
 *     re-run inserts nothing and the queue stays empty. The old return said
 *     "mailable: 4 281" for a campaign that was about to send zero messages.
 *
 * `queued` counts what is actually pending for the first message — the number
 * of people who will receive it. A confirm screen that says anything else is
 * not a confirmation, it is a guess with a button under it.
 */
export async function snapshotRecipients(
  supabase: Client,
  campaign: CampaignRow,
  steps: StepRow[],
  opts: { startAt?: Date } = {},
): Promise<{ created: number; mailable: number; queued: number }> {
  const breakdown = await audienceBreakdown(supabase, campaign.audience);
  if (breakdown.ids.length === 0) return { created: 0, mailable: 0, queued: 0 };

  const base = opts.startAt ?? new Date();
  const contacts = await contactEmails(supabase, breakdown.ids);

  // Which variants exist per step. A step with one row is not an A/B test; a
  // step with three is, and the audience is split across exactly those.
  const byStep = new Map<number, string[]>();
  for (const s of steps) {
    const list = byStep.get(s.stepIndex) ?? [];
    if (!list.includes(s.variant)) list.push(s.variant);
    byStep.set(s.stepIndex, list.sort());
  }

  const rows: {
    campaign_id: string; step_index: number; variant: string;
    contact_id: string; email: string; send_after: string;
  }[] = [];

  let cumulative = 0;
  for (const stepIndex of [...byStep.keys()].sort((a, b) => a - b)) {
    const variants = byStep.get(stepIndex) ?? ["A"];
    const delay = steps.find((s) => s.stepIndex === stepIndex)?.delayMinutes ?? 0;
    cumulative += stepIndex === 0 ? 0 : delay;
    const sendAfter = new Date(base.getTime() + cumulative * 60_000).toISOString();

    // A/B: only the test share is queued now. The rest waits for a winner and
    // is queued by the decision, so nobody is sent a variant that lost.
    const abOn = campaign.abEnabled && variants.length > 1 && stepIndex === 0;
    const pool = abOn
      ? breakdown.ids.slice(0, Math.max(variants.length,
        Math.round((breakdown.ids.length * campaign.abSharePct) / 100)))
      : breakdown.ids;

    pool.forEach((contactId, i) => {
      const email = contacts.get(contactId);
      if (!email) return;
      rows.push({
        campaign_id: campaign.id,
        step_index: stepIndex,
        // Round-robin rather than a random draw: an even split is the point,
        // and a random one is only even in expectation.
        variant: abOn ? variants[i % variants.length] : variants[0],
        contact_id: contactId,
        email,
        send_after: sendAfter,
      });
    });
  }

  let created = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data } = await supabase
      .from("newsletter_recipients")
      .upsert(chunk as never, {
        onConflict: "campaign_id,step_index,contact_id",
        ignoreDuplicates: true,
      })
      .select("id");
    created += (data ?? []).length;
  }

  /*
    WHAT WILL ACTUALLY GO OUT, read back from the table rather than counted from
    the array above. `created` is only the rows this call inserted, so a re-run
    of a half-queued campaign would report zero; the rows already sitting in the
    queue are just as much part of this send. Counting the FIRST step is what
    makes this a number of people rather than a number of messages — a sequence
    queues every step at once, and "4 281 odbiorców" must not become "12 843"
    because the campaign has three of them.
  */
  const firstStep = [...byStep.keys()].sort((a, b) => a - b)[0] ?? 0;
  const { count } = await supabase
    .from("newsletter_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("step_index", firstStep)
    .eq("status", "pending");

  return { created, mailable: breakdown.mailable, queued: count ?? 0 };
}

/** Address per contact id, chunked to keep the request URL sane. */
async function contactEmails(supabase: Client, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 400) {
    const { data } = await supabase
      .from("newsletter_contacts").select("id, email").in("id", ids.slice(i, i + 400));
    for (const r of data ?? []) out.set(r.id as string, r.email as string);
  }
  return out;
}

/**
 * Register every destination a campaign links to, so the redirect endpoint can
 * resolve an id instead of trusting a URL. Returns the map the renderer needs.
 *
 * IT READS FIRST AND INSERTS WHAT IS MISSING, rather than upserting.
 *
 * That is not a style preference, it is the only thing that works here. 0094's
 * uniqueness is `newsletter_links_unique (campaign_id, md5(url))` — an
 * EXPRESSION index, chosen so a 2000-character tracking URL still fits in an
 * index tuple. PostgREST turns `onConflict: "campaign_id,url"` into
 * `ON CONFLICT (campaign_id, url)`, and Postgres matches a conflict target
 * against index COLUMNS: `(campaign_id, md5(url))` is not `(campaign_id, url)`,
 * so every such call came back 42P10 "no unique or exclusion constraint
 * matching the ON CONFLICT specification".
 *
 * The consequence was silent and total. `scheduleCampaignAction` does not check
 * this function's error — it cannot, the old signature had nowhere to put
 * one — so no link row was ever written, the map came back empty, and
 * `renderCampaign` fell back to the plain destination for every href. Click
 * tracking was off for every campaign ever sent while the campaign screen went
 * on saying it was on, which is the exact failure `scheduleCampaignAction`'s
 * own comment says the ordering of its three writes exists to prevent.
 *
 * A read-then-insert has a race — two operators scheduling one campaign in the
 * same second — and it is harmless: the loser hits the unique index, its insert
 * fails, and the final read below picks up the row the winner wrote. The map is
 * built from what the table actually holds, never from what we believe we put
 * there.
 */
export async function ensureLinks(
  supabase: Client, campaignId: string, urls: string[],
): Promise<Map<string, string>> {
  if (urls.length > 0) {
    const { data: known } = await supabase
      .from("newsletter_links").select("url").eq("campaign_id", campaignId);
    const have = new Set((known ?? []).map((r) => r.url as string));
    const missing = [...new Set(urls)].filter((url) => !have.has(url));

    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200);
      const { error } = await supabase.from("newsletter_links").insert(
        chunk.map((url) => ({ campaign_id: campaignId, url })) as never,
      );
      // One INSERT is one statement, so a single colliding row would take the
      // other 199 down with it. That only happens when somebody else registered
      // the same campaign's links a moment ago, so the retry is per row and
      // every failure is ignored: whatever is already there is what we wanted.
      if (error) {
        for (const url of chunk) {
          await supabase.from("newsletter_links").insert({ campaign_id: campaignId, url } as never);
        }
      }
    }
  }

  const { data } = await supabase
    .from("newsletter_links").select("id, url").eq("campaign_id", campaignId);
  return new Map((data ?? []).map((r) => [r.url as string, r.id as string]));
}

/* ── DASHBOARD ───────────────────────────────────────────────────────────── */

export type DashboardTotals = {
  contacts: number;
  newContacts: number;
  /** Everyone snapshotted into a send in this range, whatever became of them:
   *  the funnel's first stage. Counting `sent + failed` instead would quietly
   *  shrink the top of the funnel every time a queue still has work in it, and
   *  a funnel whose first stage moves is one nobody can reason about. */
  recipients: number;
  sent: number;
  accepted: number;
  failed: number;
  openedUnique: number;
  clickedUnique: number;
  replied: number;
  unsubscribed: number;
  converted: number;
  revenueCents: number | null;
  /** False when billing is not live at all, so the UI can say so instead of
   *  rendering a confident zero. */
  hasSalesData: boolean;
};

export async function dashboardTotals(
  supabase: Client, sinceIso: string, untilIso: string,
): Promise<DashboardTotals> {
  const [contacts, fresh, events, recipients, attributions, payments] = await Promise.all([
    supabase.from("newsletter_contacts").select("id", { count: "exact", head: true }),
    supabase.from("newsletter_contacts").select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso).lte("created_at", untilIso),
    supabase.from("newsletter_events").select("event_type, contact_id")
      .gte("created_at", sinceIso).lte("created_at", untilIso).limit(500_000),
    supabase.from("newsletter_recipients").select("status")
      .gte("created_at", sinceIso).lte("created_at", untilIso).limit(500_000),
    supabase.from("newsletter_attributions").select("amount_cents, converted_at")
      .gte("created_at", sinceIso).lte("created_at", untilIso).limit(100_000),
    // THE HONESTY CHECK. Not "how much revenue" but "is there a payments
    // system at all" — the answer decides between a number and a sentence.
    supabase.from("payments").select("id", { count: "exact", head: true }),
  ]);

  const uniq = new Map<string, Set<string>>();
  const totals = new Map<string, number>();
  for (const e of events.data ?? []) {
    const type = e.event_type as string;
    totals.set(type, (totals.get(type) ?? 0) + 1);
    if (!uniq.has(type)) uniq.set(type, new Set());
    if (e.contact_id) uniq.get(type)!.add(e.contact_id as string);
  }

  let sent = 0, failed = 0;
  for (const r of recipients.data ?? []) {
    if (r.status === "sent") sent += 1;
    else if (r.status === "failed") failed += 1;
  }

  const amounts = (attributions.data ?? [])
    .map((a) => a.amount_cents as number | null)
    .filter((v): v is number => typeof v === "number");

  return {
    contacts: contacts.count ?? 0,
    newContacts: fresh.count ?? 0,
    recipients: (recipients.data ?? []).length,
    sent,
    accepted: totals.get("accepted") ?? sent,
    failed,
    openedUnique: uniq.get("opened")?.size ?? 0,
    clickedUnique: uniq.get("clicked")?.size ?? 0,
    replied: uniq.get("replied")?.size ?? 0,
    unsubscribed: totals.get("unsubscribed") ?? 0,
    converted: (attributions.data ?? []).filter((a) => a.converted_at).length,
    revenueCents: amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) : null,
    hasSalesData: (payments.count ?? 0) > 0,
  };
}

/** How many messages are waiting, for the dashboard and the worker panel. */
export async function queueDepth(supabase: Client): Promise<number> {
  const { count } = await supabase
    .from("newsletter_recipients").select("id", { count: "exact", head: true })
    .in("status", ["pending", "sending"]);
  return count ?? 0;
}

/* ── AUTOMATIONS ─────────────────────────────────────────────────────────── */

export type AutomationRow = {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  campaignId: string;
  campaignName: string | null;
  createdAt: string;
};

export async function listAutomations(supabase: Client): Promise<AutomationRow[]> {
  const { data } = await supabase
    .from("newsletter_automations")
    .select("id, name, enabled, trigger_type, trigger_config, campaign_id, created_at, newsletter_campaigns(name)")
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    enabled: Boolean(r.enabled),
    triggerType: r.trigger_type as string,
    triggerConfig: (r.trigger_config ?? {}) as Record<string, unknown>,
    campaignId: r.campaign_id as string,
    campaignName: (r as { newsletter_campaigns?: { name?: string } | null })
      .newsletter_campaigns?.name ?? null,
    createdAt: r.created_at as string,
  }));
}

/* ── TEMPLATES ───────────────────────────────────────────────────────────── */

export type TemplateRow = {
  id: string;
  name: string;
  category: string;
  subject: string;
  preheader: string;
  editor: "builder" | "html";
  blocks: MailBlock[];
  bodyHtml: string;
  isBuiltin: boolean;
};

export async function listTemplates(supabase: Client): Promise<TemplateRow[]> {
  const { data } = await supabase
    .from("newsletter_templates")
    .select("id, name, category, subject, preheader, editor, blocks, body_html, is_builtin")
    .order("is_builtin", { ascending: false }).order("name");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    category: (r.category as string) ?? "custom",
    subject: (r.subject as string) ?? "",
    preheader: (r.preheader as string) ?? "",
    editor: r.editor === "html" ? "html" : "builder",
    blocks: toBlocks(r.blocks),
    bodyHtml: (r.body_html as string) ?? "",
    isBuiltin: Boolean(r.is_builtin),
  }));
}

/* ── READS THE WRITE PATH NEEDS ──────────────────────────────────────────────
 *
 * Appended for app/actions/newsletter.ts. Both of these exist because the
 * obvious alternative is worse in a way that only shows up in production.
 */

/**
 * One template, by id.
 *
 * `listTemplates` already exists and would answer this — by fetching every
 * template, every block array and every pasted HTML document in the table, so
 * that "Użyj" can read one of them. A template body is the largest text this
 * module stores; loading all of them to use one is the kind of thing that is
 * invisible with eight rows and embarrassing with two hundred.
 */
export async function getTemplate(supabase: Client, id: string): Promise<TemplateRow | null> {
  const { data } = await supabase
    .from("newsletter_templates")
    .select("id, name, category, subject, preheader, editor, blocks, body_html, is_builtin")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    category: (data.category as string) ?? "custom",
    subject: (data.subject as string) ?? "",
    preheader: (data.preheader as string) ?? "",
    editor: data.editor === "html" ? "html" : "builder",
    blocks: toBlocks(data.blocks),
    bodyHtml: (data.body_html as string) ?? "",
    isBuiltin: Boolean(data.is_builtin),
  };
}

/**
 * EVERY contact matching a filter, for the CSV export — not one page of them.
 *
 * `listContacts` caps `pageSize` at 200 because it answers a screen, and that
 * cap is right there. An export that silently handed back the first 200 rows of
 * a 4 000-row list would be worse than no export: the operator would have no
 * way to tell, and would go on to treat the file as the list.
 *
 * So this pages through in blocks of 1 000 (PostgREST's own default ceiling is
 * 1 000 rows per request) until the filter is exhausted or `limit` is reached,
 * and the caller is told which happened by comparing `rows.length` to `limit`.
 */
export async function contactsForExport(
  supabase: Client, filter: ContactFilter = {}, limit = 50_000,
): Promise<ContactRow[]> {
  const ceiling = Math.min(200_000, Math.max(1, Math.floor(limit)));
  const out: ContactRow[] = [];

  let ids: string[] | null = null;
  if (filter.groupId) {
    const { data } = await supabase
      .from("newsletter_group_members")
      .select("contact_id")
      .eq("group_id", filter.groupId)
      .limit(200_000);
    ids = (data ?? []).map((r) => r.contact_id as string);
    if (ids.length === 0) return [];
  }
  // A selection narrows the filter, exactly as it does on screen: the file is
  // the ticked rows, not every row the filter would have matched.
  if (filter.ids && filter.ids.length > 0) {
    const chosen = new Set(filter.ids);
    ids = ids ? ids.filter((id) => chosen.has(id)) : [...chosen];
    if (ids.length === 0) return [];
  }

  const CHUNK = 1_000;
  for (let from = 0; from < ceiling; from += CHUNK) {
    const to = Math.min(from + CHUNK, ceiling) - 1;
    let query = supabase
      .from("newsletter_contacts")
      .select(CONTACT_SELECT)
      .order("created_at", { ascending: false })
      .range(from, to);

    // The same filter vocabulary listContacts uses, so the file an operator
    // downloads is exactly the list they were looking at when they asked.
    if (ids) query = query.in("id", ids);
    if (filter.sourceKey) query = query.eq("source_key", filter.sourceKey);
    if (filter.locale) query = query.eq("locale", filter.locale);
    if (filter.consent === "consented") {
      query = query.eq("marketing_consent", true).is("unsubscribed_at", null);
    } else if (filter.consent === "no_consent") {
      query = query.eq("marketing_consent", false);
    } else if (filter.consent === "unsubscribed") {
      query = query.not("unsubscribed_at", "is", null);
    }
    const search = (filter.search ?? "").trim();
    if (search) {
      const safe = search.replace(/[%_]/g, (c) => `\\${c}`);
      query = query.or(`email.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`);
    }

    const { data } = await query;
    const batch = data ?? [];
    for (const r of batch) out.push(toContact(r as RawContact));
    if (batch.length < to - from + 1) break;
  }

  return out;
}

/** Which of these addresses this module already knows, normalised and chunked
 *  so a 10 000-row import does not become a 10 000-row `in(…)` URL. */
export async function existingContactEmails(
  supabase: Client, emails: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < emails.length; i += 400) {
    const { data } = await supabase
      .from("newsletter_contacts")
      .select("id, email")
      .in("email", emails.slice(i, i + 400));
    for (const r of data ?? []) out.set(r.email as string, r.id as string);
  }
  return out;
}

/** Which of these addresses are on the suppression list. Same chunking, same
 *  reason — and the answer is what an import must never overrule. */
export async function suppressedAmong(
  supabase: Client, emails: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < emails.length; i += 400) {
    const { data } = await supabase
      .from("newsletter_suppressions")
      .select("email")
      .in("email", emails.slice(i, i + 400));
    for (const r of data ?? []) out.add(r.email as string);
  }
  return out;
}

/* ── ANALYTICS ───────────────────────────────────────────────────────────── */

export type CampaignPerformance = {
  id: string;
  name: string;
  status: CampaignStatus;
  recipients: number;
  sent: number;
  accepted: number;
  failed: number;
  openedUnique: number;
  clickedUnique: number;
  replied: number;
  unsubscribed: number;
  converted: number;
  revenueCents: number | null;
};

/**
 * EVERY CAMPAIGN'S NUMBERS, IN A FIXED NUMBER OF QUERIES.
 *
 * `campaignStats` answers this for ONE campaign in three reads. The analytics
 * table asks it about every campaign that moved inside a date range, and the
 * obvious implementation — call the singular version in a loop — is three
 * round trips per row. Thirty campaigns is ninety queries and a page that
 * gives up before it renders. So the three reads happen once, unfiltered by
 * campaign, and the grouping happens in memory.
 *
 * THE RANGE FILTERS THE ACTIVITY, NOT THE CAMPAIGN. A campaign sent five weeks
 * ago that was clicked yesterday belongs in yesterday's report: the question
 * this screen answers is "what happened in this window", not "what was created
 * in it". The consequence worth knowing is that a row's `sent` can be 0 while
 * its `clickedUnique` is not — that is a real campaign still earning clicks
 * after the send finished, not a bug.
 *
 * Opens and clicks are unique contacts for the same reason `campaignStats`
 * gives, and `revenueCents` stays null rather than collapsing to 0 when
 * nothing was attributed, so the table prints "—" instead of an amount nobody
 * measured.
 */
export async function campaignPerformance(
  supabase: Client, sinceIso: string, untilIso: string,
): Promise<CampaignPerformance[]> {
  const [recipients, events, attributions] = await Promise.all([
    supabase.from("newsletter_recipients").select("campaign_id, status")
      .gte("created_at", sinceIso).lte("created_at", untilIso).limit(500_000),
    supabase.from("newsletter_events").select("campaign_id, event_type, contact_id")
      .gte("created_at", sinceIso).lte("created_at", untilIso).limit(500_000),
    supabase.from("newsletter_attributions").select("campaign_id, amount_cents, converted_at")
      .gte("created_at", sinceIso).lte("created_at", untilIso).limit(100_000),
  ]);

  type Acc = {
    recipients: number; sent: number; failed: number;
    acceptedEvents: number; replied: Set<string>; opened: Set<string>; clicked: Set<string>;
    unsubscribed: number; converted: number; amounts: number[];
  };
  const acc = new Map<string, Acc>();
  const of = (id: string): Acc => {
    let row = acc.get(id);
    if (!row) {
      row = {
        recipients: 0, sent: 0, failed: 0, acceptedEvents: 0,
        replied: new Set(), opened: new Set(), clicked: new Set(),
        unsubscribed: 0, converted: 0, amounts: [],
      };
      acc.set(id, row);
    }
    return row;
  };

  for (const r of recipients.data ?? []) {
    const id = r.campaign_id as string | null;
    if (!id) continue;
    const row = of(id);
    row.recipients += 1;
    if (r.status === "sent") row.sent += 1;
    else if (r.status === "failed") row.failed += 1;
  }

  for (const e of events.data ?? []) {
    // An event with no campaign is a lifecycle event (a subscribe, a manual
    // block). It is real, but it belongs to a contact rather than to any
    // campaign, and folding it into one would invent a number.
    const id = e.campaign_id as string | null;
    if (!id) continue;
    const row = of(id);
    const contact = (e.contact_id as string | null) ?? "";
    switch (e.event_type as string) {
      case "accepted": row.acceptedEvents += 1; break;
      case "opened": if (contact) row.opened.add(contact); break;
      case "clicked": if (contact) row.clicked.add(contact); break;
      case "replied": if (contact) row.replied.add(contact); break;
      case "unsubscribed": row.unsubscribed += 1; break;
      default: break;
    }
  }

  for (const a of attributions.data ?? []) {
    const id = a.campaign_id as string | null;
    if (!id) continue;
    const row = of(id);
    if (a.converted_at) row.converted += 1;
    const amount = a.amount_cents as number | null;
    if (typeof amount === "number") row.amounts.push(amount);
  }

  const ids = [...acc.keys()];
  if (ids.length === 0) return [];

  // Names in one read per 200 ids rather than one per row. A campaign that has
  // vanished between these two queries is dropped rather than rendered as a
  // uuid: a row nobody can click is worse than a row that is not there.
  const meta = new Map<string, { name: string; status: CampaignStatus }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("newsletter_campaigns").select("id, name, status").in("id", ids.slice(i, i + 200));
    for (const r of data ?? []) {
      meta.set(r.id as string, {
        name: r.name as string,
        status: (r.status as CampaignStatus) ?? "draft",
      });
    }
  }

  return ids
    .flatMap((id) => {
      const row = acc.get(id)!;
      const info = meta.get(id);
      if (!info) return [];
      return [{
        id,
        name: info.name,
        status: info.status,
        recipients: row.recipients,
        sent: row.sent,
        // Same fallback as everywhere else in this module: when the worker
        // recorded no explicit acceptance, a message that went out was
        // accepted by definition — nothing else would have let it leave.
        accepted: row.acceptedEvents || row.sent,
        failed: row.failed,
        openedUnique: row.opened.size,
        clickedUnique: row.clicked.size,
        replied: row.replied.size,
        unsubscribed: row.unsubscribed,
        converted: row.converted,
        revenueCents: row.amounts.length > 0 ? row.amounts.reduce((a, b) => a + b, 0) : null,
      }];
    })
    .sort((a, b) => b.sent - a.sent || b.clickedUnique - a.clickedUnique);
}

export type SourcePerformance = {
  key: string;
  name: string;
  contacts: number;
  sent: number;
  clickedUnique: number;
  converted: number;
  revenueCents: number | null;
};

/**
 * WHICH SIGN-UP ROUTE PRODUCES PEOPLE WHO ACTUALLY DO SOMETHING.
 *
 * `listSources` answers "how many contacts per source" and is the right
 * function for the contact screens. This one answers a strictly larger
 * question — it needs to know WHICH contact belongs to which source, so that a
 * click event can be traced back to the form that produced the person who made
 * it — and that map cannot be assembled from a tally. Calling `listSources`
 * first and then reading the contacts again for their ids would read the
 * largest table in the module twice for one screen, so the tally is recomputed
 * here from the read that has to happen anyway.
 *
 * THE CEILING IS 100 000 CONTACTS, the same one `listSources` already accepts.
 * Past that the percentages drift, and the fix is a grouped count in Postgres
 * rather than a bigger limit here.
 */
export async function sourcePerformance(
  supabase: Client, sinceIso: string, untilIso: string,
): Promise<SourcePerformance[]> {
  const [sources, contacts, events, attributions] = await Promise.all([
    supabase.from("newsletter_sources").select("key, name").order("name"),
    supabase.from("newsletter_contacts").select("id, source_key").limit(100_000),
    supabase.from("newsletter_events").select("event_type, contact_id")
      .in("event_type", ["sent", "clicked"])
      .gte("created_at", sinceIso).lte("created_at", untilIso).limit(500_000),
    supabase.from("newsletter_attributions").select("contact_id, amount_cents, converted_at")
      .gte("created_at", sinceIso).lte("created_at", untilIso).limit(100_000),
  ]);

  const sourceOf = new Map<string, string>();
  const tally = new Map<string, number>();
  for (const c of contacts.data ?? []) {
    const key = c.source_key as string;
    sourceOf.set(c.id as string, key);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  const sent = new Map<string, number>();
  const clicked = new Map<string, Set<string>>();
  for (const e of events.data ?? []) {
    const contact = e.contact_id as string | null;
    if (!contact) continue;
    const key = sourceOf.get(contact);
    // A contact deleted since the event, or one past the read ceiling above.
    // Dropped rather than bucketed into an "unknown" row that would look like
    // a source somebody could go and fix.
    if (!key) continue;
    if (e.event_type === "sent") sent.set(key, (sent.get(key) ?? 0) + 1);
    else {
      if (!clicked.has(key)) clicked.set(key, new Set());
      clicked.get(key)!.add(contact);
    }
  }

  const converted = new Map<string, number>();
  const amounts = new Map<string, number[]>();
  for (const a of attributions.data ?? []) {
    const contact = a.contact_id as string | null;
    if (!contact) continue;
    const key = sourceOf.get(contact);
    if (!key) continue;
    if (a.converted_at) converted.set(key, (converted.get(key) ?? 0) + 1);
    const amount = a.amount_cents as number | null;
    if (typeof amount === "number") {
      if (!amounts.has(key)) amounts.set(key, []);
      amounts.get(key)!.push(amount);
    }
  }

  return (sources.data ?? []).map((s) => {
    const key = s.key as string;
    const money = amounts.get(key) ?? [];
    return {
      key,
      name: s.name as string,
      contacts: tally.get(key) ?? 0,
      sent: sent.get(key) ?? 0,
      clickedUnique: clicked.get(key)?.size ?? 0,
      converted: converted.get(key) ?? 0,
      revenueCents: money.length > 0 ? money.reduce((a, b) => a + b, 0) : null,
    };
  }).sort((a, b) => b.contacts - a.contacts);
}

/* ── READS THE CONTACT SCREENS NEED ──────────────────────────────────────────
 *
 * Appended for app/admin/newsletter/kontakty. Both answer a question the
 * functions above cannot, and both are here rather than in a page because a
 * query written inside a component is a query the next screen copies.
 */

/**
 * Whole contacts for a set of ids, chunked.
 *
 * The bulk bar can export exactly what an operator ticked, and a selection is
 * a list of ids — not a filter. `contactsForExport` answers the filter case and
 * cannot answer this one: there is no `ContactFilter` that means "these
 * fourteen rows and nothing else", and inventing one would put a thousand-uuid
 * list into a PostgREST URL.
 *
 * Chunked at 400 for the same reason `contactEmails` is: the `in(…)` filter
 * travels in the query string, and a selection spanning several pages is
 * easily past what a proxy will forward. Order is not preserved across chunks
 * and does not need to be — the CSV writer sorts nothing and the file reads in
 * whatever order the database answers, which is the same order for every run.
 */
export async function contactsByIds(supabase: Client, ids: string[]): Promise<ContactRow[]> {
  const out: ContactRow[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 400) {
    const { data } = await supabase
      .from("newsletter_contacts")
      .select(CONTACT_SELECT)
      .in("id", unique.slice(i, i + 400));
    for (const r of data ?? []) out.push(toContact(r as RawContact));
  }
  return out;
}

/**
 * Which STATIC groups each of these contacts belongs to.
 *
 * One read of the membership table for the whole page, tallied here, rather
 * than one query per row: the contact list renders fifty rows at a time and
 * fifty round trips to fill one column is a screen that takes a second to
 * load for information nobody sorts by.
 *
 * SEGMENTS ARE DELIBERATELY ABSENT. A dynamic group has no membership rows at
 * all — it is a saved filter — so answering "which segments does this contact
 * match" means running every segment's conditions for every row on the page.
 * That is a measurable amount of database work to fill a cell, and it would
 * make the column mean two different things depending on which kind of group
 * happened to be involved. The column shows lists; `resolveSegment` answers
 * segments, where the caller is asking for one on purpose.
 */
export async function groupsOfContacts(
  supabase: Client, contactIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const unique = [...new Set(contactIds)];
  for (let i = 0; i < unique.length; i += 400) {
    const { data } = await supabase
      .from("newsletter_group_members")
      .select("group_id, contact_id")
      .in("contact_id", unique.slice(i, i + 400));
    for (const r of data ?? []) {
      const contactId = r.contact_id as string;
      const list = out.get(contactId) ?? [];
      list.push(r.group_id as string);
      out.set(contactId, list);
    }
  }
  return out;
}

/**
 * The suppression row for one address, or null.
 *
 * WHY THE REASON MATTERS AND A BOOLEAN DOES NOT. `suppressedAmong` answers "is
 * this address blocked", which is all a list needs. A contact's own screen has
 * to answer WHY, because the two reasons lead to opposite decisions: an address
 * on the list because an operator blocked it is one an operator may unblock,
 * and an address on it because the person unsubscribed themselves is one where
 * lifting the block still leaves them unmailable — only they can consent again.
 * Showing "zablokowany" without the reason is how somebody talks themselves
 * into undoing a customer's own decision.
 */
export async function suppressionFor(
  supabase: Client, email: string,
): Promise<{ email: string; reason: string; note: string | null; createdAt: string } | null> {
  const { data } = await supabase
    .from("newsletter_suppressions")
    .select("email, reason, note, created_at")
    .eq("email", email)
    .maybeSingle();
  if (!data) return null;
  return {
    email: data.email as string,
    reason: data.reason as string,
    note: (data.note as string | null) ?? null,
    createdAt: data.created_at as string,
  };
}

/* ── READS THE LIBRARY SCREENS NEED ──────────────────────────────────────────
 *
 * Appended for the three screens that are about the module's furniture rather
 * than about a single campaign: grupy, szablony and automatyzacje. Both
 * functions exist because the obvious existing call answers a different
 * question and answers it expensively.
 */

/** A campaign reduced to what a <select> and a lookup need. */
export type CampaignBrief = {
  id: string;
  name: string;
  kind: CampaignKind;
  status: CampaignStatus;
  stopOnConversion: boolean;
};

/**
 * Every campaign, as a name and four flags.
 *
 * `listCampaigns` already exists and would answer this — paged, twenty-five at
 * a time, carrying each row's audience JSON, UTM object and eight A/B columns.
 * That shape is right for the campaigns SCREEN and wrong everywhere here:
 *
 *   · A PICKER MUST NOT BE PAGED. "Która kampania?" in the segment builder and
 *     in the automation form is one dropdown; a dropdown that shows the first
 *     page of the answer is a dropdown that silently cannot express half the
 *     choices, and the operator has no way to tell which half.
 *   · A LOOKUP MUST NOT MISS. The automations list has to name the sequence
 *     each rule runs and say whether it stops on conversion. Resolving those
 *     ids against page one of `listCampaigns` would render "—" for any
 *     automation pointing at the twenty-sixth-oldest campaign.
 *
 * Capped at 500 rather than unbounded: at that point a dropdown is the wrong
 * control anyway, and an unbounded select is how a screen quietly stops
 * loading. `ids` narrows it when the caller already knows which rows it wants.
 */
export async function campaignBriefs(
  supabase: Client, ids?: string[],
): Promise<CampaignBrief[]> {
  if (ids && ids.length === 0) return [];
  let q = supabase
    .from("newsletter_campaigns")
    .select("id, name, kind, status, stop_on_conversion")
    .order("created_at", { ascending: false })
    .limit(500);
  if (ids) q = q.in("id", [...new Set(ids)].slice(0, 500));
  const { data } = await q;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    kind: (r.kind as CampaignKind) ?? "one_off",
    status: (r.status as CampaignStatus) ?? "draft",
    stopOnConversion: r.stop_on_conversion !== false,
  }));
}

/** A step reduced to its place in the sequence. No body. */
export type StepSummary = {
  id: string;
  campaignId: string;
  stepIndex: number;
  variant: string;
  delayMinutes: number;
  subject: string;
};

/**
 * The running order of several sequences at once.
 *
 * The automations screen shows, for every rule, the messages its sequence
 * sends and how long after the trigger each one goes out. `listSteps` answers
 * that for ONE campaign and returns the full body of every step — blocks and
 * pasted HTML, the largest text this module stores. Calling it per automation
 * would be N queries pulling N whole mailings across the wire so the screen
 * can print "+3 dni".
 *
 * So this is one query, and it selects no body at all. It is grouped in JS
 * rather than by the caller because the ordering has to survive the grouping:
 * PostgREST returns the rows already sorted, and pushing them into arrays in
 * arrival order keeps each sequence in send order without a second sort.
 */
export async function stepSummaries(
  supabase: Client, campaignIds: string[],
): Promise<Map<string, StepSummary[]>> {
  const out = new Map<string, StepSummary[]>();
  const ids = [...new Set(campaignIds)].filter(Boolean);
  if (ids.length === 0) return out;

  const { data } = await supabase
    .from("newsletter_campaign_steps")
    .select("id, campaign_id, step_index, variant, delay_minutes, subject")
    .in("campaign_id", ids.slice(0, 500))
    .order("step_index").order("variant");

  for (const r of data ?? []) {
    const campaignId = r.campaign_id as string;
    const list = out.get(campaignId) ?? [];
    list.push({
      id: r.id as string,
      campaignId,
      stepIndex: (r.step_index as number) ?? 0,
      variant: (r.variant as string) ?? "A",
      delayMinutes: (r.delay_minutes as number) ?? 0,
      subject: (r.subject as string) ?? "",
    });
    out.set(campaignId, list);
  }
  return out;
}

/* ── PREPARED PERSONALISATION ────────────────────────────────────────────────
 *
 * Appended for the campaign editor's final confirm screen.
 */

/**
 * How many of this campaign's queued messages already carry AI-written copy.
 *
 * §73's confirm screen has to state whether AI personalisation is on before an
 * operator commits to a send, and this is the only answer in the schema that
 * is a MEASUREMENT rather than an intention. `newsletter_recipients.
 * personalization` is written before a send, never during it, so a non-zero
 * count means individual subjects and openers genuinely exist for this
 * campaign; zero means every recipient gets the same words, whatever any
 * switch elsewhere claims.
 *
 * It is a `head` count on purpose — the confirm screen needs the number, not
 * the JSON, and those documents are the largest rows the queue holds.
 */
export async function personalizedRecipientCount(
  supabase: Client, campaignId: string,
): Promise<number> {
  const { count } = await supabase
    .from("newsletter_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .not("personalization", "is", null);
  return count ?? 0;
}

/* ── THE PERSONALISATION PASS ────────────────────────────────────────────────
 *
 * Appended for app/actions/newsletter-ai.ts. Two reads, both scoped to rows
 * that have not gone anywhere yet.
 */

/** One queued message waiting for its personalised copy. The STEP is part of
 *  it because a sequence's third mail is not its first, and an A/B variant B
 *  is not variant A — the opener has to be written against the words that
 *  recipient will actually receive. */
export type PersonalizationTarget = {
  id: string;
  contactId: string;
  stepIndex: number;
  variant: string;
};

/**
 * The next `limit` queued messages that have no personalisation yet.
 *
 * ONLY 'pending' ROWS, and that filter is the whole safety argument. A row
 * that is 'sending' is inside a claim right now and a row that is 'sent' has
 * already left the building; writing generated copy onto either would at best
 * be wasted money and at worst would make the per-recipient log describe a
 * message that was never sent. Personalisation is something you do to a mail
 * that has not happened.
 *
 * ORDERED BY id so repeated calls walk the queue instead of re-reading the
 * same page: the batch runs under a time budget and finishes over several
 * invocations, and "the next hundred" has to mean a different hundred each
 * time. `personalization is null` shrinks the set as the work lands, so the
 * ordering only has to be stable, not meaningful.
 */
export async function recipientsAwaitingPersonalization(
  supabase: Client, campaignId: string, limit: number,
): Promise<PersonalizationTarget[]> {
  const { data } = await supabase
    .from("newsletter_recipients")
    .select("id, contact_id, step_index, variant")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .is("personalization", null)
    .order("id")
    .limit(Math.min(500, Math.max(1, Math.floor(limit))));
  return (data ?? []).map((r) => ({
    id: r.id as string,
    contactId: r.contact_id as string,
    stepIndex: (r.step_index as number) ?? 0,
    variant: (r.variant as string) ?? "A",
  }));
}

/**
 * How far the pass has got: queued messages, and how many of them already
 * carry generated copy.
 *
 * BOTH NUMBERS COUNT THE SAME SET — rows still 'pending' — so the panel can
 * subtract them and get a remainder that is true. `personalizedRecipientCount`
 * answers a different question (how many rows of ANY status were personalised,
 * which is what the confirm screen needs to state about a send that has
 * already started) and the two are deliberately not the same query.
 */
export async function personalizationProgress(
  supabase: Client, campaignId: string,
): Promise<{ queued: number; written: number }> {
  const [{ count: queued }, { count: written }] = await Promise.all([
    supabase.from("newsletter_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId).eq("status", "pending"),
    supabase.from("newsletter_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId).eq("status", "pending")
      .not("personalization", "is", null),
  ]);
  return { queued: queued ?? 0, written: written ?? 0 };
}
