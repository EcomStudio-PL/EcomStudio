/**
 * GROVBASE ADMIN NOTIFICATIONS — the Telegram design system's test suite.
 *
 * Every real event is rendered here through the same builder production uses,
 * then asserted on: the shape of the card, the honesty of its contents (no
 * undefined, no empty separators, no duplicated facts), the escaping of
 * user-supplied text, the message limits, and the buttons.
 *
 * Pure functions only — bundled with the server-only stub, no network, no
 * database. The cards are printed as well as asserted, because a layout you
 * cannot see is a layout nobody reviews.
 */
import {
  actionsFor, buildNotification, buttonUrlOk, localeFlag, renderTelegramNotification,
  splitIconLabel, TG_MESSAGE_MAX, TG_ROWS_MAX,
} from "@/lib/server/telegram-notification";
import { formatTelegram, renderTelegramCard } from "@/lib/server/notify";
import { defaultTemplate, renderTemplateTelegram } from "@/lib/server/message-templates";
import { richEntitiesEnabled, sendTelegramMessage, setRichEntitiesEnabled } from "@/lib/server/telegram";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 300)}`}`);
  if (!cond) failures += 1;
}

/** Every assertion that must hold for EVERY card, whatever the event. */
function houseRules(label: string, text: string) {
  check(`${label}: no undefined / null / NaN anywhere`,
    !/\bundefined\b|\bnull\b|\bNaN\b/.test(text), text);
  check(`${label}: no ASCII-art rules or box drawing`,
    !/[━│┌└┐┘├┤┬┴┼─]|={4,}|-{4,}/.test(text), text);
  check(`${label}: no dangling separator or empty row`,
    !/(^|\n)\s*[·|:]\s*($|\n)/.test(text) && !/·\s*·/.test(text) && !/\n{3,}/.test(text), JSON.stringify(text));
  check(`${label}: opens with an icon and a bold headline`,
    /^\S+ <b>[^<]+<\/b>/.test(text), text.split("\n")[0]);
  check(`${label}: inside Telegram's ${TG_MESSAGE_MAX}-character limit`, text.length <= TG_MESSAGE_MAX, text.length);
  check(`${label}: every opened tag is closed`, tagsBalanced(text), text);
}

/** A crude but effective parser: Telegram rejects the whole message on an
 *  unmatched tag, so the suite refuses to ship one. */
function tagsBalanced(html: string): boolean {
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-z]+)(?:\s[^>]*)?>/g)) {
    const [, closing, tag] = m;
    if (closing) { if (stack.pop() !== tag) return false; }
    else stack.push(tag!);
  }
  return stack.length === 0;
}

function show(label: string, text: string, keyboard?: { inline_keyboard: { text: string }[][] }) {
  const buttons = (keyboard?.inline_keyboard ?? []).flat().map((b) => `[ ${b.text} ]`).join(" ");
  console.log(`\n──── ${label} ────\n${text}${buttons ? `\n${buttons}` : ""}\n`);
}

/* ── A. the reference card ──────────────────────────────────────────────────*/

