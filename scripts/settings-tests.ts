/**
 * ACCOUNT SETTINGS — one tabbed page instead of a "Profil" row and a
 * "Ustawienia" row that opened the same screen.
 *
 *   esbuild scripts/settings-tests.ts … && node .next/settings-tests.cjs
 *
 * Deterministic and offline: no network, no database. BEHAVIOUR, run for real:
 * the tab whitelist, the plan summary the "Subskrypcje" tab renders, the route
 * lists /profile has to be on (middleware, robots, redirects, CMS), and every
 * new label in pl/en/de. SHAPE, read from the source: the dropdown rows, the
 * redirect, which existing component sits in which tab, the save paths, and
 * the client-side tab switch.
 *
 *   SET1 the dropdown has no separate "Profil" row, and no /settings twice
 *   SET2 /profile → /settings?tab=profile (route, redirect, protected, reserved, private)
 *   SET3 every field the old page rendered is still rendered
 *   SET4 saving goes through the same actions and columns (no migration)
 *   SET5 switching tabs is client-side (replaceState, no navigation, no refetch)
 *   SET6 Subskrypcje shows the real GrovBase plan (subscriptions + subscription_plans, FREE fallback)
 *   SET7 Subskrypcje shows the real GrovNews access (grovnews_my_state + the billing card)
 *   SET8 narrow phones: structural checks only — the lead's Playwright probe measures 320–1440px
 *   SET9 light/dark: tokens only — the same probe renders both themes
 *   SET10 trusted devices: own rows only
 */
