/**
 * MESSAGE TEMPLATE TESTS — the placeholder engine, both channel renderers,
 * the catalog's honesty flags, and the auth-template drift guard.
 *
 * Runs like the other suites: bundled with the server-only stub, no network,
 * no database — everything asserted is a pure function of its inputs.
 */
import { readFileSync } from "fs";
import {
  SAMPLE_DATA, TEMPLATE_CATALOG, defaultTemplate, fieldsFromData, listPlaceholders,
  parseStoredDef, renderPlaceholders, renderTemplateEmail, renderTemplateTelegram, shortenValue,
} from "@/lib/server/message-templates";
import { renderEmailTemplate } from "@/lib/server/email-template";
import { AUTH_EMAIL_TEMPLATES } from "@/lib/server/auth-email-templates";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 200)}`}`);
  if (!cond) failures += 1;
}

console.log("\nA. PLACEHOLDER ENGINE — whitelist substitution, nothing executable");
{
  const { text, unknown } = renderPlaceholders("Cześć {{name}} ({{email}})!", { name: "Jan", email: "j@x.pl" });
  check("known placeholders substitute", text === "Cześć Jan (j@x.pl)!", text);
  check("no unknowns reported for known data", unknown.length === 0);
}
{
  const { text, unknown } = renderPlaceholders("A {{nope}} B {{name}}", { name: "Jan" });
  check("an unknown placeholder is removed, never rendered raw", text === "A  B Jan", JSON.stringify(text));
  check("…and reported for the editor's warning", unknown.join(",") === "nope");
}
{
  const hostile = renderPlaceholders("{{constructor}} {{__proto__}} {{toString}}", {});
  check("prototype names are NOT resolved off the object chain",
    hostile.text.trim() === "" && hostile.unknown.length === 3, JSON.stringify(hostile));
}
check("the syntax admits identifiers only — no expressions",
  listPlaceholders("{{a}} {{ b }} {{a.b}} {{a()}} {{1x}}").join(",") === "a,b");
check("shortenValue strips the protocol and caps the length",
  shortenValue("https://www.example.com/a/very/long/path/that/keeps/going/and/going", 30).length <= 30
  && !shortenValue("https://x.pl/a").includes("https://"));

console.log("\nB. TELEGRAM RENDERER — compact lines, dropped empties, escaped values");
{
  const def = defaultTemplate("user.registered:telegram")!;
  if (def.channel !== "telegram") throw new Error("wrong channel");
  const { text } = renderTemplateTelegram(def.telegram, SAMPLE_DATA);
  check("title line is bold with the icon", text.startsWith("🎉 <b>NOWA REJESTRACJA</b>"), text.split("\n")[0]);
  check("one field is one line", text.includes("👤 | Jan Kowalski") && text.includes("📧 | jan@example.com"));
  check("no blank lines anywhere", !text.includes("\n\n"));
  check("technical lines are monospace", text.includes("📍 | <code>203.0.113.7</code>"), text);
  check("rule top and bottom only", (text.match(/━{16}/g) ?? []).length === 2);
  const lines = text.split("\n");
  check("stays inside the 8–12 short line budget", lines.length >= 5 && lines.length <= 13, String(lines.length));
}
{
  const def = defaultTemplate("user.registered:telegram")!;
  if (def.channel !== "telegram") throw new Error("wrong channel");
  const noPhone = { ...SAMPLE_DATA };
  delete (noPhone as Record<string, string>).phone;
  const { text } = renderTemplateTelegram(def.telegram, noPhone);
  check("a line whose placeholders are all empty is dropped whole", !text.includes("📱"), text);
  const { text: hostile } = renderTemplateTelegram(
    { icon: "🎉", title: "T", body: "👤 | {{name}}", footer: "" },
    { name: "<script>alert(1)</script>" },
  );
  check("values are escaped for parse_mode=HTML", hostile.includes("&lt;script&gt;") && !hostile.includes("<script>"), hostile);
}