console.log("\nA. USER_REGISTERED — the reference design");
const registration = renderTelegramCard({
  type: "user.registered",
  title: "NOWA REJESTRACJA",
  icon: "🎉",
  rows: [
    ["👤 Użytkownik", "Take Digit"],
    ["📧 E-mail", "takedigital7@gmail.com"],
    ["📱 Telefon", "123 456 789"],
    ["🕒 Data", "06.09.2026 • 14:02"],
    ["🌍 Źródło", "Google"],
  ],
  data: {
    name: "Take Digit", email: "takedigital7@gmail.com", phone: "123 456 789",
    source: "Google", referral: "TikTok", language: "PL",
    ip: "31.175.22.11", device: "iPhone · iOS · Safari",
    date: "06.09.2026", time: "14:02", user_id: "u-123",
  },
  footer: "GrovBase Admin",
}, { event: "user.registered" });
show("USER_REGISTERED", registration.text, registration.keyboard);
houseRules("registration", registration.text);
{
  const t = registration.text;
  check("headline + locale flag", t.includes("🎉 <b>NOWA REJESTRACJA</b> · 🇵🇱 PL"), t.split("\n")[0]);
  check("subtitle comes from the one voice registry", t.includes("<i>Nowy użytkownik w GrovBase</i>"));
  check("the person is the bold primary row", t.includes("👤  <b>Take Digit</b>"));
  check("plain rows carry the value, not a label", t.includes("📧  takedigital7@gmail.com"));
  check("two questions, two icons (źródło vs polecenie)",
    t.includes("🌍  Google") && t.includes("👥  TikTok"));
  check("the address is monospace on the meta line",
    t.includes("📍 <code>31.175.22.11</code> · iPhone · iOS · Safari"));
  check("the moment is the bold meta line", t.includes("<b>06.09.2026 · 14:02</b>"));
  check("language is the flag, never also a row", !t.includes("🗣"));
  check("the legacy 'Data' row did not duplicate the meta stamp",
    (t.match(/06\.09\.2026/g) ?? []).length === 1, t);
  check("button points at the real customer route",
    registration.keyboard?.inline_keyboard[0]?.[0]?.url?.endsWith("/admin/users/u-123") === true,
    JSON.stringify(registration.keyboard));
  check("button is labelled for a human", registration.keyboard?.inline_keyboard[0]?.[0]?.text === "Otwórz klienta");
}

/* ── B. every other real event ──────────────────────────────────────────────*/

console.log("\nB. THE REST OF THE FAMILY — same shape, different facts");
{
  const waitlist = renderTelegramCard({
    type: "waitlist.signup", title: "NOWY ZAPIS NA LISTĘ", icon: "📝",
    rows: [["👤 Użytkownik", "Anna Nowak"], ["🕒 Data", "06.09.2026 • 09:15"]],
    data: {
      name: "Anna Nowak", email: "anna@example.com", source: "Instagram",
      language: "EN", ip: "203.0.113.7", device: "Android · Chrome",
      date: "06.09.2026", time: "09:15",
    },
    footer: "GrovBase Waitlist",
  }, { event: "waitlist.signup" });
  show("WAITLIST_SIGNUP", waitlist.text, waitlist.keyboard);
  houseRules("waitlist", waitlist.text);
  check("waitlist gets its own voice line", waitlist.text.includes("Nowy kontakt zainteresowany GrovBase"));
  check("EN renders the British flag", waitlist.text.includes("🇬🇧 EN"));
  check("waitlist button opens the list",
    waitlist.keyboard?.inline_keyboard[0]?.[0]?.url?.endsWith("/admin/waitlist") === true);

  const mail = renderTelegramCard({
    type: "mail.received", title: "NOWY E-MAIL", icon: "✉️",
    rows: [["Od", "Take Digit <takedigital7@gmail.com>"], ["Temat", "Pytanie o fakturę"]],
    data: {
      name: "Take Digit", email: "takedigital7@gmail.com", subject: "Pytanie o fakturę",
      date: "06.09.2026", time: "14:02",
    },
    quote: "Dzień dobry, czy mogę prosić o fakturę za wrzesień?",
  }, { event: "mail.received" });
  show("MAIL_RECEIVED", mail.text, mail.keyboard);
  houseRules("mail", mail.text);
  check("the sender is stated once, not twice",
    (mail.text.match(/takedigital7@gmail\.com/g) ?? []).length === 1, mail.text);
  check("the subject has its own icon", mail.text.includes("📨  Pytanie o fakturę"));
  check("the excerpt is quoted in italics", mail.text.includes("💬  <i>„Dzień dobry"));

  const error = renderTelegramCard({
    type: "system.error", title: "BŁĄD GENEROWANIA", icon: "⚠️",
    rows: [["Dostawca", "openai"], ["Model", "gpt-image-1"], ["Błąd", "model_overloaded"]],
    data: { provider: "openai", model: "gpt-image-1", error: "model_overloaded", status: "3 nieudanych prób" },
    details: "attempt 1: 429 rate_limited\nattempt 2: 503 upstream\nattempt 3: 503 upstream",
    footer: "Nieudane próby: 3",
  }, { event: "system.error" });
  show("SYSTEM_ERROR", error.text, error.keyboard);
  houseRules("error", error.text);
  check("the failure is monospace and single", error.text.includes("⛔  <code>model_overloaded</code>"));
  check("technical detail is folded, not a wall",
    error.text.includes("<blockquote expandable>") && !error.text.includes("attempt 3: 503 upstream\n\n"));
  check("the plain rendering swaps the fold for a code block",
    error.plain.includes("<pre>") && !error.plain.includes("<blockquote"));
  check("error button opens the log",
    error.keyboard?.inline_keyboard[0]?.[0]?.url?.endsWith("/admin/logs") === true);
}