import fs from "node:fs";
import { isProtectedPath } from "@/lib/supabase/middleware";
import { sourceIsProtected } from "@/lib/server/redirects";
import { RESERVED, slugProblem } from "@/lib/services/cms";
import { RESERVED_SLUGS } from "@/lib/server/cms-page";
import { featureForHref } from "@/lib/features";
import robots from "@/app/robots";
import {
  DEFAULT_SETTINGS_TAB, GROVNEWS_ANCHOR, LIVE_PLAN_STATUSES, SETTINGS_TABS, parseSettingsTab, planSummary, type PlanRow,
} from "@/components/settings/tabs";
import { makeT, lookup } from "@/lib/i18n/t";
import pl from "@/lib/i18n/dictionaries/pl.json";
import en from "@/lib/i18n/dictionaries/en.json";
import de from "@/lib/i18n/dictionaries/de.json";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
}
const section = (s: string) => console.log(`\n${s}`);
const read = (p: string) => fs.readFileSync(p, "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(app)/settings/page.tsx";
const PROFILE = "app/(app)/profile/page.tsx";
const MENU = "components/layout/account-menu.tsx";
const TABS = "components/settings/settings-tabs.tsx";
const FORMS = "components/settings/settings-form.tsx";
const COMPANY = "components/settings/company-forms.tsx";
const PLAN_CARD = "components/settings/plan-card.tsx";
const PASSWORD = "components/settings/password-reset.tsx";
const ACTIONS = "app/actions/settings.ts";
const NEW_UI = [TABS, FORMS, PLAN_CARD, PASSWORD, "components/settings/tabs.ts"];

const page = code(read(PAGE));
const menu = code(read(MENU));
const tabs = code(read(TABS));
const forms = code(read(FORMS));
const actions = code(read(ACTIONS));

/* ── SET1 ─────────────────────────────────────────────────────────────── */
section("SET1. THE DROPDOWN: NO SEPARATE „PROFIL”, ONE ROW PER DESTINATION");
const rows = [...menu.matchAll(/<Item href="([^"]+)"/g)].map((m) => m[1]);
check("SET1a no row is labelled account.profile", !/account\.profile/.test(menu));
check("SET1b the rows are GrovNews, Ustawienia, Plan, Pomoc, Admin — in that order",
  rows.join(",") === "/grovnews,/settings,/plan,/support,/admin", rows.join(","));
check("SET1c no destination appears twice", new Set(rows).size === rows.length, rows.join(","));
check("SET1d Ustawienia keeps its label and icon", /<Item href="\/settings" icon=\{Settings\} label=\{t\("account\.settings"\)\} \/>/.test(menu));
check("SET1e GrovNews and Admin keep their gates",
  /\{grovnews && <Item href="\/grovnews"/.test(menu) && /\{isAdmin && <Item href="\/admin"/.test(menu));
check("SET1f the bottom dock is untouched (profile slot → /settings)",
  /\{\s*key:\s*"profile",\s*href:\s*"\/settings"/.test(read("lib/bottom-nav.ts")));

/* ── SET2 ─────────────────────────────────────────────────────────────── */
section("SET2. /profile → /settings?tab=profile");
check("SET2a the route exists inside the signed-in (app) group", fs.existsSync(PROFILE));
const profile = fs.existsSync(PROFILE) ? code(read(PROFILE)) : "";
check("SET2b it redirects to the profile tab", /redirect\("\/settings\?tab=profile"\)/.test(profile));
check("SET2c …and is not a second screen (no data, no markup)",
  !/createClient|<[A-Za-z]/.test(profile));
check("SET2d the middleware refuses it to a visitor", isProtectedPath("/profile") && isProtectedPath("/settings"));
check("SET2e …segment-wise: a public slug that merely starts with it is not swallowed", !isProtectedPath("/profile-firmy"));
const disallow = robots().rules;
const disallowed = (Array.isArray(disallow) ? disallow : [disallow]).flatMap((r) => [r.disallow ?? []].flat());
check("SET2f robots keeps crawlers out of /profile", disallowed.includes("/profile$") && disallowed.includes("/profile/"),
  disallowed.join(" "));
check("SET2g an admin redirect cannot claim /profile", sourceIsProtected("/profile"));
check("SET2h a CMS page cannot claim the slug (app list, route list)",
  slugProblem("profile") === "reserved" && RESERVED.includes("profile") && RESERVED_SLUGS.has("profile"));
check("SET2i …and the database list is extended by 0127",
  /execute replace\(v_def, '''settings''', '''settings'', ''profile'''\)/.test(read("supabase/migrations/0127_ai_provider_calls.sql")));
check("SET2j /profile is not a feature (no switch can hide it)", featureForHref("/profile") === null);
check("SET2k /settings?tab=profile is a real tab and the default one",
  parseSettingsTab("profile") === "profile" && DEFAULT_SETTINGS_TAB === "profile");

/* ── SET3 ─────────────────────────────────────────────────────────────── */
section("SET3. EVERY OLD FIELD IS STILL RENDERED");
const field = (name: string, ok: boolean) => check(`SET3 ${name}`, ok);
field("full name (ProfileForm → full_name)", /<ProfileForm fullName=\{profile\.full_name \?\? ""\} email=\{profile\.email\} \/>/.test(page)
  && /name="full_name"/.test(forms));
field("e-mail, read-only", /<Input id="email" value=\{email\} disabled readOnly \/>/.test(forms));
field("company / invoice data (BillingProfileForm)", /<BillingProfileForm workspaceId=\{workspace\.id\} billing=\{billing\} \/>/.test(page));
field("branding (BrandingForm)", /<BrandingForm workspaceId=\{workspace\.id\}/.test(page));
field("language", /<Select id="locale"/.test(forms) && /LOCALES\.map/.test(forms));
field("theme — light, dark AND system", /<Select id="theme"/.test(forms)
  && ["light", "dark", "system"].every((m) => forms.includes(`<option value="${m}">{t("settings.themes.${m}")}</option>`)));
field("trusted devices", /<TrustedDevices devices=\{devices\} \/>/.test(page));
field("the GrovNews card, on its anchor", /<Card id="grovnews"/.test(page) && /<GrovNewsBillingCard state=\{grovnews\} onSale=\{grovnewsLive\} \/>/.test(page));
field("the preferences form", /<PreferencesForm \/>/.test(page));
field("the workspace name line", /t\("settings\.workspace"\)\}: \$\{workspace\.name\}/.test(page));
const at = (s: string) => page.indexOf(s);
const panel = (name: string) => page.slice(at(`const ${name} = (`), page.indexOf(");", at(`const ${name} = (`)));
check("SET3m Profil holds the name and the branding",
  /<ProfileForm/.test(panel("profilePanel")) && /<BrandingForm/.test(panel("profilePanel")));
check("SET3n Konto i bezpieczeństwo holds the password reset and the trusted devices",
  /<PasswordReset/.test(panel("accountPanel")) && /<TrustedDevices/.test(panel("accountPanel")));
check("SET3o Subskrypcje holds the plan, GrovNews and the invoice data",
  /<PlanCard/.test(panel("subscriptionsPanel")) && /<GrovNewsBillingCard/.test(panel("subscriptionsPanel"))
  && /<BillingProfileForm/.test(panel("subscriptionsPanel")));
check("SET3p Preferencje holds language and theme", /<PreferencesForm/.test(panel("preferencesPanel")));
check("SET3q no tab is empty: each panel renders at least one Card",
  ["profilePanel", "accountPanel", "subscriptionsPanel", "preferencesPanel"].every((p) => /<Card[\s>]/.test(panel(p))));

/* ── SET4 ─────────────────────────────────────────────────────────────── */
section("SET4. THE SAME SAVE PATHS, THE SAME COLUMNS — NOTHING TO MIGRATE");
check("SET4a the name is saved by saveProfileAction (useActionState)", /useActionState\(saveProfileAction, null\)/.test(forms));
check("SET4b the theme is saved by the same action, theme field only",
  /form\.set\("theme", value\)/.test(forms) && /saveProfileAction\(null, form\)/.test(forms) && !/form\.set\("full_name"/.test(forms));
check("SET4c the language still goes through setLocaleAction", /setLocaleAction\(e\.target\.value\)/.test(forms));
check("SET4d invoice data and branding keep their actions",
  /useActionState\(saveBillingProfileAction, null\)/.test(code(read(COMPANY))) && /saveWorkspaceBrandingAction\(/.test(code(read(COMPANY))));
check("SET4e profiles.full_name and user_preferences.theme, as before",
  /from\("profiles"\)\.update\(\{ full_name: fullName \}\)\.eq\("id", user\.id\)/.test(actions)
  && /from\("user_preferences"\)\.update\(\{ theme \}\)\.eq\("user_id", user\.id\)/.test(actions));
check("SET4f a field that was not sent is not overwritten (name ⟂ theme)",
  /if \(formData\.has\("full_name"\)\)/.test(actions) && /if \(formData\.has\("theme"\)\)/.test(actions));
check("SET4g the theme is one of the three the CHECK constraint accepts",
  /theme !== "light" && theme !== "dark" && theme !== "system"/.test(actions));
check("SET4h billing_profiles upsert and workspaces branding columns unchanged",
  /from\("billing_profiles"\)\.upsert\(row, \{ onConflict: "workspace_id" \}\)/.test(actions)
  && /logo_url: input\.logoUrl \?\? null,\s*brand_color: input\.brandColor \?\? null,/.test(actions));
check("SET4i the password is changed only through the existing e-mailed reset",
  /requestPasswordReset/.test(code(read(PASSWORD))) && !/updatePassword|updateUser/.test(code(read(PASSWORD))));

/* ── SET5 ─────────────────────────────────────────────────────────────── */
section("SET5. SWITCHING TABS IS CLIENT-SIDE");
check("SET5a the switcher is a client component", /^"use client";/.test(read(TABS)));
check("SET5b it writes ?tab= with history.replaceState", /window\.history\.replaceState\(/.test(tabs)
  && /searchParams\.set\("tab", next\)/.test(tabs));
check("SET5c …and never navigates (no router, no Link, no location change)",
  !/useRouter|router\.(push|replace|refresh)|next\/link|<Link|location\.(assign|href\s*=)/.test(tabs));
check("SET5d every panel is rendered by the server once; the strip only hides",
  /panels=\{\{\s*profile: profilePanel,\s*account: accountPanel,\s*subscriptions: subscriptionsPanel,\s*preferences: preferencesPanel,\s*\}\}/.test(page)
  && /hidden=\{key !== tab\}/.test(tabs));
check("SET5e the first tab comes from ?tab=, whitelisted",
  /parseSettingsTab\(\(await searchParams\)\.tab\)/.test(page)
  && SETTINGS_TABS.every((k) => parseSettingsTab(k) === k)
  && parseSettingsTab("admin") === "profile" && parseSettingsTab(undefined) === "profile"
  && parseSettingsTab(["account", "x"]) === "account" && parseSettingsTab("<script>") === "profile");
check("SET5f #grovnews lands on Subskrypcje and scrolls to the card",
  GROVNEWS_ANCHOR === "grovnews" && /setTab\("subscriptions"\)/.test(tabs) && /hashchange/.test(tabs)
  && /getElementById\(GROVNEWS_ANCHOR\)\?\.scrollIntoView/.test(tabs));
check("SET5g an accessible tablist: roles, aria-selected, aria-controls, roving tabindex, arrow keys",
  /role="tablist"/.test(tabs) && /role="tab"/.test(tabs) && /role="tabpanel"/.test(tabs)
  && /aria-selected=\{active\}/.test(tabs) && /aria-controls=/.test(tabs) && /aria-labelledby=/.test(tabs)
  && /tabIndex=\{active \? 0 : -1\}/.test(tabs) && /ArrowRight/.test(tabs) && /ArrowLeft/.test(tabs)
  && /"Home"/.test(tabs) && /"End"/.test(tabs));
check("SET5h a real navigation to another ?tab= is followed (useSearchParams)", /useSearchParams\(\)\.get\("tab"\)/.test(tabs));

/* ── SET6 ─────────────────────────────────────────────────────────────── */
section("SET6. PLAN GROVBASE — THE REAL PLAN");
check("SET6a the page reads the workspace's live subscriptions row and its plan",
  /from\("subscriptions"\)\s*\.select\("status, current_period_end, cancel_at_period_end, stripe_customer_id, provider_subscription_id, subscription_plans\(name, slug\)"\)/.test(page)
  && /\.eq\("workspace_id", workspace\.id\)\.in\("status", \[\.\.\.LIVE_PLAN_STATUSES\]\)/.test(page));
check("SET6b live means active, trialing or past_due (the checkout's own rule)",
  LIVE_PLAN_STATUSES.join(",") === "active,trialing,past_due"
  && /\.in\("status", \["active", "trialing", "past_due"\]\)/.test(read("lib/server/billing.ts")));
const row = (over: Partial<PlanRow>): PlanRow => ({
  status: "active", current_period_end: "2026-10-26T10:00:00Z", cancel_at_period_end: false,
  stripe_customer_id: "cus_1", provider_subscription_id: "sub_1", subscription_plans: { name: "Pro", slug: "pro" }, ...over,
});
const free = planSummary(null, "Free");
check("SET6c no subscription → FREE, nothing to manage, the way forward is /plan",
  free.status === "free" && free.name === "Free" && free.tone === "free" && !free.manageable && free.renewsAt === null);
check("SET6d …named by the free plan's own row, 'Free' when that row is missing",
  planSummary(null, "Darmowy").name === "Darmowy" && planSummary(null, null).name === "Free");
const pro = planSummary(row({}), "Free");
check("SET6e active Pro → name, tone, renewal date, Billing Portal",
  pro.name === "Pro" && pro.tone === "pro" && pro.status === "active" && pro.renewsAt === "2026-10-26T10:00:00Z"
  && pro.endsAt === null && pro.manageable);
const ending = planSummary(row({ cancel_at_period_end: true }), "Free");
check("SET6f cancelled at period end → no renewal, an end date instead", ending.renewsAt === null && ending.endsAt === "2026-10-26T10:00:00Z");
const trial = planSummary(row({ status: "trialing", subscription_plans: { name: "Starter", slug: "starter" } }), "Free");
check("SET6g trialing is its own honest status", trial.status === "trialing" && trial.tone === "starter");
const due = planSummary(row({ status: "past_due", subscription_plans: { name: "Agency", slug: "agency" } }), "Free");
check("SET6h past_due is said, and no renewal date is promised", due.status === "past_due" && due.renewsAt === null && due.tone === "agency");
check("SET6i no period end → no renewal line", planSummary(row({ current_period_end: null }), "Free").renewsAt === null);
check("SET6j a canceled/incomplete row is not a plan", planSummary(row({ status: "canceled" }), "Free").status === "free"
  && planSummary(row({ status: "incomplete" }), "Free").status === "free");
check("SET6k no Stripe ids → not manageable (no portal button)",
  !planSummary(row({ stripe_customer_id: null, provider_subscription_id: null }), "Free").manageable);
const card = code(read(PLAN_CARD));
check("SET6l the card: BillingPortalButton when manageable, else „Zobacz plany” → /plan",
  /plan\.manageable \? \(\s*<BillingPortalButton \/>/.test(card) && /<Link href="\/plan"/.test(card));
check("SET6m renewal only when it exists", /\{plan\.renewsAt && \(/.test(card) && /\{plan\.endsAt && \(/.test(card));

/* ── SET7 ─────────────────────────────────────────────────────────────── */
section("SET7. GROVNEWS — THE REAL ACCESS");
check("SET7a a due launch claim lands before the state is read (grovnews3 L6)",
  page.includes("await ensureLaunchBonus(supabase)") && at("await ensureLaunchBonus(supabase)") < at('rpc("grovnews_my_state")'));
check("SET7b the state is grovnews_my_state, parsed, gated as before",
  /parseGrovNewsState\(gnRaw\)/.test(page)
  && /const showGrovNews = grovnews !== null && \(grovnewsLive \|\| grovnews\.paid !== null\);/.test(page));
const billingCard = code(read("components/grovnews/billing-card.tsx"));
check("SET7c the reused card still buys, cancels/resumes and opens the portal",
  /href="\/checkout\?kind=grovnews"/.test(billingCard) && /setGrovNewsRenewalAction\(cancel\)/.test(billingCard)
  && /<BillingPortalButton \/>/.test(billingCard) && /data-grovnews-billing/.test(billingCard));
const checkout = code(read("app/(app)/checkout/page.tsx"));
check("SET7d the checkout sends a GrovNews refusal back to the card, not to the top of Ustawienia",
  (checkout.match(/"\/settings\?tab=subscriptions#grovnews"/g) ?? []).length === 2 && !/"\/settings"/.test(checkout));

/* ── SET8 / SET9 ──────────────────────────────────────────────────────── */
section("SET8/SET9. PHONES AND THEMES — STRUCTURE HERE, PIXELS IN THE LEAD'S PROBE");
check("SET8a the tab strip scrolls sideways inside a min-w-0 box, never the page",
  /className="thin-scroll min-w-0 overflow-x-auto/.test(tabs) && /min-w-max/.test(tabs) && /whitespace-nowrap/.test(tabs) && /shrink-0/.test(tabs));
check("SET8d on a phone the strip shows it scrolls (visible thin scrollbar) and keeps the open tab in sight without moving the page",
  !/scrollbar-width:none|::-webkit-scrollbar\]:hidden/.test(tabs)
  && /box\.scrollLeft -= s\.left - b\.left/.test(tabs) && /box\.scrollLeft \+= b\.right - s\.right/.test(tabs)
  && !/scrollIntoView\(\{[^}]*inline/.test(tabs));
check("SET8b the page column shrinks (min-w-0 max-w-2xl)", /className="mx-auto min-w-0 max-w-2xl"/.test(page));
const fixed = NEW_UI.filter((f) => /\b(w|min-w)-\[\d+px\]/.test(read(f)));
check("SET8c no fixed pixel widths in the new settings UI", fixed.length === 0, fixed.join(", "));
const raw = NEW_UI.filter((f) => /#[0-9a-fA-F]{3,6}\b|\bbg-white\b|\btext-black\b|\btext-white\b|\bbg-black\b/.test(code(read(f))));
check("SET9a colours come from the theme tokens only (no hex, no white/black)", raw.length === 0, raw.join(", "));

/* ── SET10 ────────────────────────────────────────────────────────────── */
section("SET10. TRUSTED DEVICES — THE VIEWER'S OWN");
check("SET10a the query is filtered to the signed-in user (RLS alone lets an admin read everyone's)",
  /from\("user_trusted_devices"\)\s*\.select\("id, device_hash, device_label, last_seen_at"\)\s*\.eq\("user_id", user\.id\)/.test(page));

/* ── i18n ─────────────────────────────────────────────────────────────── */
section("I18N. EVERY NEW LABEL IN PL, EN AND DE");
const KEYS = [
  "settings.tabs.label", "settings.tabs.profile", "settings.tabs.account", "settings.tabs.subscriptions", "settings.tabs.preferences",
  "settings.password.title", "settings.password.sub", "settings.password.hint",
  "settings.plan.title", "settings.plan.sub", "settings.plan.status.free", "settings.plan.status.active",
  "settings.plan.status.trialing", "settings.plan.status.past_due", "settings.plan.renews", "settings.plan.ends",
  "settings.plan.pastDue", "settings.plan.seePlans", "settings.preferences.title", "settings.preferences.sub",
  "settings.themes.system", "auth.sendReset", "auth.resetGeneric", "company.title", "branding.title", "loginSec.devicesTitle",
  // Still read elsewhere (the theme pill) — the split must not have dropped them.
  "settings.theme.dark", "settings.theme.light",
];
for (const [name, dict] of [["pl", pl], ["en", en], ["de", de]] as const) {
  const missing = KEYS.filter((k) => typeof lookup(dict as Record<string, unknown>, k) !== "string");
  check(`${name}: all ${KEYS.length} keys resolve`, missing.length === 0, missing.join(", "));
}
const tPl = makeT(pl as Record<string, unknown>);
check("pl: the tab names are the ones asked for",
  ["Profil", "Konto i bezpieczeństwo", "Subskrypcje", "Preferencje"].join("|")
  === ["profile", "account", "subscriptions", "preferences"].map((k) => tPl(`settings.tabs.${k}`)).join("|"));
check("pl: the placeholders survive translation", tPl("settings.plan.renews", { date: "1 X" }) === "Odnowienie: 1 X"
  && /\{email\}/.test(String(lookup(en as Record<string, unknown>, "settings.password.hint")))
  && /\{date\}/.test(String(lookup(de as Record<string, unknown>, "settings.plan.ends"))));
const literal = NEW_UI.filter((f) => /[^=]>\s*[A-Za-zÀ-ž]{3,}[^<{}]*<\//.test(code(read(f)).replace(/<option[^>]*>\{[^}]*\}<\/option>/g, "")));
check("no hardcoded user-facing text in the new settings UI", literal.length === 0, literal.join(", "));

console.log(failed ? `\n${failed} settings test(s) failed.` : "\nAll settings tests passed.");
process.exit(failed ? 1 : 0);
