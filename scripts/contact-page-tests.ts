/**
 * KONTAKT V2 — WHAT THE CONTACT PAGE, ITS FORM AND ITS ROUTE PROMISE.
 *
 *   A. the model (lib/contact-page.ts): ?temat=, the form's rules, file names,
 *      channel / Messenger / FAQ links, the editor's address formats — and the
 *      /plany question keys held equal to the pricing config;
 *   B. the seed and 0154: real data only, every text in three languages,
 *      the migration is the generator's output;
 *   C. the page as a visitor gets it: one h1, the response time filled in,
 *      only channels with a valid link, FAQ links to existing questions only,
 *      no company tile without real data, the form per topic, order on a
 *      phone, nothing hidden in the HTML;
 *   D. the route (fake database, nothing stored or sent): the refusals, the
 *      fields each topic may carry, files judged by their bytes, the account
 *      snapshot read by the server, no IP stored, the older forms' posts;
 *   E. the editor and the builder: every text editable, the switches with
 *      their notes, the addresses with their formats;
 *   F. the mails: the customer's confirmation (number, topic, response time,
 *      a copy of the message, escaped) and the admin's subject.
 *
 *   npm run test:contact
 */
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@/lib/i18n/config";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";
import { I18nProvider } from "@/lib/i18n/provider";
import { lookup, makeT } from "@/lib/i18n/t";
import { lt, type CmsBlock, type CmsBlockContent } from "@/lib/cms";
import { fieldsFor, splitFields } from "@/lib/cms-schema";
import { CMS_FIELDS, CMS_LINKS } from "@/lib/ice/registry";
import { blockFields, blockToggles } from "@/lib/server/ice/cms";
import { SEED_PAGES } from "@/lib/cms-seed";
import { FAQ } from "@/components/plan/pricing-config";
import {
  CONTACT_REQUIRED_TEXTS, CONTACT_TEXT_KEYS, PLAN_FAQ_KEYS, TICKET_TOPICS, channelHref, faqHref, fillTokens,
  linkValueOk, mailAddress, messengerHref, safeFileName, shownChannels, shownCompany, shownFaq, topicFromParam,
  validateContact,
} from "@/lib/contact-page";
import { BlockRenderer, renderContext } from "@/components/cms/blocks";
import { renderAdminNotification } from "@/lib/server/admin-email";
import { renderConfirmation } from "@/lib/server/contact-tickets";
import { POST as contactPost } from "@/app/api/public/contact/route";
import { POST as uploadsPost } from "@/app/api/public/contact/uploads/route";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const section = (title: string) => console.log(`\n${title}`);

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { pl: pl as Dict, en: en as Dict, de: de as Dict };
const LOCALES: Locale[] = ["pl", "en", "de"];

const KONTAKT = SEED_PAGES.find((p) => p.slug === "kontakt")!;
const BLOCK_ID = "00000000-0000-4000-8000-0000000000c1";
const seedBlock = (patch: (c: CmsBlockContent) => CmsBlockContent = (c) => c): CmsBlock => ({
  id: BLOCK_ID, type: "contact_page", sort_order: 0, visible: true,
  content: patch(structuredClone(KONTAKT.sections[0]!.content)), style: KONTAKT.sections[0]!.style,
  anchor: KONTAKT.sections[0]!.anchor ?? null, analytics_id: KONTAKT.sections[0]!.analyticsId ?? null,
});
type Ctx = Parameters<typeof renderContext>[0];
const render = (locale: Locale, blocks: CmsBlock[], extra: Partial<Ctx> = {}) =>
  renderToStaticMarkup(createElement(I18nProvider, {
    locale, dict: DICTS[locale],
    children: createElement(BlockRenderer, { blocks, ctx: renderContext({ locale, t: makeT(DICTS[locale]), ...extra }) }) as ReactElement,
  }));
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

/* ── A ────────────────────────────────────────────────────────────────────── */
section("A. THE MODEL");
check("?temat=: problem / platnosci / wspolpraca / inne / aplikacja", topicFromParam("problem") === "technical"
  && topicFromParam("platnosci") === "payments" && topicFromParam("wspolpraca") === "cooperation"
  && topicFromParam("inne") === "other" && topicFromParam("aplikacja") === "app");
check("…diacritics and case do not matter (Płatności, PROBLEM)", topicFromParam("Płatności") === "payments" && topicFromParam("PROBLEM") === "technical");
check("…an unknown or odd value is ignored, never an error",
  topicFromParam("xyz") === null && topicFromParam(undefined) === null && topicFromParam(["problem", "x"]) === "technical"
  && topicFromParam("a".repeat(500)) === null && topicFromParam("<script>") === null);
const ok = { topic: "app", name: "", email: "anna@example.com", message: "Dzień dobry, pytanie.", nip: "", generation: "" };
check("the form's rules: a valid message passes (name optional)", Object.keys(validateContact(ok)).length === 0);
check("…e-mail required and shaped", validateContact({ ...ok, email: "" }).email === "required" && validateContact({ ...ok, email: "a@b" }).email === "email");
check("…message min 10, max 5000", validateContact({ ...ok, message: "za mało" }).message === "short"
  && validateContact({ ...ok, message: "x".repeat(5001) }).message === "long" && validateContact({ ...ok, message: "  " }).message === "required");