/* ── C. the events billing has not built yet ────────────────────────────────*/

console.log("\nC. SALES EVENTS — no trigger exists, but the design does");
{
  const payment = renderTelegramCard({
    type: "payment.received", title: "NOWA PŁATNOŚĆ", icon: "💳",
    data: {
      amount: "299,00 PLN", name: "Take Digit", email: "takedigital7@gmail.com",
      plan: "PRO", method: "Karta", status: "Opłacona", transaction: "pi_3Q7x",
      language: "PL", date: "06.09.2026", time: "14:02",
    },
  }, { event: "payment.received" });
  show("PAYMENT_RECEIVED", payment.text, payment.keyboard);
  houseRules("payment", payment.text);
  check("the amount leads the card, in bold",
    payment.text.split("\n\n")[1]?.startsWith("💰  <b>299,00 PLN</b>") === true, payment.text.split("\n\n")[1]);
  check("no fake CTA for a screen that does not exist", payment.keyboard === undefined);

  const sub = renderTelegramCard({
    type: "subscription.created", title: "NOWA SUBSKRYPCJA", icon: "👑",
    data: {
      name: "Take Digit", plan: "PRO", amount: "299 PLN / mies.", period: "miesięczny",
      status: "Aktywna", next_payment: "06.10.2026", language: "PL",
    },
  }, { event: "subscription.created" });
  show("SUBSCRIPTION_CREATED", sub.text);
  houseRules("subscription", sub.text);
  check("a field the icon cannot carry keeps a short label",
    sub.text.includes("🔁  <b>Następna płatność:</b> 06.10.2026"), sub.text);

  const credits = renderTelegramCard({
    type: "credits.purchased", title: "ZAKUP KREDYTÓW", icon: "💰",
    data: { credits: "+1000 kredytów", amount: "149 PLN", name: "Take Digit", balance: "1 240", language: "PL" },
  }, { event: "credits.purchased" });
  show("CREDITS_PURCHASED", credits.text);
  houseRules("credits", credits.text);
  check("only ONE highlight leads; the rest stay rows",
    (credits.text.match(/<b>\+1000 kredytów<\/b>/g) ?? []).length === 1 && credits.text.includes("💰  <b>149 PLN</b>"),
    credits.text);
}

/* ── D. hostile and missing data ────────────────────────────────────────────*/

