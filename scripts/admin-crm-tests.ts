/**
 * ADMIN COMMAND CENTRE + CRM — the invariants.
 *
 * These are the rules that are easy to break by accident and expensive to
 * break in front of a customer: a percentage invented out of zero, a "wczoraj"
 * that is really nine hours, a filter value from the URL reaching SQL
 * unchecked, and a bulk action that could include the operator's own account.
 */
import { deltaAgainst } from "@/lib/services/admin-dashboard";
import { relativeParts, relativeKey, relativeTime } from "@/lib/relative-time";
import { readCustomers, CUSTOMER_SORTS } from "@/lib/services/admin-crm";
import { renderEmailTemplate } from "@/lib/server/email-template";
import { readFileSync } from "node:fs";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`  ok   ${name}`); return; }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}
const read = (p: string) => readFileSync(p, "utf8");

console.log("A. a comparison is a comparison, or it is nothing (§15)");
{
  check("growth out of zero has no percentage", deltaAgainst(7, 0) === null);
  check("0 → 0 has no percentage", deltaAgainst(0, 0) === null);
  check("negative previous is refused too", deltaAgainst(5, -3) === null);
  check("unchanged shows nothing", deltaAgainst(9, 9) === null);
  const up = deltaAgainst(150, 100);
  check("+50% up", up?.percent === 50 && up?.direction === "up");
  const down = deltaAgainst(50, 100);
  check("-50% down, magnitude only", down?.percent === 50 && down?.direction === "down");
  check("a rounding-to-zero change is not shown", deltaAgainst(1000, 1002) === null);
}

console.log("B. one relative-time helper, calendar-aware (§35)");
{
  const now = new Date("2026-09-07T08:00:00Z");
  const at = (iso: string) => relativeParts(iso, now);
  check("under a minute is 'teraz'", at("2026-09-07T07:59:30Z").unit === "now");
  check("a future stamp reads as now, never negative", at("2026-09-07T09:00:00Z").unit === "now");
  const m = at("2026-09-07T07:35:00Z");
  check("25 minutes", m.unit === "minutes" && m.value === 25);
  const h = at("2026-09-07T02:00:00Z");
  check("6 hours", h.unit === "hours" && h.value === 6);
  // Inside the first day the hour count wins — it is more precise. Past it,
  // calendar days decide, so 26 hours is "wczoraj" rather than "1 dzień".
  check("9 hours ago stays an hour count", at("2026-09-06T23:00:00Z").unit === "hours");
  check("26 hours ago is 'wczoraj'", at("2026-09-06T06:00:00Z").unit === "yesterday");
  const d = at("2026-09-04T10:00:00Z");
  check("3 days", d.unit === "days" && d.value === 3);
  check("past a week falls back to a date", at("2026-07-01T10:00:00Z").unit === "date");
  check("keys carry their interpolation", relativeKey(m).key === "time.minutes" && relativeKey(m).values.n === 25);
  const t = (key: string, v?: Record<string, string | number>) => `${key}:${v?.n ?? ""}`;
  check("a date renders absolute, not a key",
    relativeTime("2026-07-01T10:00:00Z", t, () => "01.07.2026", now) === "01.07.2026");
  check("every unit has a dictionary entry", ["now", "minutes", "hours", "yesterday", "days", "date"]
    .every((u) => JSON.parse(read("lib/i18n/dictionaries/pl.json")).time?.[u]));
}

console.log("C. the customer list only sends SQL values it recognises (§26, §27)");
{
  const calls: Record<string, unknown>[] = [];
  const fake = {
    rpc: (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      return Promise.resolve({ data: [], error: null });
    },
  } as never;

  await readCustomers(fake, {
    search: "  ada  ", role: "superuser", status: "deleted", verified: "maybe",
    sort: "spent; drop table profiles" as never, page: 3, perPage: 25,
  });
  const a = calls[0];
  check("search is trimmed", a.p_search === "ada");
  check("an unknown role is dropped, not forwarded", a.p_role === null);
  check("an unknown status is dropped", a.p_status === null);
  check("an unknown verification value is dropped", a.p_verified === null);
  check("an unknown sort falls back to 'newest'", a.p_sort === "newest");
  check("paging is computed from page/perPage", a.p_limit === 25 && a.p_offset === 50);

  await readCustomers(fake, { registered: 7, sort: "credits", perPage: 9999 });
  const b = calls[1];
  check("a registration window becomes a timestamp", typeof b.p_since === "string");
  check("a known sort passes through", b.p_sort === "credits");
  check("perPage is capped", b.p_limit === 200);

  await readCustomers(fake, { registered: 365 });
  check("an unoffered window is ignored rather than guessed", calls[2].p_since === null);

  check("every offered sort is one the function knows",
    CUSTOMER_SORTS.every((s) => read("supabase/migrations/0069_admin_customer_rows.sql").includes(`'${s}'`)));
}

