/**
 * GROVNEWS — STAGE 1 GUARDS.
 *
 *   npm run test:grovnews
 *
 * What only a unit test can prove: the domain rules (access window, presets,
 * slugs, the content format), and that the code is SHAPED the way the security
 * model needs — admin checks first, access checked before any post is read,
 * RLS written the way it was tested. The row-level behaviour itself was run
 * against the real database in a rolled-back transaction (see the Stage 1
 * report): no access / active / expired / revoked / scheduled / admin / anon,
 * self-grant, publishing and editing another user's entitlement.
 */
import fs from "node:fs";
import {
  ADMIN_GRANT_SOURCES, effectiveStatus, estimateReadMinutes, extendExpiry, hasActiveEntitlement,
  parseContent, parseSources, parseTags, presetExpiry, slugify, validatePostInput,
} from "@/lib/grovnews";
import { FEATURE_KEYS, featureDescriptor, menuVisible, allDefaults } from "@/lib/features";
import { DOCK_SLOTS } from "@/lib/bottom-nav";
import { isProtectedPath } from "@/lib/supabase/middleware";
import { NAV_REGISTRY } from "@/lib/nav-active";
import { TOOL_CARDS as SEARCH_CARDS } from "@/lib/tool-search";
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

const NOW = new Date("2026-09-25T12:00:00Z");
const DAY = 86400000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

/* ── A ─────────────────────────────────────────────────────────────────────── */
section("A. ENTITLEMENT — who is active, by status AND by time");
{
  const e = (status: string, startOff: number, expOff: number | null) =>
    ({ status, starts_at: iso(startOff), expires_at: expOff === null ? null : iso(expOff) });
  check("ACTIVE, started, 30 days left → active", effectiveStatus(e("ACTIVE", -DAY, 30 * DAY), NOW) === "ACTIVE");
  check("ACTIVE, open-ended (expires_at NULL) → active", effectiveStatus(e("ACTIVE", -DAY, null), NOW) === "ACTIVE");
  check("EXPIRED by time (expires_at passed) → blocked", effectiveStatus(e("ACTIVE", -10 * DAY, -1000), NOW) === "EXPIRED");
  check("expiry exactly now → already expired (the DB uses expires_at > now())", effectiveStatus(e("ACTIVE", -DAY, 0), NOW) === "EXPIRED");
  check("EXPIRED status → blocked even with a future date", effectiveStatus(e("EXPIRED", -DAY, 30 * DAY), NOW) === "EXPIRED");
  check("REVOKED → blocked, even open-ended", effectiveStatus(e("REVOKED", -DAY, null), NOW) === "REVOKED");
  check("starting tomorrow → not yet active", effectiveStatus(e("ACTIVE", DAY, null), NOW) === "SCHEDULED");
  check("any active row among several → access", hasActiveEntitlement([e("REVOKED", -DAY, null), e("ACTIVE", -DAY, DAY)], NOW));
  check("only revoked / expired rows → no access", !hasActiveEntitlement([e("REVOKED", -DAY, null), e("ACTIVE", -9 * DAY, -DAY)], NOW));
  check("presets: 7/30/90/365 days, forever = NULL, custom asks for a date",
    (presetExpiry("7", NOW) as Date).getTime() === NOW.getTime() + 7 * DAY
    && (presetExpiry("365", NOW) as Date).getTime() === NOW.getTime() + 365 * DAY
    && presetExpiry("forever", NOW) === null && presetExpiry("custom", NOW) === "custom");
  check("extending adds to the later of now / expiry, never shortens, keeps open-ended open",
    extendExpiry(iso(10 * DAY), 30, NOW)!.getTime() === NOW.getTime() + 40 * DAY
    && extendExpiry(iso(-5 * DAY), 30, NOW)!.getTime() === NOW.getTime() + 30 * DAY
    && extendExpiry(null, 30, NOW) === null);
  check("an admin can never hand-grant PAID (it is written by a payment)",
    !ADMIN_GRANT_SOURCES.includes("PAID") && ADMIN_GRANT_SOURCES.includes("ADMIN_GRANT"));
}