console.log("\nD. NULLS, GIANTS AND INJECTION");
{
  const bare = renderTelegramCard({
    type: "user.registered", title: "NOWA REJESTRACJA", icon: "🎉",
    data: { name: "Jan", email: "jan@example.com" },
  }, { event: "user.registered" });
  show("MINIMAL (no phone, no ip, no device, no locale)", bare.text, bare.keyboard);
  houseRules("minimal", bare.text);
  check("no flag is invented when the locale is unknown", !/🇵🇱|🇬🇧|🇩🇪/.test(bare.text));
  check("no meta line when there is no meta", !bare.text.includes("📍"));
  check("a missing user id falls back to the customer LIST, not a broken link",
    bare.keyboard?.inline_keyboard[0]?.[0]?.url?.endsWith("/admin/users") === true);

  const partialMeta = renderTelegramCard({
    type: "user.registered", title: "T", icon: "🎉",
    data: { name: "Jan", ip: "203.0.113.7" },
  });
  check("ip without a device prints no trailing separator",
    partialMeta.text.includes("📍 <code>203.0.113.7</code>") && !/203\.0\.113\.7<\/code> ·/.test(partialMeta.text),
    partialMeta.text);
  const deviceOnly = renderTelegramCard({
    type: "user.registered", title: "T", icon: "🎉",
    data: { name: "Jan", device: "iPhone · iOS · Safari" },
  });
  check("device without an ip prints no leading separator",
    !deviceOnly.text.includes("📍") && deviceOnly.text.includes("iPhone · iOS · Safari"), deviceOnly.text);

  const hostile = renderTelegramCard({
    type: "user.registered", title: "<b>PWNED</b>", icon: "🎉",
    data: {
      name: "<script>alert(1)</script>",
      email: "a@b.pl\" onmouseover=\"x",
      source: "<a href='https://evil.example'>klik</a>",
    },
  });
  show("HOSTILE INPUT", hostile.text);
  houseRules("hostile", hostile.text);
  check("user text can never open a tag",
    hostile.text.includes("&lt;script&gt;") && !hostile.text.includes("<script>")
    && !hostile.text.includes("<a href"), hostile.text);
  check("even the title is escaped", hostile.text.includes("&lt;b&gt;PWNED&lt;/b&gt;"));

  const giant = renderTelegramCard({
    type: "user.registered", title: "NOWA REJESTRACJA", icon: "🎉",
    data: {
      name: "Ą".repeat(400),
      email: `${"długi".repeat(60)}@example.com`,
      source: `https://example.com/${"utm-".repeat(200)}`,
      ip: "203.0.113.7", device: "X".repeat(300),
    },
    quote: "Ł".repeat(2000),
    details: "stack".repeat(3000),
    footer: "F".repeat(500),
  });
  houseRules("giant", giant.text);
  // Table rows are one line each and must stay scannable; the quote and the
  // folded details are paragraphs by design, so they answer to their own
  // budgets instead of the row budget.
  const giantRows = giant.text.split("\n")
    .filter((l) => /^\p{Extended_Pictographic}/u.test(l) && !l.startsWith("💬") && !l.startsWith("➕"));
  check("giant values are cut, never wrapped into a wall of rows",
    giantRows.every((l) => l.length <= 220), giantRows.map((l) => l.length).join(","));
  const quoteLine = giant.text.split("\n").find((l) => l.startsWith("💬")) ?? "";
  check("the excerpt honours its own budget", quoteLine.length <= 300, quoteLine.length);
  const detailsBlock = /<blockquote expandable>([\s\S]*?)<\/blockquote>/.exec(giant.text)?.[1] ?? "";
  check("folded details are capped, not unbounded",
    detailsBlock.length > 0 && detailsBlock.length <= 500, detailsBlock.length);
  check("a cut never leaves a broken HTML entity", !/&[a-z]*…|&[a-z]{0,4}$/.test(giant.text));

  const many = renderTelegramCard({
    type: "payment.received", title: "DUŻO PÓL", icon: "💳",
    data: {
      amount: "299 PLN", name: "A", email: "b@c.pl", phone: "1", source: "s", referral: "r",
      campaign: "c", plan: "p", period: "m", status: "ok", method: "card", balance: "10",
      transaction: "tx", subject: "subj", provider: "prov", model: "mod",
    },
  });
  show("COMPACT MODE (16 fields in)", many.text);
  const rowLines = many.text.split("\n\n")[1]?.split("\n") ?? [];
  check(`compact mode caps the table at ${TG_ROWS_MAX} rows + the highlight`,
    rowLines.length <= TG_ROWS_MAX + 2, String(rowLines.length));
  check("and says what it left out instead of hiding it", many.text.includes("więcej w panelu"), many.text);
}

/* ── E. the pieces ──────────────────────────────────────────────────────────*/