check("…NIP checked only on payments", validateContact({ ...ok, nip: "abc" }).nip === undefined
  && validateContact({ ...ok, topic: "payments", nip: "abc" }).nip === "nip"
  && validateContact({ ...ok, topic: "payments", nip: "PL 123-456-78-90" }).nip === undefined);
check("…a topic off the list is refused", validateContact({ ...ok, topic: "sales" }).topic === "topic");
check("safe file names: no path, no diacritics, the REAL extension",
  safeFileName("../../etc/passwd.png", "image/png") === "passwd.png"
  && safeFileName("Zrzut ekranu ąę.HEIC", "image/jpeg") === "Zrzut ekranu ae.jpg"
  && safeFileName("", "image/webp") === "zalacznik.webp" && safeFileName('a"<b>.png', "image/png").endsWith(".png")
  && /^[A-Za-z0-9._ -]+$/.test(safeFileName('"><img src=x onerror=alert(1)>.png', "image/png")));
check("channel links: a profile on the channel's own host, https only",
  channelHref("instagram", "https://www.instagram.com/grovbase") !== null
  && channelHref("instagram", "https://facebook.com/grovbase") === null
  && channelHref("instagram", "http://instagram.com/grovbase") === null
  && channelHref("instagram", "https://instagram.com/") === null
  && channelHref("tiktok", "https://www.tiktok.com/@grovbase") !== null
  && channelHref("youtube", "https://youtube.com/@grovbase") !== null
  && channelHref("youtube", "javascript:alert(1)") === null
  && channelHref("facebook", "https://evil.com/?facebook.com") === null
  && channelHref("facebook", "https://instagram.com.evil.com/x") === null);
check("e-mail channel: mailto or a bare address, nothing else",
  channelHref("email", "mailto:contact@grovbase.com") === "mailto:contact@grovbase.com"
  && channelHref("email", "contact@grovbase.com") === "mailto:contact@grovbase.com"
  && channelHref("email", "mailto:a@b.pl?bcc=x@y.pl") === null && mailAddress("javascript:x") === null);
check("Messenger: m.me / messenger.com only", messengerHref("https://m.me/grovbase") !== null && messengerHref("https://evil.me/x") === null);
check("FAQ links: an EXISTING /plany question, another page or https — never a random anchor",
  faqHref("/plany#faq-credits") === "/plany#faq-credits" && faqHref("/plany#faq-invoice") === null
  && faqHref("/plany#faq-premiere") === null && faqHref("/kontakt") === "/kontakt"
  && faqHref("//evil.com") === null && faqHref("javascript:alert(1)") === null && faqHref("https://grovbase.com/x") !== null);
check("the /plany question keys are the pricing config's (minus the premiere one)",
  JSON.stringify(PLAN_FAQ_KEYS) === JSON.stringify(FAQ.filter((f) => !f.when).map((f) => f.key)), JSON.stringify(PLAN_FAQ_KEYS));
check("the editor's address formats", linkValueOk("channel", "https://instagram.com/x", "instagram")
  && !linkValueOk("channel", "https://instagram.com/x", "tiktok") && linkValueOk("channel", "", "tiktok")
  && linkValueOk("nip", "123-456-78-90") && !linkValueOk("nip", "12<3") && linkValueOk("email", "biuro@firma.pl")
  && !linkValueOk("email", "biuro@firma") && linkValueOk("faq", "/plany#faq-topups") && !linkValueOk("faq", "/plany#faq-vat")
  && !linkValueOk("messenger", "https://m.me/x y"));
check("tokens: {czas} and {numer} filled, anything else dropped",
  fillTokens("W ciągu {czas}. #{numer} {inne}", { czas: "1 dnia", numer: "1001" }) === "W ciągu 1 dnia. #1001");

/* ── B ────────────────────────────────────────────────────────────────────── */
section("B. THE SEED AND 0154");
const content = KONTAKT.sections[0]!.content;
check("Kontakt V2 is one contact_page section", KONTAKT.sections.length === 1 && KONTAKT.sections[0]!.type === "contact_page");
check("channels: e-mail, Instagram, Facebook, TikTok, YouTube — only the mailbox has a link of its own",
  (content.items ?? []).map((i) => i.value).join() === "email,instagram,facebook,tiktok,youtube"
  && (content.items ?? []).filter((i) => i.url).map((i) => i.url).join() === "mailto:contact@grovbase.com");