console.log("D. the CRM never handles a password, and never bulk-deletes (§32, §33, §34)");
{
  const actions = read("app/actions/admin-crm.ts");
  const menu = read("components/admin/customer-actions.tsx");
  const table = read("components/admin/customer-table.tsx");

  check("no action accepts or sets a password",
    !/password:\s*/.test(actions) && !actions.includes("updateUser("));
  check("reset goes through the customer's own inbox", actions.includes("resetPasswordForEmail"));
  check("no password input anywhere in the CRM UI",
    !/type="password"/.test(menu) && !/type="password"/.test(table));

  check("delete is the soft, ledger-preserving RPC", actions.includes("admin_soft_delete_user"));
  check("no cascade delete of a customer's rows",
    !/from\("payments"\)[\s\S]{0,80}\.delete\(/.test(actions) &&
    !/from\("profiles"\)[\s\S]{0,80}\.delete\(/.test(actions));
  check("the typed confirmation is checked on the server too",
    read("supabase/migrations/0068_admin_user_facts.sql").includes("confirmation_mismatch"));

  check("bulk offers only the reversible pair", actions.includes("bulkSetBlockedAction")
    && !/bulkDelete/i.test(actions) && !/bulkDelete/i.test(table));
  check("a bulk call drops the operator's own id", actions.includes("id !== adminId"));
  check("a bulk call is bounded", actions.includes("ids.length > 100"));
  check("every action re-checks admin server-side",
    (actions.match(/requireAdmin\(\)/g) ?? []).length >= 5);
}

console.log("E. one outbound channel, and it is the one that exists (§30)");
{
  const actions = read("app/actions/admin-crm.ts");
  check("messages go out on the GrovBase mailbox", actions.includes("sendAuthMail"));
  // Mentioning SMS in a comment is fine; calling one is not.
  check("no invented SMS/WhatsApp transport",
    !/\b(sendSms|twilio|messagebird|whatsapp\.|graph\.facebook)/i.test(actions));
  check("one transport, one call site", (actions.match(/sendAuthMail\(/g) ?? []).length === 1);

  const mail = renderEmailTemplate({
    title: "Cześć", paragraphs: ["Pierwszy akapit.", "Drugi <b>akapit</b>."], footer: "GrovBase",
  });
  check("paragraphs survive as paragraphs", (mail.html.match(/Pierwszy akapit\./g) ?? []).length === 1
    && mail.html.includes("Drugi"));
  check("a hostile body cannot inject markup", !mail.html.includes("<b>akapit</b>")
    && mail.html.includes("&lt;b&gt;akapit&lt;/b&gt;"));
  check("the text part carries both paragraphs",
    mail.text.includes("Pierwszy akapit.") && mail.text.includes("Drugi <b>akapit</b>."));
}

console.log("F. the dashboard is a business screen (§13, §21)");
{
  const page = read("app/admin/page.tsx");
  check("no integration health cards on the dashboard",
    !page.includes("HealthGrid") && !page.includes("readSystemHealth"));
  check("the diagnostics still exist where they belong",
    read("app/admin/system/page.tsx").includes("HealthGrid"));
  check("one revenue chart, not five", (page.match(/RevenueChart/g) ?? []).length === 2);
  check("the chart range is 7/30/90", page.includes("RANGES = [7, 30, 90]"));
  check("recent lists cap at ten",
    read("lib/services/admin-dashboard.ts").includes(".slice(0, 10)"));
  // Every row rendered comes from the query; there is no literal list of
  // invented payments or users anywhere in the file.
  check("the payments empty state has real copy and no fabricated rows",
    page.includes("noPaymentsTitle")
    && !/amountCents:\s*\d/.test(page)
    && page.includes("data.recentPayments.map"));
  check("quick actions stay compact", (page.match(/<QuickAction /g) ?? []).length <= 5);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