console.log("\nE. UNITS");
{
  check("flags only for locales we actually know",
    localeFlag("pl") === "🇵🇱 PL" && localeFlag("EN") === "🇬🇧 EN" && localeFlag("DE") === "🇩🇪 DE"
    && localeFlag("ZZ") === "" && localeFlag(undefined) === "");
  check("an emoji label splits into icon + text",
    splitIconLabel("👤 Użytkownik").icon === "👤" && splitIconLabel("👤 Użytkownik").text === "Użytkownik"
    && splitIconLabel("Temat").icon === "" && splitIconLabel("Temat").text === "Temat");
  check("actions exist only for events with a real admin screen",
    actionsFor("user.registered", { user_id: "x" }).length === 1
    && actionsFor("payment.received").length === 0
    && actionsFor(undefined).length === 0);
  // Telegram rejects the WHOLE message when a button URL is not absolute
  // http(s) — which is what a developer's http://localhost would be. No
  // button is the correct answer there, never a failed send.
  check("only an absolute https URL may become a button",
    buttonUrlOk("https://grovbase.com/admin/users") && !buttonUrlOk("http://localhost:3000/admin/users")
    && !buttonUrlOk("/admin/users") && !buttonUrlOk("javascript:alert(1)"));
  const localhostButton = renderTelegramNotification({
    icon: "🎉", title: "T", rows: [],
    actions: [{ label: "Otwórz", url: "http://localhost:3000/admin/users" }],
  });
  check("…so a localhost action yields no keyboard at all", localhostButton.keyboard === undefined);
  const built = buildNotification({ event: "user.registered", title: "T", data: { name: "A", code: "482193" } });
  check("a secret-shaped field never becomes a row",
    built.rows.every((r) => r.value !== "482193"), JSON.stringify(built.rows));
  check("formatTelegram still returns just the text", typeof formatTelegram({ title: "T", icon: "🎉" }) === "string");
}

/* ── F. published admin templates ───────────────────────────────────────────*/

console.log("\nF. PUBLISHED TEMPLATES — the admin owns the words, not the layout");
{
  const def = defaultTemplate("user.registered:telegram")!;
  if (def.channel !== "telegram") throw new Error("wrong channel");
  const data = {
    name: "Take Digit", email: "takedigital7@gmail.com", phone: "123 456 789",
    date: "06.09.2026", time: "14:02", source: "Google", landing: "google → /home",
    ip: "31.175.22.11", device: "iPhone · iOS · Safari", language: "PL",
  };
  const rendered = renderTemplateTelegram(def.telegram, data, { event: "user.registered" });
  show("PUBLISHED TEMPLATE (default body)", rendered.text, rendered.keyboard);
  houseRules("template", rendered.text);
  check("a template renders in the same family as the built-ins",
    rendered.text.startsWith("🎉 <b>NOWA REJESTRACJA</b> · 🇵🇱 PL")
    && rendered.text.includes("<i>Nowy użytkownik w GrovBase</i>"), rendered.text.split("\n")[0]);
  check("a template still gets the real button",
    rendered.keyboard?.inline_keyboard[0]?.[0]?.url?.endsWith("/admin/users") === true);
  const sparse = renderTemplateTelegram(def.telegram, { name: "Jan" }, { event: "user.registered" });
  check("lines whose placeholders are empty are dropped whole",
    !sparse.text.includes("📧") && !sparse.text.includes("📱") && sparse.text.includes("👤  <b>Jan</b>"),
    sparse.text);
  const evil = renderTemplateTelegram(
    { icon: "🎉", title: "<b>x</b>", body: "👤 | {{name}}", footer: "<i>f</i>" },
    { name: "<img src=x onerror=1>" },
  );
  check("template output is escaped exactly like the built-ins",
    evil.text.includes("&lt;img") && !evil.text.includes("<img"), evil.text);
}

/* ── G. the transport contract ──────────────────────────────────────────────
 * The one thing left between a rendered card and a delivered message is the
 * request itself. The Bot API is unreachable from CI, so `fetch` is stubbed
 * and the REQUEST is asserted: the right endpoint, the right parse mode, the
 * keyboard attached, and — the part that matters most — exactly one retry,
 * with the plain rendering, when Telegram refuses to parse an entity. */