check("no invented profile anywhere in the seed (no social URL, no m.me link)",
  !/https?:\/\/[^"]*(instagram|facebook|tiktok|youtube)\.com|https?:\/\/m\.me\//.test(JSON.stringify(KONTAKT)));
check("FAQ: the five questions; the VAT one has no link (no such question on /plany)",
  (content.tiles ?? []).length === 5 && (content.tiles ?? []).slice(0, 4).every((t) => faqHref(t.url) !== null)
  && !(content.tiles ?? [])[4]!.url);
check("the company tile is off and empty", content.company?.hidden === true && !content.company.title && !content.company.value);
check("every section text key is in the seed", CONTACT_TEXT_KEYS.every((k) => content.fields?.[k]?.pl));
for (const l of LOCALES) {
  const missing = CONTACT_TEXT_KEYS.filter((k) => !content.fields?.[k]?.[l]);
  const items = [...(content.items ?? []), ...(content.tiles ?? [])].filter((i) => !i.title?.[l]).length;
  check(`${l}: every text, channel and question is written (and the SEO)`,
    missing.length === 0 && items === 0 && Boolean(content.title?.[l] && content.subtitle?.[l] && KONTAKT.seo[l]?.title && KONTAKT.seo[l]?.description),
    missing.join(","));
  const fallback = [...CONTACT_REQUIRED_TEXTS, "reply.time", "firm.title", "success.body"].filter((k) => !lookup(DICTS[l], `cms.contact.text.${k}`));
  check(`${l}: every required text has a dictionary fallback`, fallback.length === 0, fallback.join(","));
}
check("the response time is ONE value ({czas} in the subtitle and the success line)",
  /\{czas\}/.test(content.subtitle?.pl ?? "") && /\{czas\}/.test(content.fields?.["success.body"]?.pl ?? "")
  && content.fields?.["reply.time"]?.pl === "1 dnia roboczego");
check("the data clause is the form's existing one (not new legal text)",
  content.fields?.["form.consent"]?.pl === "Wysyłając wiadomość, zgadzasz się na przetwarzanie podanych danych w celu udzielenia odpowiedzi.");
const generated = execFileSync("node", [".next/cms-seed-sql.mjs", "--contact-v2"], { encoding: "utf8" });
const file0154 = readFileSync("supabase/migrations/0154_kontakt_v2.sql", "utf8");
check("supabase/migrations/0154_kontakt_v2.sql is the generator's current output", generated === file0154,
  "run: npm run -s cms:seed-sql -- --contact-v2 > supabase/migrations/0154_kontakt_v2.sql");
check("0154 keeps the old page as a version and runs once",
  /'Przed Kontakt V2'/.test(file0154) && /b\.type = 'contact_page'/.test(file0154) && /'publish', 'Kontakt V2'/.test(file0154));

/* ── C ────────────────────────────────────────────────────────────────────── */
section("C. THE PAGE A VISITOR GETS");
{
  const html = render("pl", [seedBlock()]);
  check("one <h1>: „Napisz do nas”", count(html, /<h1[\s>]/g) === 1 && /<h1[^>]*>Napisz do nas<\/h1>/.test(html));
  check("the badge and the subtitle with the response time filled in",
    />KONTAKT</.test(html) && /Odpowiadamy w ciągu 1 dnia roboczego\. Wybierz kanał/.test(html) && !/\{czas\}|\{numer\}/.test(html));
  const kinds = [...html.matchAll(/data-contact-channel="([a-z]+)"/g)].map((m) => m[1]);
  check("only the channel with a valid link is on the page (the mailbox)", kinds.join() === "email", kinds.join());
  check("…no Instagram, Facebook, TikTok or YouTube text in the HTML at all", !/Instagram|Facebook|TikTok|YouTube|Zobacz przykłady/.test(html));
  check("…the e-mail card: mailto, the address spelled out",
    /href="mailto:contact@grovbase\.com"/.test(html) && /data-contact-address="[^"]*"[^>]*>contact@grovbase\.com</.test(html));
  check("…copy button present and labelled", /data-contact-copy/.test(html) && /Kopiuj adres/.test(html));
  const faq = [...html.matchAll(/data-contact-faq="([^"]+)"/g)].map((m) => m[1]);
  check("FAQ: four links, each to an existing /plany question", faq.join() === "/plany#faq-credits,/plany#faq-topups,/plany#faq-renewal,/plany#faq-refunds", faq.join());
  check("…the VAT question (no link) is not on the page", !/fakturę VAT/.test(html));
  check("…heading „Zanim napiszesz, sprawdź odpowiedzi”", /Zanim napiszesz, sprawdź odpowiedzi/.test(html));
  check("no company tile (off, no data) and no „Dane firmy” in the HTML", !/data-contact-part="company"/.test(html) && !/Dane firmy/.test(html));
  const parts = [...html.matchAll(/data-contact-part="([a-z]+)"/g)].map((m) => m[1]);
  check("phone order is the DOM order: channels → faq → form", parts.join() === "channels,faq,form", parts.join());
  check("form: five topic pills, „Pytanie o aplikację” chosen", count(html, /data-contact-topic="/g) === 5
    && /<input(?=[^>]*value="app")(?=[^>]*checked="")[^>]*>/.test(html) && count(html, /checked=""/g) === 1);
  check("…topic labels from the page", ["Pytanie o aplikację", "Płatności i faktury", "Problem techniczny", "Współpraca / większe zamówienia", "Inne"].every((x) => html.includes(x)));
  check("…no NIP, generation or file field until the topic asks for it", !/name="nip"|name="generation"|type="file"/.test(html));
  check("…honeypot, the privacy link, the submit button", /name="company"/.test(html) && /href="\/polityka-prywatnosci"/.test(html) && /Wyślij wiadomość/.test(html));
  check("…no marketing checkbox", !/type="checkbox"/.test(html));
  check("…no placeholder text anywhere", !/\[[^\]]+\]/.test(html.replace(/<[^>]+>/g, "")));
}
{
  const tech = render("pl", [seedBlock()], { contact: { topic: "technical", email: "jan@example.com" }, signedIn: true });
  const chosen = (html: string, v: string) => new RegExp(`<input(?=[^>]*value="${v}")(?=[^>]*checked="")[^>]*>`).test(html);
  check("?temat=problem: technical chosen, the generation field and up to 3 pictures", chosen(tech, "technical") && !chosen(tech, "app")
    && /name="generation"/.test(tech) && /type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"|accept="image\/jpeg,image\/png,image\/webp"[^>]*type="file"/.test(tech) && /jeszcze 3/.test(tech));
  check("…a signed-in customer's address is filled in", /value="jan@example\.com"/.test(tech));
  const pay = render("pl", [seedBlock()], { contact: { topic: "payments", email: "" } });
  check("?temat=platnosci: the NIP field (no generation, no files)", chosen(pay, "payments") && /name="nip"/.test(pay) && !/name="generation"|type="file"/.test(pay));
}
{
  const site = { instagramUrl: "https://instagram.com/grovbase.test", facebookUrl: "" };
  const html = render("pl", [seedBlock()], { site });
  check("Instagram without its own link uses the site's profile — opened safely",
    /data-contact-channel="instagram"/.test(html) && /href="https:\/\/instagram\.com\/grovbase\.test"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/.test(html));
  const withFb = render("pl", [seedBlock((c) => ({ ...c, items: (c.items ?? []).map((i) => i.value === "facebook"
    ? { ...i, url: "https://facebook.com/grovbase.test", url2: "https://m.me/grovbase.test" } : i) }))]);
  check("Facebook: the page and „Napisz na Messengerze”", /data-contact-channel="facebook"/.test(withFb) && /data-contact-messenger/.test(withFb) && /Napisz na Messengerze/.test(withFb));
  const hidden = render("pl", [seedBlock((c) => ({ ...c, items: (c.items ?? []).map((i) => i.value === "email" ? { ...i, hidden: true } : i) }))]);
  check("a channel switched off is not in the HTML", !/data-contact-channel="email"/.test(hidden) && !/contact@grovbase\.com/.test(hidden));
  const bad = render("pl", [seedBlock((c) => ({ ...c, items: (c.items ?? []).map((i) => i.value === "tiktok" ? { ...i, url: "javascript:alert(1)" } : i) }))]);
  check("a channel with an invalid link hides itself", !/data-contact-channel="tiktok"/.test(bad) && !/javascript:/.test(bad));
  const company = render("pl", [seedBlock((c) => ({ ...c, company: { title: { pl: "GrovBase sp. z o.o." }, description: { pl: "ul. Testowa 1\n00-001 Warszawa" }, value: "123-456-78-90", url: "biuro@example.com" } }))]);
  check("the company tile, once real data is on: name, address, NIP, e-mail — after the form",
    /data-contact-part="company"/.test(company) && /GrovBase sp\. z o\.o\./.test(company) && /123-456-78-90/.test(company)
    && /mailto:biuro@example\.com/.test(company)
    && [...company.matchAll(/data-contact-part="([a-z]+)"/g)].map((m) => m[1]).join() === "channels,faq,form,company");
  const placeholder = render("pl", [seedBlock((c) => ({ ...c, company: { title: { pl: "[nazwa firmy]" } } }))]);
  check("…„[nazwa firmy]” never reaches a visitor", !/nazwa firmy/.test(placeholder) && !/data-contact-part="company"/.test(placeholder));
  const allOff = render("pl", [seedBlock((c) => ({ ...c, tiles: (c.tiles ?? []).map((t) => ({ ...t, hidden: true })) }))]);
  check("FAQ links all switched off: the block is gone", !/data-contact-part="faq"/.test(allOff));
}
for (const l of ["en", "de"] as const) {
  const html = render(l, [seedBlock()]);
  check(`${l}: the page reads in ${l} (no Polish header, topics or button)`,
    !/Napisz do nas|Pytanie o aplikację|Wyślij wiadomość|dnia roboczego/.test(html) && count(html, /<h1[\s>]/g) === 1);
}
check("the section's anchor is the page's form anchor", KONTAKT.sections[0]!.anchor === "formularz");

/* ── D ────────────────────────────────────────────────────────────────────── */
section("D. THE ROUTE (fake database — nothing is stored or sent)");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1]);
const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");
type Call = { fn: string; args: Record<string, unknown> };
const state = {
  calls: [] as Call[], answer: { status: "created", id: "t1", ticket: 1001, duplicate: false } as Record<string, unknown>,
  rpcError: null as null | { code: string; message: string }, user: null as null | { id: string; email: string },
  files: new Map<string, Uint8Array<ArrayBuffer>>(), removed: [] as string[], reads: [] as string[],
  prior: { status: "none" } as Record<string, unknown>, openShort: false, downloads: [] as string[],
};
function chain(table: string): unknown {
  state.reads.push(table);
  const data: Record<string, unknown> = {
    workspace_members: { workspace_id: "w1", role: "owner", workspaces: { id: "w1", name: "Sklep", owner_id: "u1" } },
    credit_wallets: { id: "wal", balance: 120, workspace_id: "w1" },
    subscriptions: { status: "active", subscription_plans: { slug: "pro", name: "Pro" } },
  };
  const result = { data: data[table] ?? null, error: null };
  const proxy: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) proxy[m] = () => proxy;
  proxy.maybeSingle = async () => result;
  proxy.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return proxy;
}
(globalThis as unknown as { __prelaunchSession: unknown }).__prelaunchSession = {
  client: {
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (fn === "contact_reserve_uploads") return { data: { status: "ok", paths: ["2026-10/11111111-1111-4111-8111-111111111111"] }, error: null };
      if (fn === "contact_submission_ticket") return { data: state.prior, error: null };
      if (fn === "contact_attachments_open") return { data: (args.p_paths as string[]).length - (state.openShort ? 1 : 0), error: null };
      if (fn === "contact_attachment_refuse") return { data: null, error: null };
      return { data: state.answer, error: null };
    },
    from: (table: string) => chain(table),
    storage: {
      from: () => ({
        download: async (path: string) => (state.downloads.push(path), state.files.has(path))
          ? { data: new Blob([state.files.get(path)!]), error: null } : { data: null, error: { message: "not found" } },
        remove: async (paths: string[]) => { state.removed.push(...paths); return { data: null, error: null }; },
      }),
    },
  },
};
process.env.GROVBASE_SERVER_KEY = "contact-suite-server-key-0123456789abcdef";
let ipN = 0;
const post = async (body: Record<string, unknown>, from = `198.51.100.${++ipN}`) => {
  const res = await contactPost(new Request("https://grovbase.com/api/public/contact", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from, "user-agent": "Mozilla/5.0 Test" }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const SUB = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const good = { submissionId: SUB, topic: "app", name: "Anna", email: "Anna@Example.com", message: "Dzień dobry, mam pytanie o kredyty.", locale: "pl", elapsed: 6000 };
const last = () => [...state.calls].reverse().find((c) => c.fn === "contact_submit" || c.fn === "contact_reserve_uploads") ?? state.calls[state.calls.length - 1];
const submits = () => state.calls.filter((c) => c.fn === "contact_submit");

void (async () => {
  let r = await post(good);
  const a = last()?.args ?? {};
  check("a real message: 200 with the ticket number from the database", r.status === 200 && r.body.ok === true && r.body.ticket === 1001);
  check("…stored through contact_submit with the server token, the address lower-cased", last()?.fn === "contact_submit"
    && typeof a.p_token === "string" && (a.p_token as string).length > 20 && a.p_email === "anna@example.com" && a.p_topic === "app");
  check("…an IP HASH, never the IP", typeof a.p_ip_hash === "string" && /^[0-9a-f]{64}$/.test(a.p_ip_hash as string)
    && !JSON.stringify(a).includes("198.51.100."));
  check("…a guest: no account snapshot read or sent", JSON.stringify(a.p_account) === "{}" && !state.reads.includes("credit_wallets"));
  check("…the browser recorded from the request (user agent), not from the body", (a.p_client as Record<string, unknown>)?.ua === "Mozilla/5.0 Test");

  state.calls.length = 0;
  r = await post({ ...good, company: "ACME" });
  check("the honeypot filled: refused, never „ok”, nothing stored", r.status === 400 && r.body.ok === false && state.calls.length === 0);
  r = await post({ ...good, elapsed: 300 });
  check("sent 0.3 s after opening: too_fast, nothing stored", r.body.error === "too_fast" && state.calls.length === 0);
  r = await post({ ...good, email: "anna@example" });
  check("a bad address: 400 invalid, field email", r.status === 400 && r.body.field === "email" && state.calls.length === 0);
  r = await post({ ...good, message: "krótko" });
  check("a short message: field message, code short", r.body.field === "message" && r.body.code === "short" && state.calls.length === 0);
  r = await post({ ...good, topic: "sales" });
  check("a topic off the list (new form): invalid topic", r.body.field === "topic" && state.calls.length === 0);
  r = await post({ ...good, attachments: [{ path: "2026-10/11111111-1111-4111-8111-111111111111", name: "a.png", size: 10, mime: "image/png" }] });
  check("pictures on a non-technical topic: refused", r.body.field === "attachments" && state.calls.length === 0);
  r = await post({ ...good, attachments: [{ path: "../../etc/passwd", name: "a.png", size: 10, mime: "image/png" }], topic: "technical" });
  check("a path that is not a reserved slot's shape: refused before any storage read", r.body.field === "attachments" && state.calls.length === 0);

  r = await post({ ...good, submissionId: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb", topic: "payments", nip: "PL 123-456-78-90", generation: "gen_1" });
  check("payments: the NIP travels, a generation id does not", last()?.args.p_nip === "PL 123-456-78-90" && last()?.args.p_generation === undefined);
  r = await post({ ...good, submissionId: "cccccccc-1111-4111-8111-cccccccccccc", nip: "PL 123" });
  check("…a NIP on any other topic is dropped, not stored", last()?.args.p_nip === undefined);
  r = await post({ ...good, topic: "payments", nip: "<b>" });
  check("…an invalid NIP: field nip", r.body.field === "nip");

  const P1 = "2026-10/11111111-1111-4111-8111-111111111111";
  const P2 = "2026-10/22222222-2222-4222-8222-222222222222";
  state.files.set(P1, PNG); state.files.set(P2, HTML);
  state.calls.length = 0;
  r = await post({ ...good, submissionId: "dddddddd-1111-4111-8111-dddddddddddd", topic: "technical", generation: "gen_42",
    attachments: [{ path: P1, name: "zrzut ąę.jpg", size: 99999, mime: "image/jpeg" }] });
  const files = (last()?.args.p_attachments ?? []) as { path: string; name: string; size: number; mime: string }[];
  check("a technical ticket with a picture: judged by its BYTES (PNG), real size, safe name",
    r.status === 200 && files.length === 1 && files[0]!.mime === "image/png" && files[0]!.size === PNG.length && files[0]!.name === "zrzut ae.png"
    && last()?.args.p_generation === "gen_42", JSON.stringify(files));
  state.calls.length = 0;
  r = await post({ ...good, submissionId: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee", topic: "technical",
    attachments: [{ path: P2, name: "zdjecie.png", size: 10, mime: "image/png" }] });
  check("an HTML file named .png: refused (attachment_invalid), marked refused, removed from the bucket, no ticket",
    r.body.error === "attachment_invalid" && state.removed.includes(P2) && submits().length === 0
    && state.calls.some((c) => c.fn === "contact_attachment_refuse" && c.args.p_path === P2));
  r = await post({ ...good, submissionId: "eeeeeeee-1111-4111-8111-eeeeeeeeeee2", topic: "technical",
    attachments: [{ path: "2026-10/33333333-3333-4333-8333-333333333333", name: "x.png", size: 10, mime: "image/png" }] });
  check("a picture that was never uploaded: upload_failed, no ticket", r.body.error === "upload_failed" && submits().length === 0);
  state.calls.length = 0;
  state.openShort = true;
  r = await post({ ...good, submissionId: "eeeeeeee-1111-4111-8111-eeeeeeeeeee3", topic: "technical",
    attachments: [{ path: P1, name: "a.png", size: 10, mime: "image/png" }] });
  check("a slot the database will not open for checking (expired, refused, another submission): upload_failed, nothing read",
    r.body.error === "upload_failed" && submits().length === 0 && !state.calls.some((c) => c.fn === "contact_attachment_refuse"));
  state.openShort = false;
  check("…files are opened for checking through the token, with this submission's id",
    state.calls.some((c) => c.fn === "contact_attachments_open" && c.args.p_submission === "eeeeeeee-1111-4111-8111-eeeeeeeeeee3" && typeof c.args.p_token === "string"));

  state.user = { id: "u1", email: "jan@example.com" };
  state.reads.length = 0;
  r = await post({ ...good, submissionId: "ffffffff-1111-4111-8111-ffffffffffff", account: { plan: "enterprise", credits: 99999 }, userId: "someone-else" });
  const acc = last()?.args.p_account as Record<string, unknown>;
  check("a signed-in customer: plan and credits read by the SERVER, the body's claims ignored",
    acc?.plan === "pro" && acc?.credits === 120 && acc?.workspace_id === "w1" && !JSON.stringify(last()?.args).includes("someone-else")
    && !JSON.stringify(last()?.args).includes("enterprise"), JSON.stringify(acc));
  check("…and no user id is sent at all (the database takes auth.uid())", !("p_user_id" in (last()?.args ?? {})));
  state.user = null;

  state.answer = { status: "rate_limited" };
  r = await post({ ...good, submissionId: "a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1" });
  check("the database's limit: 429 rate_limited", r.status === 429 && r.body.error === "rate_limited");
  state.answer = { status: "invalid", field: "email" };
  r = await post({ ...good, submissionId: "a2a2a2a2-1111-4111-8111-a2a2a2a2a2a2" });
  check("the database's own refusal is passed on, never „ok”", r.status === 400 && r.body.ok === false && r.body.field === "email");
  state.answer = { status: "created", id: "t1", ticket: 1001, duplicate: true };
  r = await post(good);
  check("a retry of the same submission: the SAME ticket number, ok", r.status === 200 && r.body.ticket === 1001 && r.body.duplicate === true);
  state.answer = { status: "created", id: "t1", ticket: 1001, duplicate: false };
  state.prior = { status: "found", id: "t9", ticket: 1077 };
  state.calls.length = 0; state.downloads.length = 0;
  r = await post({ ...good, submissionId: "a9a9a9a9-1111-4111-8111-a9a9a9a9a9a9", topic: "technical",
    attachments: [{ path: P1, name: "a.png", size: 10, mime: "image/png" }] });
  check("a retry after a lost response (ticket already made, files bound): that ticket — no file re-read, no new ticket",
    r.status === 200 && r.body.ticket === 1077 && r.body.duplicate === true && state.downloads.length === 0 && submits().length === 0);
  state.prior = { status: "mismatch" };
  r = await post({ ...good, submissionId: "a9a9a9a9-1111-4111-8111-a9a9a9a9a9a9" });
  check("…the same submission id with another address: refused", r.status === 400 && r.body.field === "submission" && submits().length === 0);
  state.prior = { status: "none" };
  state.rpcError = { code: "PGRST202", message: "function not found" };
  r = await post({ ...good, submissionId: "a3a3a3a3-1111-4111-8111-a3a3a3a3a3a3" });
  check("the function missing (migration not applied): 503 unavailable, never „ok”", r.status === 503 && r.body.error === "unavailable");
  state.rpcError = null;
  const key = process.env.GROVBASE_SERVER_KEY;
  delete process.env.GROVBASE_SERVER_KEY;
  state.calls.length = 0;
  r = await post({ ...good, submissionId: "a4a4a4a4-1111-4111-8111-a4a4a4a4a4a4" });
  check("no server key: 503 unavailable, nothing attempted", r.status === 503 && r.body.error === "unavailable" && state.calls.length === 0);
  process.env.GROVBASE_SERVER_KEY = key;

  state.calls.length = 0;
  r = await post({ name: "Ola", email: "ola@example.com", topic: "question", message: "Stary formularz, pytanie.", locale: "pl", elapsed: 5000 });
  check("the older forms (no submission id, old topics) still get a ticket: question → app",
    r.status === 200 && last()?.args.p_topic === "app" && /^[0-9a-f-]{36}$/.test(String(last()?.args.p_submission)) && last()?.args.p_source === "kontakt-legacy");
  r = await post({ email: "ola@example.com", topic: "support", message: "Stary formularz, problem techniczny." , elapsed: 5000});
  check("…support → technical", last()?.args.p_topic === "technical");
  const big = await contactPost(new Request("https://grovbase.com/api/public/contact", {
    method: "POST", headers: { "x-forwarded-for": "198.51.100.250" }, body: "x".repeat(70_000),
  }));
  check("a body over 64 KB is refused", big.status === 413);
  const burst: number[] = [];
  for (let i = 0; i < 13; i++) burst.push((await post({ ...good, submissionId: `b0b0b0b0-1111-4111-8111-${String(i).padStart(12, "0")}` }, "203.0.113.77")).status);
  check("the in-memory brake: the 13th post within the hour from one IP is refused before the database", burst[12] === 429 && burst.slice(0, 12).every((s) => s === 200), burst.join(","));

  const up = async (body: Record<string, unknown>) => {
    const res = await uploadsPost(new Request("https://grovbase.com/api/public/contact/uploads", {
      method: "POST", headers: { "x-forwarded-for": "198.51.100.9" }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  let u = await up({ submissionId: SUB, count: 4 });
  check("upload slots: more than three refused", u.status === 400);
  u = await up({ submissionId: "nope", count: 1 });
  check("…a submission id that is not a uuid refused", u.status === 400);
  u = await up({ submissionId: SUB, count: 1 });
  check("…one slot reserved through the database, its path returned (no URL)", u.status === 200 && Array.isArray(u.body.paths)
    && !JSON.stringify(u.body).includes("http") && last()?.fn === "contact_reserve_uploads" && /^[0-9a-f]{64}$/.test(String(last()?.args.p_ip_hash)));

  /* ── E ──────────────────────────────────────────────────────────────────── */
  section("E. THE EDITOR AND THE BUILDER");
  const block = seedBlock();
  const fields = blockFields(block, "2026-10-24T10:00:00Z");
  const textPaths = fields.filter((f) => f.kind === "text").map((f) => f.path.join("."));
  check("Edytuj stronę: every text key of the section is an editable field",
    CONTACT_TEXT_KEYS.every((k) => textPaths.includes(`fields.${k}`)) && ["badge", "title", "subtitle"].every((k) => textPaths.includes(k)));
  check("…each channel's name and line, each question, the company's name and address",
    textPaths.includes("items.0.title") && textPaths.includes("items.4.description") && textPaths.includes("tiles.4.title")
    && textPaths.includes("company.title") && textPaths.includes("company.description"));
  const links = fields.filter((f) => f.kind === "link");
  check("…the addresses are LINK fields with their format (channel / messenger / faq / nip / email)",
    links.some((f) => f.path.join(".") === "items.1.url" && f.format === "channel" && f.channel === "instagram")
    && links.some((f) => f.path.join(".") === "items.2.url2" && f.format === "messenger")
    && links.some((f) => f.path.join(".") === "tiles.4.url" && f.format === "faq")
    && links.some((f) => f.path.join(".") === "company.value" && f.format === "nip")
    && links.some((f) => f.path.join(".") === "company.url" && f.format === "email"));
  check("…links come after every text (the marker numbering of texts does not move)",
    fields.findIndex((f) => f.kind === "link") > Math.max(...fields.map((f, i) => (f.kind === "text" ? i : -1))));
  const toggles = blockToggles(block, null);
  check("Widoczność: the section, five channels, five questions, the company — each reorderable list with its place",
    toggles.length === 12 && toggles.filter((x) => x.move?.list === "items").length === 5 && toggles.filter((x) => x.move?.list === "tiles").length === 5
    && toggles.some((x) => x.path.join() === "company" && x.hidden));
  check("…a channel without a link says so; the VAT question says „wymaga konfiguracji”",
    toggles.find((x) => x.path.join() === "items,3")?.note === "no_link" && toggles.find((x) => x.path.join() === "tiles,4")?.note === "needs_config"
    && toggles.find((x) => x.path.join() === "items,0")?.note === undefined);
  const withSite = blockToggles(block, null, { instagramUrl: "https://instagram.com/x" });
  check("…Instagram with a site profile is not flagged", withSite.find((x) => x.path.join() === "items,1")?.note === undefined);
  check("the registry lists the section and its links", Boolean(CMS_FIELDS.contact_page) && (CMS_LINKS.contact_page ?? []).length === 5);
  const defs = fieldsFor("contact_page");
  const keys = defs.map((d) => d.key);
  check("Strony WWW: one long form with every text key, the channels, the questions and the company",
    CONTACT_TEXT_KEYS.every((k) => keys.includes(k)) && keys.includes("items") && keys.includes("tiles") && keys.includes("company")
    && splitFields("contact_page", defs).advanced.length === 0);
  const labelMissing = LOCALES.flatMap((l) => defs.flatMap((d) => [d.label, d.hint].filter(Boolean)
    .filter((k) => !lookup(DICTS[l], `cms.label.${k}`)).map((k) => `${l}:${k}`)));
  check("…every label and hint is translated", labelMissing.length === 0, labelMissing.slice(0, 6).join(","));
  const iceMissing = LOCALES.flatMap((l) => CONTACT_TEXT_KEYS.filter((k) => !lookup(DICTS[l], `ice.contactField.${k.replace(/\./g, "_")}`)).map((k) => `${l}:${k}`));
  check("…every text has its name in the editor, in three languages", iceMissing.length === 0, iceMissing.join(","));
  const errMissing = LOCALES.flatMap((l) => [
    "name.long", "name.invalid", "email.required", "email.email", "email.invalid", "message.required", "message.short", "message.long",
    "message.invalid", "nip.nip", "nip.invalid", "generation.generation", "generation.invalid", "attachments.count", "attachments.size",
    "attachments.type", "rate_limited", "too_fast", "unavailable", "attachment_invalid", "upload_failed", "upload_limit", "invalid",
    "network", "generic",
  ].filter((k) => !lookup(DICTS[l], `cms.contact.err.${k}`)).map((k) => `${l}:${k}`));
  check("every refusal the form can show is a sentence in three languages", errMissing.length === 0, errMissing.join(","));
  check("shown parts agree with the model", shownChannels(block.content ?? {}, {}, "pl").length === 1
    && shownFaq(block.content ?? {}, "pl").length === 4 && shownCompany(block.content ?? {}, "pl") === null);

  /* ── F ──────────────────────────────────────────────────────────────────── */
  section("F. THE MAILS");
  (globalThis as unknown as { __contactPage: unknown }).__contactPage = { slug: "kontakt", blocks: [block] };
  const fakeDb = { rpc: async () => ({ data: null, error: null }) } as never;
  const mail = await renderConfirmation(fakeDb, null, {
    id: "t1", ticket_no: 1042, email: "anna@example.com", topic: "technical",
    message: "Generator <b>nie działa</b>.\n\nDrugi akapit.", locale: "pl", sender_verified: true,
  });
  check("the customer's confirmation: the number in the subject, the topic, the response time",
    Boolean(mail) && /#1042/.test(mail!.subject) && /Problem techniczny/.test(mail!.html) && /1 dnia roboczego/.test(mail!.html));
  check("…a signed-in author writing from their own address gets a copy of the message, ESCAPED", /Generator &lt;b&gt;nie działa&lt;\/b&gt;\./.test(mail!.html) && !/<b>nie działa<\/b>/.test(mail!.html)
    && /Drugi akapit\./.test(mail!.text));
  check("…no name (the address is not proven)", !/Anna/.test(mail!.html));
  const guest = await renderConfirmation(fakeDb, null, {
    id: "t2", ticket_no: 1043, email: "victim@example.com", topic: "other",
    message: "Kup tanio! https://spam.example/x", locale: "pl", sender_verified: false,
  });
  check("…a guest's (unproven) address gets NO copy: nothing a stranger typed is relayed from our mailbox",
    Boolean(guest) && /#1043/.test(guest!.subject) && !/spam\.example|Kup tanio/.test(guest!.html + guest!.text) && !/Twoja wiadomość/.test(guest!.html));
  const en_ = await renderConfirmation(fakeDb, null, { id: "t1", ticket_no: 7, email: "a@b.com", topic: "app", message: "Hello there, a question.", locale: "en", sender_verified: false });
  check("…in the language the person wrote in", /ticket #7/i.test(en_!.subject) && /Question about the app/.test(en_!.html) && /1 business day/.test(en_!.html));
  const admin = renderAdminNotification({ eventType: "contact.message", occurredAt: "24.10.2026 10:00",
    title: "[Problem techniczny] #1042 – klient@example.com", icon: "", rows: [["📧 E-mail", "klient@example.com"]] });
  check("the admin's mail: subject „[Problem techniczny] #1042 – klient@example.com”", admin.subject === "[Problem techniczny] #1042 – klient@example.com", admin.subject);
  check("…its button goes to the tickets in the panel", /\/admin\/support\/zgloszenia/.test(admin.html));
  check("topic names used by the admin list exist for every topic", TICKET_TOPICS.every((tp) => LOCALES.every((l) => lookup(DICTS[l], `cms.contact.text.topic.${tp}`))));
  check("lt() of a seeded topic matches the dictionary fallback", lt(content.fields?.["topic.technical"], "pl") === lookup(DICTS.pl, "cms.contact.text.topic.technical"));
})().then(() => {
  console.log(failures === 0 ? "\nAll Kontakt tests passed." : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}, (e: unknown) => {
  console.error(e);
  process.exit(1);
});