/* ── B ─────────────────────────────────────────────────────────────────────── */
section("B. POSTS — slugs, read time, sources, the content format, input validation");
{
  check("slugify: Polish letters folded, URL-safe, stable",
    slugify("Allegro: nowe prowizje od 1 października — co się zmienia?") === "allegro-nowe-prowizje-od-1-pazdziernika-co-sie-zmienia"
    && slugify("Żółć & Łódź") === "zolc-lodz");
  check("read time ~200 words a minute, at least 1", estimateReadMinutes("słowo ".repeat(401)) === 3 && estimateReadMinutes("") === 1);
  const src = parseSources("Allegro | https://allegro.pl/x\njavascript:alert(1)\nhttp://insecure.example\nhttps://olx.pl/y");
  check("sources: only https URLs survive, titles kept", src.length === 2 && src[0].title === "Allegro" && src[1].title === null, JSON.stringify(src));
  check("tags: trimmed, lowercased, unique", parseTags(" Allegro, allegro ,  VAT ").join() === "allegro,vat");
  const blocks = parseContent("## Nagłówek\n\nAkapit z **mocnym** i [linkiem](https://a.pl) oraz <script>alert(1)</script>.\n\n- jeden\n- dwa\n\n> cytat\n\n[zły](javascript:alert(1))");
  check("content: headings, paragraphs, lists, quotes", blocks.map((b) => b.kind).join() === "h2,p,list,quote,p", blocks.map((b) => b.kind).join());
  const flat = JSON.stringify(blocks);
  check("content: markup stays TEXT (no HTML is ever produced), only https links become links",
    flat.includes("<script>alert(1)</script>") && !flat.includes('"href":"javascript') && flat.includes('"href":"https://a.pl"'));
  check("validation: title required", !validatePostInput({ title: " " }).ok);
  check("validation: bad slug refused", (validatePostInput({ title: "x", slug: "Zły Slug!" }) as { error?: string }).error === "slug");
  check("validation: cover must be https", (validatePostInput({ title: "x", coverUrl: "http://a.pl/i.jpg" }) as { error?: string }).error === "cover");
  check("validation: category must be a uuid", (validatePostInput({ title: "x", categoryId: "1 or 1=1" }) as { error?: string }).error === "category");
  const ok = validatePostInput({ title: "Tytuł wpisu", content: "a b c", sources: "https://a.pl", tags: "x, y" });
  check("validation: a good post passes with a derived slug and read time",
    ok.ok && ok.value.slug === "tytul-wpisu" && ok.value.readMinutes === 1 && ok.value.sources.length === 1);
}