console.log("\nC. EMAIL RENDERER — the shared card, escaped, with a safe CTA");
{
  const def = defaultTemplate("login.security_code:email")!;
  if (def.channel !== "email") throw new Error("wrong channel");
  const data = { code: "482 193", device: "iPhone · Safari", date: "06.09.2026", time: "04:46" };
  const out = renderTemplateEmail(def.email, data, { badge: "TEST", fields: fieldsFromData(data) });
  check("subject renders", out.subject === "Kod bezpieczeństwa logowania — GrovBase", out.subject);
  check("the field table carries the code", out.html.includes("482 193") && out.text.includes("482 193"));
  check("no Supabase anywhere", !/supabase/i.test(out.html) && !/supabase/i.test(out.text));
}
{
  const evil = renderEmailTemplate({
    title: "T", intro: "I",
    fields: [{ label: "X", value: '<img src=x onerror="alert(1)">' }],
    cta: { label: "Go", url: "javascript:alert(1)" },
  });
  check("a hostile field value is escaped", evil.html.includes("&lt;img") && !evil.html.includes("onerror=\"alert"));
  check("a javascript: CTA never becomes a button", !evil.html.includes("javascript:"));
  const good = renderEmailTemplate({ title: "T", cta: { label: "Go", url: "https://grovbase.com/x" } });
  check("an https CTA does", good.html.includes('href="https://grovbase.com/x"'));
}

console.log("\nD. CATALOG HONESTY — hooks, defaults, stored-row parsing");
{
  const hookless = TEMPLATE_CATALOG.filter((e) => !e.hooked).map((e) => e.key);
  check("payment/subscription/new-device templates are marked hook-missing",
    hookless.includes("payment.received:telegram") && hookless.includes("login.new_device:email")
    && hookless.includes("subscription.cancelled:telegram"), hookless.join(","));
  const wired = TEMPLATE_CATALOG.filter((e) => e.hooked && e.kind === "app");
  check("every wired APP template has a built-in default",
    wired.every((e) => defaultTemplate(e.key) !== null),
    wired.filter((e) => !defaultTemplate(e.key)).map((e) => e.key).join(","));
  check("auth templates are kind=auth and never publishable defaults",
    TEMPLATE_CATALOG.filter((e) => e.kind === "auth").every((e) => defaultTemplate(e.key) === null));
}
{
  const roundtrip = parseStoredDef("telegram", { icon: "🎉", title: "X", body: "👤 | {{name}}", footer: "F" });
  check("a stored telegram row parses back", roundtrip?.channel === "telegram" && roundtrip.telegram.title === "X");
  check("garbage parses to null, never throws",
    parseStoredDef("email", 42) === null && parseStoredDef("email", null) === null && parseStoredDef("email", []) === null);
}

console.log("\nE. AUTH TEMPLATES — embedded copy must match the repo files (dashboard paste source)");
{
  for (const [key, file] of [
    ["auth.confirm_signup", "supabase/templates/confirm-signup.html"],
    ["auth.reset_password", "supabase/templates/reset-password.html"],
  ] as const) {
    const disk = readFileSync(file, "utf-8");
    check(`${key} embedded HTML matches ${file}`, AUTH_EMAIL_TEMPLATES[key]!.html === disk);
  }
  const confirm = AUTH_EMAIL_TEMPLATES["auth.confirm_signup"]!.html;
  check("confirm links grovbase.com/auth/confirm with the TokenHash",
    confirm.includes("https://grovbase.com/auth/confirm?token_hash={{ .TokenHash }}&type=email"));
  check("confirm greets by first name when metadata has one",
    confirm.includes("{{ if .Data.first_name }}") && confirm.includes("{{ .Data.first_name }}"));
  check("no user-visible Supabase branding in the auth mails",
    !/powered by|supabase auth/i.test(confirm));
  check("light canvas, benefits box, brand gradient",
    confirm.includes("#F4EFF9") && confirm.includes("generatora zdjęć produktowych") && confirm.includes("#F950E1"));
  const reset = AUTH_EMAIL_TEMPLATES["auth.reset_password"]!.html;
  check("reset links type=recovery", reset.includes("type=recovery") && !reset.includes("type=email"));
}

console.log(failures === 0 ? "\nAll template tests passed.\n" : `\n${failures} template test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