// Wrapped in an async IIFE: the bundle is CommonJS, where top-level await is
// not available, and this section has to await the stubbed transport.
void (async () => {
  console.log("\nG. TRANSPORT — the request Telegram would receive");
  type Call = { url: string; body: Record<string, unknown> };
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  const stub = (replies: { ok: boolean; description?: string }[]) => {
    let i = 0;
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
      const reply = replies[Math.min(i++, replies.length - 1)]!;
      return {
        ok: reply.ok,
        status: reply.ok ? 200 : 400,
        json: async () => (reply.ok ? { ok: true, result: {} } : { ok: false, description: reply.description }),
      };
    }) as unknown as typeof globalThis.fetch;
  };

  stub([{ ok: true }]);
  calls.length = 0;
  setRichEntitiesEnabled(true);
  const card = renderTelegramCard({
    type: "user.registered", title: "NOWA REJESTRACJA", icon: "🎉",
    data: { name: "Jan", email: "jan@example.com", user_id: "u-9" },
  }, { event: "user.registered" });
  const sent = await sendTelegramMessage("123:TOKEN", "-100777", card.text, {
    keyboard: card.keyboard, plainHtml: card.plain,
  });
  check("a good send is ONE request", sent.ok === true && calls.length === 1, String(calls.length));
  check("…to sendMessage, with the bot token in the path only",
    calls[0]!.url.endsWith("/bot123:TOKEN/sendMessage"), calls[0]!.url);
  check("…as HTML, without link previews",
    calls[0]!.body.parse_mode === "HTML" && calls[0]!.body.disable_web_page_preview === true);
  check("…carrying the chat id and the rendered card",
    calls[0]!.body.chat_id === "-100777" && String(calls[0]!.body.text).includes("👤  <b>Jan</b>"));
  check("…and the inline keyboard as reply_markup",
    JSON.stringify(calls[0]!.body.reply_markup).includes("/admin/users/u-9"),
    JSON.stringify(calls[0]!.body.reply_markup));
  check("no secret is ever put in the BODY", !JSON.stringify(calls[0]!.body).includes("123:TOKEN"));

  // An older Bot API that cannot parse the folded block.
  calls.length = 0;
  setRichEntitiesEnabled(true);
  stub([{ ok: false, description: "Bad Request: can't parse entities: Unsupported start tag \"blockquote\"" }, { ok: true }]);
  const err = renderTelegramCard({
    type: "system.error", title: "BŁĄD", icon: "⚠️",
    data: { provider: "openai" }, details: "trace line",
  }, { event: "system.error" });
  const degraded = await sendTelegramMessage("123:TOKEN", "-100777", err.text, { plainHtml: err.plain });
  check("a parse failure retries EXACTLY once, with the plain rendering",
    degraded.ok === true && degraded.degraded === true && calls.length === 2, String(calls.length));
  check("…and the retry is the <pre> variant, not the blockquote",
    String(calls[1]!.body.text).includes("<pre>") && !String(calls[1]!.body.text).includes("<blockquote"));
  check("…after which the process stops trying the rich entity", richEntitiesEnabled() === false);

  // Any other failure is the outbox's business, not a resend loop's.
  calls.length = 0;
  stub([{ ok: false, description: "Bad Request: chat not found" }]);
  const dead = await sendTelegramMessage("123:TOKEN", "-100777", "x", { plainHtml: "y" });
  check("a non-parse failure is NOT retried — no duplicate messages",
    dead.ok === false && dead.error === "chat_not_found" && calls.length === 1, String(calls.length));

  calls.length = 0;
  const unconfigured = await sendTelegramMessage("", "", "x");
  check("no token or chat means no request at all",
    unconfigured.ok === false && unconfigured.error === "not_configured" && calls.length === 0);

  globalThis.fetch = realFetch;
  setRichEntitiesEnabled(true);

  console.log(failures === 0 ? "\nAll Telegram notification tests passed.\n" : `\n${failures} Telegram test(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