/* ── C ─────────────────────────────────────────────────────────────────────── */
section("C. MIGRATION 0119 — new tables only, RLS as tested");
{
  const sql = read("supabase/migrations/0119_grovnews.sql");
  const body = sql.replace(/--.*$/gm, "");
  check("RLS on all three tables", ["grovnews_categories", "grovnews_entitlements", "grovnews_posts"]
    .every((tb) => body.includes(`alter table public.${tb} enable row level security`)));
  check("nothing outside GrovNews is altered, dropped or referenced for writing",
    !/alter table public\.(?!grovnews_)/.test(body) && !/drop\s/i.test(body)
    && !/newsletter_|stripe|credit|subscription_plans/.test(body));
  const entPolicies = [...body.matchAll(/create policy (\w+) on public\.grovnews_entitlements\s+for (\w+)[\s\S]*?;/g)];
  const hard = read("supabase/migrations/0120_grovnews_hardening.sql").replace(/--.*$/gm, "");
  check("entitlements: every read and write is admin-only (0120 drops the customer's own-row read — internal notes stay internal)",
    entPolicies.some((m) => m[2] === "all" && /using \(\(select public\.is_admin\(\)\)\) with check \(\(select public\.is_admin\(\)\)\)/.test(m[0]))
    && /drop policy if exists grovnews_entitlements_own_read on public\.grovnews_entitlements;/.test(hard)
    && !/create policy/.test(hard));
  check("a blocked account has no access (0120)", /select not public\.account_blocked\(auth\.uid\(\)\)/.test(hard)
    && /security definer\s+set search_path = public/.test(hard) && /e\.expires_at > now\(\)/.test(hard));
  const postRead = body.match(/create policy grovnews_posts_entitled_read[\s\S]*?;/)?.[0] ?? "";
  check("posts: non-admins read only PUBLISHED, already published, with an active entitlement",
    /status = 'PUBLISHED'/.test(postRead) && /published_at <= now\(\)/.test(postRead)
    && /grovnews_has_access\(\)/.test(postRead) && /for select to authenticated/.test(postRead));
  check("posts: writes are admin-only", /create policy grovnews_posts_admin on public\.grovnews_posts\s+for all to authenticated\s+using \(\(select public\.is_admin\(\)\)\) with check/.test(body));
  check("the access function takes NO user id (no asking about someone else) and anon cannot call it",
    /create function public\.grovnews_has_access\(\)/.test(body) && /revoke all on function public\.grovnews_has_access\(\) from public, anon;/.test(body)
    && /e\.user_id = auth\.uid\(\)/.test(body) && /e\.starts_at <= now\(\)/.test(body) && /e\.expires_at > now\(\)/.test(body));
  check("constraints: unique slugs, one row per (user, source), a valid window, a dated publication",
    /slug\s+text not null unique/.test(body) && /unique \(user_id, source\)/.test(body)
    && /expires_at is null or expires_at > starts_at/.test(body) && /status <> 'PUBLISHED' or published_at is not null/.test(body));
  check("the twelve categories are seeded in one place", (body.match(/\('[a-z-]+',\s+'[^']+',\s+\d+\)/g) ?? []).length === 12);
}

/* ── D ─────────────────────────────────────────────────────────────────────── */
section("D. SERVER — admin first, access before content");
{
  const actions = code(read("app/actions/grovnews.ts"));
  const chunks = actions.split("export async function ").slice(1);
  const late = chunks.filter((c) => {
    const gate = c.indexOf("await requireAdmin()");
    const firstDb = Math.min(...["supabase.from(", "supabase.rpc(", "logAudit("].map((k) => c.indexOf(k)).filter((i) => i >= 0));
    return gate < 0 || gate > firstDb;
  }).map((c) => c.slice(0, c.indexOf("(")));
  check("every server action checks the admin role before touching the database", chunks.length >= 8 && late.length === 0, late.join(", "));
  check("requireAdmin reads the role from profiles, never from input",
    /from\("profiles"\)\.select\("role"\)\.eq\("id", user\.id\)/.test(actions) && /profile\?\.role !== "admin"/.test(actions));
  check("grant accepts only the admin-grantable sources", /ADMIN_GRANT_SOURCES\.includes\(input\.source\)/.test(actions));
  check("changes act on the row's OWN user id (read from the table), not one the browser sends",
    /select\("id, user_id, status, starts_at, expires_at"\)\.eq\("id", id\)/.test(actions) && /row\.user_id/.test(actions));
  check("admin actions on a customer are logged on their behalf", /p_on_behalf_of: userId/.test(actions));

  const feed = code(read("app/(app)/grovnews/page.tsx"));
  const art = code(read("app/(app)/grovnews/[slug]/page.tsx"));
  const beforeFeed = feed.indexOf("if (!access && !admin) return <GrovNewsLocked") < feed.indexOf("listFeed(supabase)");
  const beforeArt = art.indexOf("if (!access && !admin) return <GrovNewsLocked") < art.indexOf("getPublishedArticle(supabase");
  check("/grovnews: no access → locked screen, and the feed is never queried", feed.includes("return <GrovNewsLocked") && beforeFeed);
  check("/grovnews/[slug]: a direct link without access → locked screen, the post is never read", art.includes("return <GrovNewsLocked") && beforeArt);
  check("the feed and the article ask for PUBLISHED only (drafts / archive never reach the reader)",
    (code(read("lib/services/grovnews.ts")).match(/\.eq\("status", "PUBLISHED"\)\.lte\("published_at"/g) ?? []).length === 2);
  check("the module sits behind the switchboard (FeatureGate) and behind sign-in",
    /<FeatureGate feature="grovnews">/.test(read("app/(app)/grovnews/layout.tsx"))
    && isProtectedPath("/grovnews") && isProtectedPath("/grovnews/any-slug") && !isProtectedPath("/grovnewsx"));
  check("drafts are previewed ONLY inside the admin panel", fs.existsSync("app/admin/newsletter/grovnews/wpisy/[id]/podglad/page.tsx")
    && !fs.existsSync("app/(app)/grovnews/preview"));
  check("the newsletter layout's admin door covers every GrovNews admin screen",
    /profile\?\.role !== "admin"\) redirect/.test(read("app/admin/newsletter/layout.tsx")));
}

/* ── E ─────────────────────────────────────────────────────────────────────── */
section("E. NAVIGATION — drawer yes, bottom bar and desktop untouched");
{
  check("a registered, switchable feature: /grovnews in group account",
    (FEATURE_KEYS as readonly string[]).includes("grovnews") && featureDescriptor("grovnews")?.path === "/grovnews"
    && featureDescriptor("grovnews")?.group === "account" && menuVisible(allDefaults(), "/grovnews", false));
  const drawer = read("components/layout/customer-drawer.tsx");
  check("GrovNews appears in the mobile drawer", /<Tile href="\/grovnews"/.test(drawer));
  check("…and lights as the current row on its pages", NAV_REGISTRY.includes("/grovnews"));
  check("bottom navigation unchanged: Start, Biblioteka, Generuj, Narzędzia, Profil",
    DOCK_SLOTS.map((s) => s.key).join() === "home,library,generate,tools,profile" && !DOCK_SLOTS.some((s) => s.href.includes("grovnews")),
    DOCK_SLOTS.map((s) => s.key).join());
  check("desktop navigation unchanged: no GrovNews in the header", !/grovnews/i.test(read("components/layout/mega-topbar.tsx")) && !/grovnews/i.test(read("components/layout/topbar.tsx")));
  check("not in the tool search (GrovNews is not a tool)", !SEARCH_CARDS.some((c) => c.key === "grovnews"));
  check("the newsletter admin nav has a GrovNews tab", /href: "\/admin\/newsletter\/grovnews"/.test(read("components/admin/newsletter/nav.tsx")));
}

/* ── F ─────────────────────────────────────────────────────────────────────── */
section("F. I18N — every GrovNews key in PL, EN and DE (never a raw key)");
{
  const files = ["components/grovnews/reader.tsx", "components/admin/grovnews/nav.tsx", "components/admin/grovnews/post-actions.tsx",
    "components/admin/grovnews/post-editor.tsx", "components/admin/grovnews/categories.tsx", "components/admin/grovnews/subscribers.tsx",
    "app/(app)/grovnews/page.tsx", "app/(app)/grovnews/[slug]/page.tsx", "app/admin/newsletter/grovnews/page.tsx",
    "app/admin/newsletter/grovnews/wpisy/page.tsx", "app/admin/newsletter/grovnews/wpisy/[id]/podglad/page.tsx",
    "components/layout/customer-drawer.tsx", "lib/features.ts"];
  const keys = new Set<string>();
  for (const f of files) for (const m of read(f).matchAll(/"((?:grovnews|grovnewsAdm)\.[A-Za-z0-9_.]+)"/g)) keys.add(m[1]);
  const dyn: Record<string, readonly string[]> = {
    "grovnews.topics": ["allegro", "marketplace", "ai", "law", "logistics"],
    "grovnewsAdm.ent": ["ACTIVE", "SCHEDULED", "EXPIRED", "REVOKED"],
    "grovnewsAdm.nav": ["dashboard", "posts", "categories", "subscribers"],
    "grovnewsAdm.preset": ["7", "30", "90", "365", "forever", "custom"],
    "grovnewsAdm.source": ["ADMIN_GRANT", "LAUNCH_BONUS", "PAID", "PROMO"],
    "grovnewsAdm.status": ["DRAFT", "PUBLISHED", "ARCHIVED"],
  };
  for (const [base, subs] of Object.entries(dyn)) subs.forEach((s) => keys.add(`${base}.${s}`));
  const get = (d: unknown, key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d);
  for (const [name, dict] of [["pl", pl], ["en", en], ["de", de]] as const) {
    const missing = [...keys].filter((k) => typeof get(dict, k) !== "string");
    check(`${name}: all ${keys.size} keys resolve`, missing.length === 0, missing.join(", "));
    const nl = (dict as unknown as { newsletter: Record<string, string> }).newsletter;
    check(`${name}: the newsletter tab label exists`, typeof nl["nav.grovnews"] === "string");
  }
}

console.log(failed ? `\n${failed} GrovNews test(s) failed.` : "\nAll GrovNews tests passed.");
process.exit(failed ? 1 : 0);
