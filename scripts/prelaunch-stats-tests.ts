/**
 * THE PRE-LAUNCH LIST IN THE NEWSLETTER ADMIN — WHAT IT READS AND HOW IT SAYS IT.
 *
 * Three screens learned about the landing page's double opt-in list (0144):
 * Analityka (a "Lista przedpremierowa" section), Kontakty (a `prelaunch=`
 * filter) and the contact screen (a card with the consent records). The SQL
 * behind them is written by another hand and shipped separately, so the
 * failures worth guarding are at the seam:
 *
 *   A. THE FILTER VOCABULARY. `prelaunch=` comes from a URL. Two values mean
 *      something; everything else must mean nothing — not a query, not an
 *      empty list with no explanation.
 *   B. THE FILTER QUERY. One bounded read of contact ids from
 *      prelaunch_signups, then an intersection, on the screen AND in the
 *      export — so the file is the list that was on screen.
 *   C. THE SUMMARY, PARSED AS IF IT COULD BE WRONG. A missing field is "—",
 *      never a crash and never a zero; a real zero stays a zero. Breakdowns
 *      are capped, labels are bounded, the rate is NOT taken from the answer.
 *   D. THE CONTACT PROFILE. Consent records are evidence: every one is kept,
 *      newest first, its sentence exactly as stored.
 *   E. THE LEGACY CONSENT. waitlist|v1 is a terms tick stored as marketing
 *      consent; the list and the contact screen must be able to say so.
 *   F. EVERY LABEL EXISTS in pl, en and de — in the dictionaries, or in the
 *      i18n fragment still waiting for the central merge (pass its path in
 *      PRELAUNCH_I18N_FRAGMENT; without it only the dictionaries count).
 *   G. THE WIRING. The pages call the readers, the components only lay out,
 *      and the parser reads every key the rpc contract documents.
 *
 * No browser, no database: a stub client records what is asked for.
 *
 * Run: esbuild scripts/prelaunch-stats-tests.ts --bundle --platform=node --format=cjs
 *        --alias:@=. --alias:server-only=./scripts/server-only-stub.js --external:sharp
 *        --outfile=.next/prelaunch-stats-tests.cjs --log-level=silent
 *      && node .next/prelaunch-stats-tests.cjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import {
  ATTRIBUTION_KEYS, CONSENT_DOCS, PRELAUNCH_CONSENT_KEYS, PRELAUNCH_FILTER_CAP, PRELAUNCH_FORMS,
  PRELAUNCH_STATUSES, PRELAUNCH_SUMMARY_ROWS, REFERRAL_REJECTIONS, SELLER_CHANNELS,
  contactsForExport, getContact, isConsentWithoutDoi, listContacts, parsePrelaunchContact,
  parsePrelaunchSummary, prelaunchContact, prelaunchFilterOf, prelaunchSummary,
} from "../lib/services/newsletter";
import { lookup } from "../lib/i18n/t";
import pl from "../lib/i18n/dictionaries/pl.json";
import en from "../lib/i18n/dictionaries/en.json";
import de from "../lib/i18n/dictionaries/de.json";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const read = (p: string) => readFileSync(p, "utf8");
/** Code without its commentary — the files here explain at length what they
 *  must not do, and a comment naming a thing is not the thing. */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const json = (v: unknown) => JSON.stringify(v);

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const U4 = "44444444-4444-4444-8444-444444444444";

/* ── A STUB CLIENT ────────────────────────────────────────────────────────── */

type Call = { table: string; columns: string; filters: [string, unknown[]][] };
type Answer = { data: unknown; error?: unknown; count?: number };

/** Every chainable method returns the builder; awaiting it yields the answer
 *  configured for that table. It records what was asked, which is the point. */
function stub(tables: Record<string, Answer> = {}, rpcAnswer: Answer = { data: null }) {
  const calls: Call[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const from = (table: string) => {
    const call: Call = { table, columns: "", filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "gte", "lte", "lt", "gt", "is", "not",
      "order", "limit", "range", "maybeSingle", "single", "filter", "or", "contains"]) {
      builder[m] = (...args: unknown[]) => {
        if (m === "select") call.columns = String(args[0] ?? "");
        else call.filters.push([m, args]);
        return builder;
      };
    }
    const answer = tables[table] ?? { data: [] };
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: answer.data, error: answer.error ?? null, count: answer.count ?? 0 })
        .then(resolve, reject);
    return builder;
  };
  const rpc = (fn: string, args?: unknown) => {
    rpcs.push({ fn, args });
    return Promise.resolve({ data: rpcAnswer.data, error: rpcAnswer.error ?? null });
  };
  return { client: { from, rpc } as never, calls, rpcs };
}

const filterOf = (call: Call | undefined, name: string) => call?.filters.find(([m]) => m === name)?.[1];

async function main() {
  console.log("A. THE FILTER VOCABULARY");
  {
    check("the statuses are exactly pending and confirmed", json(PRELAUNCH_STATUSES) === json(["pending", "confirmed"]));
    check("'pending' is a filter", prelaunchFilterOf("pending") === "pending");
    check("'confirmed' is a filter", prelaunchFilterOf("confirmed") === "confirmed");
    const junk: unknown[] = [
      "", "PENDING", "Pending", " pending", "pending ", "expired", "all", "confirmed' or 1=1",
      null, undefined, 1, true, ["pending"], { status: "pending" },
    ];
    check("anything else is no filter at all", junk.every((v) => prelaunchFilterOf(v) === undefined),
      junk.filter((v) => prelaunchFilterOf(v) !== undefined).map(json).join(", "));
  }

  console.log("\nB. THE FILTER QUERY — ONE BOUNDED READ, THEN AN INTERSECTION");
  {
    const signups: Answer = {
      // Two good rows, and the shapes a scrubbed or odd row can take: an
      // erased signup (contact_id null), a non-uuid, an empty row, a non-row.
      data: [{ contact_id: U1 }, { contact_id: U2 }, { contact_id: null }, { contact_id: "nope" }, {}, "x"],
    };
    {
      const { client, calls } = stub({ prelaunch_signups: signups });
      await listContacts(client, { prelaunch: "pending" });
      const [first, second] = calls;
      check("the first read is prelaunch_signups", first?.table === "prelaunch_signups", calls.map((c) => c.table).join(", "));
      check("…of contact ids only", first?.columns === "contact_id", first?.columns);
      check("…in the asked status", json(filterOf(first, "eq")) === json(["status", "pending"]), json(first?.filters));
      check("…leaving out erased signups (contact_id null)",
        json(filterOf(first, "not")) === json(["contact_id", "is", null]), json(first?.filters));
      check(`…bounded at ${PRELAUNCH_FILTER_CAP}`, json(filterOf(first, "limit")) === json([PRELAUNCH_FILTER_CAP]),
        json(first?.filters));
      check("then the contacts, narrowed to exactly the valid ids",
        second?.table === "newsletter_contacts" && json(filterOf(second, "in")) === json(["id", [U1, U2]]),
        json(second?.filters));
    }
    {
      const { client, calls } = stub({ prelaunch_signups: signups });
      await listContacts(client, { prelaunch: "confirmed" });
      check("'confirmed' asks for confirmed", json(filterOf(calls[0], "eq")) === json(["status", "confirmed"]));
    }
    {
      const { client, calls } = stub({
        newsletter_group_members: { data: [{ contact_id: U1 }, { contact_id: U3 }] },
        prelaunch_signups: signups,
      });
      await listContacts(client, { groupId: U4, prelaunch: "pending" });
      const contacts = calls.find((c) => c.table === "newsletter_contacts");
      check("with a group, the two filters INTERSECT", json(filterOf(contacts, "in")) === json(["id", [U1]]),
        json(contacts?.filters));
    }
    {
      const { client, calls } = stub({ prelaunch_signups: signups });
      await listContacts(client, { ids: [U2, U4], prelaunch: "pending" });
      const contacts = calls.find((c) => c.table === "newsletter_contacts");
      check("a ticked selection narrows it further, never widens it",
        json(filterOf(contacts, "in")) === json(["id", [U2]]), json(contacts?.filters));
    }
    {
      const { client, calls } = stub({ prelaunch_signups: { data: [] } });
      const page = await listContacts(client, { prelaunch: "confirmed" });
      check("nobody on the list: an empty page, without asking for contacts",
        page.rows.length === 0 && page.total === 0 && !calls.some((c) => c.table === "newsletter_contacts"),
        calls.map((c) => c.table).join(", "));
    }
    {
      const { client } = stub({ prelaunch_signups: { data: null, error: { message: "relation does not exist" } } });
      let threw = false;
      let total = -1;
      try { total = (await listContacts(client, { prelaunch: "pending" })).total; } catch { threw = true; }
      check("a failed read (0144 not applied yet) is an empty list, not a crash", !threw && total === 0);
    }
    {
      const { client, calls } = stub({ prelaunch_signups: signups });
      await listContacts(client, { prelaunch: "expired" });
      const contacts = calls.find((c) => c.table === "newsletter_contacts");
      check("an unknown value reads nothing extra and narrows nothing",
        !calls.some((c) => c.table === "prelaunch_signups") && filterOf(contacts, "in") === undefined,
        calls.map((c) => c.table).join(", "));
    }
    {
      const { client, calls } = stub({ prelaunch_signups: signups });
      await contactsForExport(client, { prelaunch: "confirmed" });
      const [first] = calls;
      const exportQuery = calls.find((c) => c.table === "newsletter_contacts");
      check("the export reads the same ids the same way",
        first?.table === "prelaunch_signups" && json(filterOf(first, "eq")) === json(["status", "confirmed"])
        && json(filterOf(first, "limit")) === json([PRELAUNCH_FILTER_CAP]), json(first));
      check("…and exports exactly those contacts", json(filterOf(exportQuery, "in")) === json(["id", [U1, U2]]),
        json(exportQuery?.filters));
    }
  }

  console.log("\nC. THE SUMMARY, PARSED AS IF IT COULD BE WRONG");
  const FULL = {
    signups: 12, confirmed: 9, pending: 3, expired: 1, confirm_rate: 0.75,
    dois_sent: 14, resends: 2, send_failures: 1,
    by_form: [{ form: "hero", signups: 10, confirmed: 8 }, { form: "final", signups: 2, confirmed: 1 }],
    by_source: [
      { utm_source: "facebook", utm_medium: "cpc", utm_campaign: "launch", signups: 5, confirmed: 4 },
      { utm_source: null, utm_medium: null, utm_campaign: null, signups: 7, confirmed: 5 },
    ],
    by_referrer_host: [{ host: "l.facebook.com", signups: 3, confirmed: 2 }, { host: null, signups: 9, confirmed: 7 }],
    by_channel: [{ channel: "allegro", count: 4 }, { channel: null, count: 5 }],
    referrals: {
      counted: 3,
      rejected: [{ reason: "self", count: 1 }, { reason: "cap", count: 2 }],
      top: [{ signup_id: U1, email: "anna@example.com", counted: 3 }],
    },
    rewards: { signup_claims: 2, signup_credits: 150, referral_claims: 3, referral_credits: 60 },
  };
  {
    const s = parsePrelaunchSummary(FULL);
    check("a well-formed answer parses", s !== null);
    if (s) {
      check("the headline counts", json([s.signups, s.confirmed, s.pending, s.expired, s.doisSent, s.resends, s.sendFailures])
        === json([12, 9, 3, 1, 14, 2, 1]));
      check("by form", json(s.byForm) === json([
        { form: "hero", signups: 10, confirmed: 8 }, { form: "final", signups: 2, confirmed: 1 }]), json(s.byForm));
      check("by UTM, with the direct row's nulls kept as nulls",
        s.bySource[0].utmSource === "facebook" && s.bySource[0].utmCampaign === "launch"
        && s.bySource[1].utmSource === null && s.bySource[1].signups === 7, json(s.bySource));
      check("by referring host", s.byReferrerHost[0].host === "l.facebook.com" && s.byReferrerHost[1].host === null);
      check("by channel, with 'no answer' as null", json(s.byChannel) === json([
        { channel: "allegro", count: 4 }, { channel: null, count: 5 }]));
      check("referrals: counted, rejected by reason, top referrers",
        s.referrals.counted === 3 && s.referrals.rejected.length === 2 && s.referrals.top[0].email === "anna@example.com"
        && s.referrals.top[0].signupId === U1 && s.referrals.top[0].contactId === null, json(s.referrals));
      check("rewards", json(s.rewards) === json({ signupClaims: 2, signupCredits: 150, referralClaims: 3, referralCredits: 60 }));
      check("the answer's own rate is NOT carried — the screen computes it from the counts",
        !json(s).includes("0.75") && !("confirmRate" in s));
    }
    const zeros = parsePrelaunchSummary({ signups: 0, confirmed: 0 });
    check("a real zero stays a zero (it is a measurement)", zeros?.signups === 0 && zeros?.confirmed === 0);

    check("null is no answer", parsePrelaunchSummary(null) === null);
    check("neither is a string, an array or a number",
      [parsePrelaunchSummary("x"), parsePrelaunchSummary([]), parsePrelaunchSummary(42)].every((v) => v === null));
    const empty = parsePrelaunchSummary({});
    check("an empty object is an answer with nothing in it: every count null, every list empty",
      empty !== null && [empty.signups, empty.confirmed, empty.pending, empty.expired, empty.doisSent,
        empty.resends, empty.sendFailures, empty.referrals.counted, empty.rewards.signupCredits].every((v) => v === null)
      && empty.byForm.length === 0 && empty.bySource.length === 0 && empty.referrals.top.length === 0,
      json(empty));

    const counts = (v: unknown) => parsePrelaunchSummary({ signups: v })?.signups;
    check("not counts: negative, fractional, NaN, Infinity, words, booleans, objects, unsafe integers",
      [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "abc", "-3", "1.5", true, {}, [], 1e20]
        .every((v) => counts(v) === null),
      [-1, 1.5, "abc", true, 1e20].map((v) => `${json(v)}→${json(counts(v))}`).join(" "));
    check("a bigint that arrives as a digit string is a count", counts("12") === 12);

    const rows = parsePrelaunchSummary({
      by_form: [null, 1, "s", [], { form: "hero", signups: 1 }],
      by_channel: "allegro",
      referrals: { rejected: [{ count: 4 }, { reason: "duplicate", count: 1 }], top: [{ email: "no-at-sign", counted: 1 }] },
    });
    check("rows that are not objects are dropped", rows?.byForm.length === 1, json(rows?.byForm));
    check("a list that is not a list is empty", rows?.byChannel.length === 0);
    check("a rejection with no reason is dropped", json(rows?.referrals.rejected) === json([{ reason: "duplicate", count: 1 }]));
    check("an 'email' without an @ is not shown as one", rows?.referrals.top[0]?.email === null);
    const many = parsePrelaunchSummary({
      by_source: Array.from({ length: 50 }, (_, i) => ({ utm_source: `s${i}`, signups: i, confirmed: 0 })),
    });
    check(`a breakdown is capped at ${PRELAUNCH_SUMMARY_ROWS} rows`, many?.bySource.length === PRELAUNCH_SUMMARY_ROWS);
    const odd = parsePrelaunchSummary({
      by_source: [{ utm_source: "x".repeat(500), utm_medium: "a\u0000b\nc", signups: 1, confirmed: 1 }],
      referrals: { top: [{ contact_id: "not-a-uuid", signup_id: U2, email: "a@b.pl", counted: 1 }, { contact_id: U3 }] },
    });
    check("a campaign value is bounded (120)", odd?.bySource[0].utmSource?.length === 120);
    check("control characters never reach the screen", odd?.bySource[0].utmMedium === "a b c", json(odd?.bySource[0].utmMedium));
    check("a malformed contact id is not linked", odd?.referrals.top[0].contactId === null);
    check("a valid one is", odd?.referrals.top[1].contactId === U3);

    {
      const { client, rpcs } = stub({}, { data: FULL });
      const s = await prelaunchSummary(client, "2026-10-01T00:00:00.000Z", "2026-10-19T00:00:00.000Z");
      check("prelaunchSummary asks prelaunch_admin_summary for the window",
        rpcs.length === 1 && rpcs[0].fn === "prelaunch_admin_summary"
        && json(rpcs[0].args) === json({ p_from: "2026-10-01T00:00:00.000Z", p_to: "2026-10-19T00:00:00.000Z" }),
        json(rpcs));
      check("…and returns the parsed answer", s?.signups === 12);
    }
    {
      const { client } = stub({}, { data: null, error: { message: "function does not exist" } });
      check("a failed rpc is null — the section says 'unavailable', not zeros",
        (await prelaunchSummary(client, null, "2026-10-19T00:00:00.000Z")) === null);
    }
  }

  console.log("\nD. ONE CONTACT'S PROFILE — EVERY CONSENT RECORD, EXACTLY");
  const TERMS_TEXT = "Akceptuję Regulamin i Politykę prywatności.";
  const MARKETING_TEXT = "  Chcę otrzymywać e-mailem informacje o premierze i ofertach GrovBase.\n";
  const CONTACT = {
    signup: {
      status: "confirmed", created_at: "2026-10-10T10:00:00Z", confirmed_at: "2026-10-10T10:05:00Z",
      form_variant: "hero", seller_channel: "allegro", referral_code: "ABCD2345",
      referred_by_email: "ref@example.com", referrals_counted: 2, referral_rejected: null, locale: "pl",
      attribution: { utm_source: "facebook", utm_medium: "cpc", utm_campaign: "launch", referrer_host: "l.facebook.com", landing_path: "/" },
    },
    consents: [
      {
        consent_key: "terms_privacy", consent_version: "terms_privacy@abcdef012345", consent_text: TERMS_TEXT,
        locale: "pl", form_variant: "hero", accepted_at: "2026-10-10T10:00:00Z", confirmed_at: "2026-10-10T10:05:00Z",
        doc_versions: { regulamin: "2026-09-01T08:00:00Z", polityka_prywatnosci: null, "Bad-Key": "x" },
      },
      {
        consent_key: "marketing_email", consent_version: "marketing_email@0123456789ab", consent_text: MARKETING_TEXT,
        locale: "pl", form_variant: "hero", accepted_at: "2026-10-10T10:00:00Z", confirmed_at: null, doc_versions: null,
      },
      {
        consent_key: "marketing_email", consent_version: "marketing_email@ffffffffffff", consent_text: "Nowsza.",
        locale: "en", form_variant: "final", accepted_at: "2026-10-12T09:00:00Z", confirmed_at: null,
        doc_versions: { regulamin: { published_at: "2026-10-01T00:00:00Z", version: 7 } },
      },
      { consent_version: "no-key", consent_text: "dropped" },
    ],
  };
  {
    const v = parsePrelaunchContact(CONTACT);
    check("a well-formed profile parses", v !== null);
    if (v) {
      check("status, dates, form, channel, code, referrer, counted",
        v.status === "confirmed" && v.createdAt === "2026-10-10T10:00:00Z" && v.confirmedAt === "2026-10-10T10:05:00Z"
        && v.form === "hero" && v.channel === "allegro" && v.referralCode === "ABCD2345"
        && v.referredByEmail === "ref@example.com" && v.referralsCounted === 2 && v.referralRejected === null,
        json(v));
      check("attribution carries all seven keys, absent ones as null",
        json(Object.keys(v.attribution)) === json([...ATTRIBUTION_KEYS])
        && v.attribution.utm_source === "facebook" && v.attribution.utm_content === null);
      check("every consent record with a key is kept; a record without one is not",
        v.consents.length === 3, String(v.consents.length));
      check("newest first", v.consents[0].text === "Nowsza." && v.consents[0].acceptedAt === "2026-10-12T09:00:00Z");
      const terms = v.consents.find((c) => c.key === "terms_privacy");
      const marketing = v.consents.find((c) => c.version === "marketing_email@0123456789ab");
      check("the terms sentence is exactly what was stored", terms?.text === TERMS_TEXT);
      check("so is the marketing one — its spaces and newline included, nothing trimmed", marketing?.text === MARKETING_TEXT,
        json(marketing?.text));
      check("version, accepted, confirmed and form survive",
        terms?.version === "terms_privacy@abcdef012345" && terms?.confirmedAt === "2026-10-10T10:05:00Z"
        && marketing?.confirmedAt === null && v.consents[0].form === "final" && v.consents[0].locale === "en");
      check("document versions: the instants, an unpublished one as null, a malformed key dropped",
        json(terms?.docVersions) === json([
          { key: "regulamin", value: "2026-09-01T08:00:00Z" }, { key: "polityka_prywatnosci", value: null }]),
        json(terms?.docVersions));
      check("…and the object shape reads its publication instant",
        json(v.consents[0].docVersions) === json([{ key: "regulamin", value: "2026-10-01T00:00:00Z" }]),
        json(v.consents[0].docVersions));
    }
    check("no signup in the answer is no profile", parsePrelaunchContact({ signup: null, consents: [] }) === null);
    check("nor is null, a string or an array",
      [parsePrelaunchContact(null), parsePrelaunchContact("x"), parsePrelaunchContact([])].every((x) => x === null));
    const bare = parsePrelaunchContact({ signup: { status: "bogus", created_at: "not a date" }, consents: "x" });
    check("an odd profile degrades field by field",
      bare !== null && bare.status === null && bare.createdAt === null && bare.consents.length === 0
      && ATTRIBUTION_KEYS.every((k) => bare.attribution[k] === null), json(bare));
    const long = parsePrelaunchContact({
      signup: { status: "pending" },
      consents: Array.from({ length: 150 }, (_, i) => ({ consent_key: "marketing_email", consent_text: "x".repeat(3000), accepted_at: `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}Z` })),
    });
    check("records are bounded (100) and so is a sentence (2000)",
      long?.consents.length === 100 && long.consents.every((c) => (c.text ?? "").length === 2000));

    {
      const { client, rpcs } = stub({}, { data: CONTACT });
      const v2 = await prelaunchContact(client, U1);
      check("prelaunchContact asks prelaunch_admin_contact for that contact",
        rpcs.length === 1 && rpcs[0].fn === "prelaunch_admin_contact" && json(rpcs[0].args) === json({ p_contact: U1 }),
        json(rpcs));
      check("…and returns the parsed profile", v2?.referralCode === "ABCD2345");
    }
    {
      const { client, rpcs } = stub({}, { data: CONTACT });
      check("a malformed id never reaches the database",
        (await prelaunchContact(client, "x' or 1=1")) === null && rpcs.length === 0);
    }
  }

  console.log("\nE. THE LEGACY CONSENT IS LABELLED, NOT REWRITTEN");
  {
    const base = { marketingConsent: true, consentSource: "waitlist", consentVersion: "v1" };
    check("waitlist|v1 with a yes is a consent without DOI", isConsentWithoutDoi(base));
    check("a DOI consent is not", !isConsentWithoutDoi({ ...base, consentSource: "waitlist_doi" }));
    check("another version is not", !isConsentWithoutDoi({ ...base, consentVersion: "marketing_email@0123456789ab" }));
    check("no consent is not a consent of any kind", !isConsentWithoutDoi({ ...base, marketingConsent: false }));
    check("a form consent is not", !isConsentWithoutDoi({ ...base, consentSource: "cms_form", consentVersion: "form-v1" }));
    const row = {
      id: U1, email: "old@example.com", first_name: null, last_name: null, locale: "pl", source_key: "waitlist",
      user_id: null, tags: [], marketing_consent: true, consent_at: "2026-09-04T10:00:00Z", consent_source: "waitlist",
      consent_version: "v1", unsubscribed_at: null, unsubscribe_token: U2, last_activity_at: null, last_sent_at: null,
      last_opened_at: null, last_clicked_at: null, created_at: "2026-09-04T10:00:00Z",
    };
    const { client } = stub({ newsletter_contacts: { data: row } });
    const contact = await getContact(client, U1);
    check("a contact row read from the database carries the flag", contact?.consentWithoutDoi === true);
    const { client: c2 } = stub({ newsletter_contacts: { data: { ...row, consent_source: "waitlist_doi" } } });
    check("…and loses it once the address is confirmed", (await getContact(c2, U1))?.consentWithoutDoi === false);
  }

  console.log("\nF. EVERY LABEL EXISTS IN PL, EN AND DE");
  {
    type Dict = Record<string, unknown>;
    const PREFIX = "admin.newsletter.prelaunch";
    const fragmentPath = process.env.PRELAUNCH_I18N_FRAGMENT ?? "";
    let fragment: Record<string, Dict> | null = null;
    if (fragmentPath) {
      check("the i18n fragment named in PRELAUNCH_I18N_FRAGMENT exists", existsSync(fragmentPath), fragmentPath);
      if (existsSync(fragmentPath)) fragment = JSON.parse(read(fragmentPath)) as Record<string, Dict>;
    }
    const dicts: [string, Dict][] = [["pl", pl as Dict], ["en", en as Dict], ["de", de as Dict]];
    /** The dictionary first; the fragment only for keys the dictionary lacks
     *  (a key in transit), and the count of those is printed. */
    const inTransit = new Set<string>();
    const has = (locale: string, dict: Dict, key: string): string | undefined => {
      const found = lookup(dict, key);
      if (found !== undefined) return found;
      const pending = fragment?.[locale] ? lookup(fragment[locale], key) : undefined;
      if (pending !== undefined) inTransit.add(key);
      return pending;
    };

    // The keys built from data: one per value each column can hold.
    const enumerated = [
      ...PRELAUNCH_FORMS.map((m) => `${PREFIX}.form.${m}`),
      ...[...SELLER_CHANNELS, "none"].map((m) => `${PREFIX}.channel.${m}`),
      ...REFERRAL_REJECTIONS.map((m) => `${PREFIX}.reason.${m}`),
      ...PRELAUNCH_CONSENT_KEYS.map((m) => `${PREFIX}.consent.${m}`),
      ...CONSENT_DOCS.map((m) => `${PREFIX}.consent.doc.${m}`),
      ...ATTRIBUTION_KEYS.map((m) => `${PREFIX}.attribution.${m}`),
      ...PRELAUNCH_STATUSES.map((m) => `${PREFIX}.status.${m}`),
      ...PRELAUNCH_STATUSES.map((m) => `${PREFIX}.filter.${m}`),
      ...["signupClaims", "signupCredits", "referralClaims", "referralCredits"].map((m) => `${PREFIX}.rewards.${m}`),
    ];
    // The keys written as literals in the screens this track owns.
    const walk = (dir: string, out: string[] = []): string[] => {
      if (!existsSync(dir)) return out;
      for (const entry of readdirSync(dir)) {
        const full = `${dir}/${entry}`;
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    };
    const files = ["app/admin/newsletter", "components/admin/newsletter", "app/admin/waitlist"].flatMap((d) => walk(d));
    const literal = new Set<string>();
    for (const file of files) {
      for (const m of codeOnly(read(file)).matchAll(/\bt\(\s*(["'`])(admin\.newsletter\.prelaunch\.[A-Za-z0-9_.]+)\1/g)) {
        literal.add(m[2]);
      }
    }
    check("literal pre-launch keys were found in the screens", literal.size > 40, String(literal.size));
    const keys = [...new Set([...enumerated, ...literal])].sort();

    for (const [locale, dict] of dicts) {
      const missing = keys.filter((k) => !(has(locale, dict, k) ?? "").trim());
      check(`${locale}: all ${keys.length} labels exist`, missing.length === 0, missing.join(", "));
    }
    const vars = (s: string | undefined) => json([...(s ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    const drift = keys.filter((k) => new Set(dicts.map(([l, d]) => vars(has(l, d, k)))).size > 1);
    check("every placeholder is the same in all three languages", drift.length === 0, drift.join(", "));
    // The module's honesty rule (newsletter-ui-tests F), applied to these
    // strings too: this transport sees "accepted by SMTP", nothing after.
    const claims = keys.flatMap((k) => dicts.map(([l, d]) => [l, k, has(l, d, k) ?? ""] as const))
      .filter(([, , s]) => /dostarczon|delivered|zugestellt/i.test(s));
    check("no label claims a delivery", claims.length === 0, claims.map(([l, k]) => `${l}:${k}`).join(", "));
    const zeroMoney = keys.flatMap((k) => dicts.map(([l, d]) => has(l, d, k) ?? ""))
      .filter((s) => /(?:^|[^\d.,])0(?:[.,]0+)?\s*(?:zł|zl|PLN)(?!\p{L})/iu.test(s));
    check("no label hardcodes a zero amount", zeroMoney.length === 0, zeroMoney.join(" | "));
    if (inTransit.size > 0) console.log(`  · ${inTransit.size} key(s) found only in the fragment, still awaiting the central merge`);

    if (fragment) {
      const leaves = (node: unknown, path: string[] = []): string[] =>
        node && typeof node === "object"
          ? Object.entries(node as Dict).flatMap(([k, v]) => leaves(v, [...path, k]))
          : [path.join("/")];
      const sets = dicts.map(([l]) => json(leaves(fragment?.[l]).sort()));
      check("the fragment has the same keys in pl, en and de", new Set(sets).size === 1);
      const outside = leaves(fragment.pl).filter((p) => !p.startsWith("admin/newsletter/prelaunch/"));
      check("the fragment adds nothing outside admin.newsletter.prelaunch", outside.length === 0, outside.join(", "));
      check("the fragment changes no existing value", !("_override" in fragment));
    }
  }

  console.log("\nG. THE WIRING");
  {
    const analytics = codeOnly(read("app/admin/newsletter/analityka/page.tsx"));
    check("Analityka asks for the summary once, over its own window",
      (analytics.match(/prelaunchSummary\(supabase, range\.since, range\.until\)/g) ?? []).length === 1);
    check("…and renders the section with it", /<PrelaunchStats summary=\{prelaunch\}/.test(analytics));

    const contacts = codeOnly(read("app/admin/newsletter/kontakty/page.tsx"));
    check("Kontakty validates prelaunch= before it becomes a filter",
      /prelaunch:\s*prelaunchFilterOf\(params\.prelaunch\)/.test(contacts));
    const list = codeOnly(read("components/admin/newsletter/contact-list.tsx"));
    check("the export rebuilds the same filter from the URL",
      /prelaunch:\s*params\.get\("prelaunch"\)/.test(list));
    check("…counts it as an active filter (so 'clear' clears it)", /\[[^\]]*"prelaunch"[^\]]*\]\.filter/.test(list));
    check("…and offers exactly the two values",
      /<option value="pending">/.test(list) && /<option value="confirmed">/.test(list));
    check("the list labels a legacy consent", /consentWithoutDoi/.test(list));

    const detail = codeOnly(read("app/admin/newsletter/kontakty/[id]/page.tsx"));
    check("the contact screen reads the profile in its Promise.all",
      /Promise\.all\(\[[\s\S]*prelaunchContact\(supabase, contact\.id\)[\s\S]*\]\)/.test(detail));
    check("…renders the card", /<PrelaunchContactCard view=\{prelaunch\}/.test(detail));
    check("…and labels a legacy consent", /contact\.consentWithoutDoi/.test(detail));

    const waitlist = codeOnly(read("app/admin/waitlist/page.tsx"));
    check("/admin/waitlist now opens the confirmed pre-launch list",
      /redirect\("\/admin\/newsletter\/kontakty\?prelaunch=confirmed"\)/.test(waitlist));
    check("…and keeps the old source=waitlist view one parameter away",
      /view === "legacy"\) redirect\("\/admin\/newsletter\/kontakty\?source=waitlist"\)/.test(waitlist));
    check("…with the people still waiting to confirm at view=pending",
      /view === "pending"\) redirect\("\/admin\/newsletter\/kontakty\?prelaunch=pending"\)/.test(waitlist));
    // The default must be LAST: a redirect() throws, so anything after the
    // unconditional one is unreachable and a view added below it would be dead.
    const redirects = [...waitlist.matchAll(/redirect\("([^"]+)"\)/g)].map((m) => m[1]);
    check("…and the confirmed list is the unconditional fallback, after the views",
      redirects[redirects.length - 1] === "/admin/newsletter/kontakty?prelaunch=confirmed", redirects.join(" → "));

    // The components lay out an answer; they never fetch one.
    for (const file of ["components/admin/newsletter/prelaunch-stats.tsx", "components/admin/newsletter/prelaunch-contact-card.tsx"]) {
      const src = codeOnly(read(file));
      check(`${file} does not query anything itself`, !/\bsupabase\b|\.from\(|\.rpc\(/.test(src));
      check(`${file} never turns a missing number into a zero`, !/\?\?\s*0\b|\|\|\s*0\b/.test(src));
    }
    const stats = codeOnly(read("components/admin/newsletter/prelaunch-stats.tsx"));
    check("every count goes through the one null-aware formatter",
      (stats.match(/nf\.format\(/g) ?? []).length === 1 && /value === null \? "—" : nf\.format\(value\)/.test(stats));
    check("a failed read is said in a sentence, not as a grid of dashes",
      /summary === null \?[\s\S]*admin\.newsletter\.prelaunch\.unavailable/.test(stats));
    check("the rate is computed from the counts with rate(), never read from the answer",
      /rate\(c\.confirmed, c\.signups\)/.test(stats) && !/confirm_rate|confirmRate/.test(stats));

    const service = codeOnly(read("lib/services/newsletter.ts"));
    check("the service reaches the 0144 functions only through rpc.ts",
      /rpcAdminSummary\(/.test(service) && /rpcAdminContact\(/.test(service)
      && !/"prelaunch_admin_summary"|"prelaunch_admin_contact"/.test(service));

    /*
      THE CONTRACT, BOTH WAYS. lib/server/prelaunch/rpc.ts documents the JSON
      the two admin functions answer with; the database track implements it in
      parallel. Every documented key must still be in that comment (a contract
      change shows up here) and must be read by the parser (a field nobody
      reads is a number nobody sees). confirm_rate is the one key deliberately
      left unread — see parsePrelaunchSummary.
    */
    const rpcSrc = read("lib/server/prelaunch/rpc.ts");
    const SUMMARY_KEYS = [
      "signups", "confirmed", "pending", "expired", "dois_sent", "resends", "send_failures",
      "by_form", "form", "by_source", "utm_source", "utm_medium", "utm_campaign", "by_referrer_host", "host",
      "by_channel", "channel", "count", "referrals", "counted", "rejected", "reason", "top", "signup_id", "email",
      "rewards", "signup_claims", "signup_credits", "referral_claims", "referral_credits",
    ];
    const CONTACT_KEYS = [
      "signup", "status", "created_at", "confirmed_at", "form_variant", "seller_channel", "referral_code",
      "referred_by_email", "referrals_counted", "referral_rejected", "locale", "attribution", "consents",
      "consent_key", "consent_version", "consent_text", "accepted_at", "doc_versions",
    ];
    const notDocumented = [...SUMMARY_KEYS, "confirm_rate", ...CONTACT_KEYS].filter((k) => !new RegExp(`\\b${k}\\b`).test(rpcSrc));
    check("every key this parser expects is still documented in rpc.ts", notDocumented.length === 0, notDocumented.join(", "));
    const unread = [...SUMMARY_KEYS, ...CONTACT_KEYS].filter((k) => !new RegExp(`\\.${k}\\b`).test(service));
    check("…and every documented key is read by the parser", unread.length === 0, unread.join(", "));
    check("…except confirm_rate, on purpose", !/\.confirm_rate\b/.test(service));
  }

  console.log(failures === 0 ? "\nAll pre-launch stats tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("pre-launch stats tests crashed:", e); process.exit(1); });
