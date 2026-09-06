/**
 * TASK 11 TESTS — feature availability (registry, href mapping, windows),
 * the login-security seconds defaults, and the auth-sync fingerprint.
 *
 * Pure functions only, bundled like the other suites (server-only stub, no
 * network, no database).
 */
import {
  FEATURE_GROUPS, FEATURE_KEYS, FEATURE_REGISTRY, allDefaults, defaultStatusFor,
  featureForHref, featureForToolSlug, groupHasVisible, menuBadge, menuVisible,
  type AvailabilityMap, type FeatureKey, type FeatureState,
} from "@/lib/features";
import { authModalUrl, parseAuthMode, safeReturnTo } from "@/lib/auth-routes";
import { effectiveState, type FeatureRow } from "@/lib/server/feature-availability";
import { LOGIN_SECURITY_DEFAULTS, renderSecurityCodeEmail, toStoredSettings } from "@/lib/server/login-security";
import {
  AUTH_REDIRECT_ALLOW_LIST, AUTH_SITE_URL, desiredFingerprint,
} from "@/lib/server/supabase-management";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 200)}`}`);
  if (!cond) failures += 1;
}

console.log("\nA. REGISTRY — every real module is covered, the untouchable ones are not");
{
  // The audit list from the navigation itself: if the drawer, the mega-menu or
  // the bottom dock can reach it, the switchboard has to own it.
  const mustHave = [
    "home", "library", "history",
    "image_moda", "image_ecommerce", "image_social", "image_mailing", "image_inne", "image_matching",
    "prompts", "generator",
    "retouch", "editor", "resize", "compress", "tools", "tool_upscale", "tool_expand", "tool_watermark",
    "video", "products", "inspirations", "credits", "support",
  ];
  check(`all ${mustHave.length} real user-facing modules have a key`,
    mustHave.every((k) => (FEATURE_KEYS as readonly string[]).includes(k)),
    mustHave.filter((k) => !(FEATURE_KEYS as readonly string[]).includes(k)).join(","));
  check("the registry has no key the audit list does not name",
    FEATURE_KEYS.every((k) => mustHave.includes(k)),
    FEATURE_KEYS.filter((k) => !mustHave.includes(k)).join(","));
  // C11: what a customer needs to get in, get out, stay safe or exercise a
  // right must have no key at all — a key that does not exist cannot be
  // switched off by accident.
  const forbidden = ["login", "logout", "auth", "security", "settings", "billing", "plan", "confirm", "privacy", "account"];
  check("no auth/security/settings/billing/plan key exists",
    forbidden.every((f) => !(FEATURE_KEYS as readonly string[]).includes(f)),
    FEATURE_KEYS.join(","));
  check("every descriptor declares a group the menu knows",
    FEATURE_REGISTRY.every((f) => (FEATURE_GROUPS as readonly string[]).includes(f.group)));
  check("every key appears exactly once", new Set(FEATURE_KEYS).size === FEATURE_KEYS.length);
  check("every registry path is absolute", FEATURE_REGISTRY.every((f) => f.path.startsWith("/")));
  // §45: a page added tomorrow must not go dark because nobody inserted a row.
  const soon = FEATURE_KEYS.filter((k) => defaultStatusFor(k) !== "ACTIVE");
  check("a new feature defaults to ACTIVE — only the backendless ones do not",
    soon.length === 2 && soon.includes("image_matching") && soon.includes("video"), soon.join(","));
}

console.log("\nB. HREF → FEATURE — prefixes, query stripping, no bypass surface");
{
  const cases: [string, string | null][] = [
    ["/home", "home"],
    ["/dashboard", "home"],
    ["/library?tab=history", "library"],
    ["/history", "history"],
    ["/k/moda", "image_moda"],
    ["/k/moda/lookbook", "image_moda"],
    ["/k/ecommerce", "image_ecommerce"],
    ["/k/social", "image_social"],
    ["/k/mailing", "image_mailing"],
    ["/k/inne", "image_inne"],
    ["/k/matching", "image_matching"],
    ["/prompts/abc", "prompts"],
    ["/generator", "generator"],
    ["/retusz", "retouch"],
    ["/tools/editor", "editor"],
    ["/tools/editor?tool=shadow", "editor"],
    ["/tools/resize", "resize"],
    ["/tools/compress", "compress"],
    ["/tools/upscale", "tool_upscale"],
    ["/tools/expand", "tool_expand"],
    ["/tools/watermark", "tool_watermark"],
    ["/tools", "tools"],
    ["/wideo", "video"],
    ["/products/123", "products"],
    ["/inspirations", "inspirations"],
    ["/credits", "credits"],
    ["/support", "support"],
    // Deliberately NOT features — no key, so no switch.
    ["/settings", null],
    ["/settings/privacy", null],
    ["/plan", null],
    ["/login", null],
    ["/auth/security-check", null],
  ];
  for (const [href, expected] of cases) {
    check(`${href} → ${expected ?? "not a feature"}`, featureForHref(href) === expected, String(featureForHref(href)));
  }
  check("a ?admin=true query never changes the mapping",
    featureForHref("/generator?admin=true") === "generator" && featureForHref("/settings?admin=true") === null);
  check("a #hash never changes the mapping", featureForHref("/tools/resize#a") === "resize");
  check("a longer prefix wins over a shorter one",
    featureForHref("/tools/editor") === "editor" && featureForHref("/toolsxyz") === null);
  check("every registry path resolves back to its own key",
    FEATURE_REGISTRY.every((f) => featureForHref(f.path) === f.key),
    FEATURE_REGISTRY.filter((f) => featureForHref(f.path) !== f.key).map((f) => f.key).join(","));
  check("tool slugs map to their own features",
    featureForToolSlug("editor") === "editor" && featureForToolSlug("format") === "resize"
    && featureForToolSlug("compress") === "compress" && featureForToolSlug("upscale") === "tool_upscale"
    && featureForToolSlug("expand") === "tool_expand" && featureForToolSlug("watermark") === "tool_watermark"
    && featureForToolSlug("shadow") === "editor" && featureForToolSlug("nonsense") === "tools");
}

console.log("\nC. MENU RULES — hidden for customers, badged for admins");
{
  const state = (over: Partial<FeatureState>): FeatureState => ({ ...allDefaults().library, ...over });
  const map: AvailabilityMap = {
    ...allDefaults(),
    generator: state({ status: "DISABLED" }),
    prompts: state({ status: "COMING_SOON" }),
    retouch: state({ status: "MAINTENANCE" }),
    library: state({ status: "ACTIVE", hiddenFromMenu: true }),
  };
  check("DISABLED vanishes for a customer", menuVisible(map, "/generator", false) === false);
  check("…but stays visible for an admin", menuVisible(map, "/generator", true) === true);
  check("…with the 'disabled' badge", menuBadge(map, "/generator") === "disabled");
  check("COMING_SOON stays listed with the 'soon' badge",
    menuVisible(map, "/prompts", false) === true && menuBadge(map, "/prompts") === "soon");
  check("MAINTENANCE stays listed with its own badge",
    menuVisible(map, "/retusz", false) === true && menuBadge(map, "/retusz") === "maintenance");
  check("hidden_from_menu is INDEPENDENT of status — active but hidden",
    map.library.status === "ACTIVE" && menuVisible(map, "/library", false) === false
    && menuVisible(map, "/library", true) === true);
  check("a non-feature href is always visible", menuVisible(map, "/settings", false) === true);
  check("the registry default badges /k/matching and /wideo without hardcoding",
    menuBadge(allDefaults(), "/k/matching") === "soon" && menuBadge(allDefaults(), "/wideo") === "soon");

  // §35: an empty category heading is worse than no heading.
  const cats = ["/k/moda", "/k/ecommerce", "/k/social", "/k/mailing", "/k/inne", "/k/matching"];
  const allImagesOff: AvailabilityMap = { ...allDefaults() };
  for (const k of ["image_moda", "image_ecommerce", "image_social", "image_mailing", "image_inne", "image_matching"] as FeatureKey[]) {
    allImagesOff[k] = state({ status: "DISABLED" });
  }
  check("OBRAZ keeps its heading while one category survives",
    groupHasVisible({ ...allImagesOff, image_moda: allDefaults().image_moda }, cats, false) === true);
  check("OBRAZ drops its heading when every category is off",
    groupHasVisible(allImagesOff, cats, false) === false);
  check("…and the admin still sees the group", groupHasVisible(allImagesOff, cats, true) === true);
}

console.log("\nC2. STATUS MATRIX — the four states, customer vs admin");
{
  const state = (s: FeatureState["status"], hidden = false): FeatureState => ({
    status: s, hiddenFromMenu: hidden, customTitle: null, customMessage: null, reopensAt: null,
  });
  const rows: [FeatureState["status"], boolean, boolean, string | null][] = [
    // status, visible to customer, visible to admin, badge
    ["ACTIVE", true, true, null],
    ["COMING_SOON", true, true, "soon"],
    ["MAINTENANCE", true, true, "maintenance"],
    ["DISABLED", false, true, "disabled"],
  ];
  for (const [status, cust, adm, badge] of rows) {
    const map: AvailabilityMap = { ...allDefaults(), resize: state(status) };
    check(`${status}: customer=${cust}, admin=${adm}, badge=${badge ?? "none"}`,
      menuVisible(map, "/tools/resize", false) === cust
      && menuVisible(map, "/tools/resize", true) === adm
      && menuBadge(map, "/tools/resize") === badge);
  }
  const hidden: AvailabilityMap = { ...allDefaults(), resize: state("ACTIVE", true) };
  check("ACTIVE + hidden: gone from the menu, still reachable by URL (no gate)",
    menuVisible(hidden, "/tools/resize", false) === false && menuBadge(hidden, "/tools/resize") === null);
}

console.log("\nC3. AUTH MODAL ROUTING — one URL contract, open-redirect proof");
{
  check("only the three real modes parse",
    parseAuthMode("login") === "login" && parseAuthMode("register") === "register"
    && parseAuthMode("forgot") === "forgot");
  check("anything else is not a mode",
    parseAuthMode("admin") === null && parseAuthMode("") === null && parseAuthMode(null) === null);
  check("the dialog opens over the landing page",
    authModalUrl("login") === "/?auth=login" && authModalUrl("register") === "/?auth=register");
  check("an internal returnTo rides along",
    authModalUrl("login", { next: "/generator" }) === "/?auth=login&next=%2Fgenerator");
  const attacks = ["https://evil.example", "//evil.example", "http://evil", "\\\\evil", "javascript:alert(1)"];
  check("no absolute / protocol-relative / scheme returnTo survives",
    attacks.every((a) => safeReturnTo(a) === "" && !authModalUrl("login", { next: a }).includes("evil")),
    attacks.filter((a) => safeReturnTo(a) !== "").join(","));
  check("an error code rides along but nothing else does",
    authModalUrl("login", { error: "bad_credentials", role: "admin" })
      === "/?auth=login&error=bad_credentials");
}

console.log("\nD. TIME WINDOW — the restriction is bounded, reopen is honest");
{
  const now = new Date("2026-09-06T12:00:00Z");
  const base: FeatureRow = {
    feature_key: "retouch", status: "MAINTENANCE", hidden_from_menu: false,
    starts_at: null, ends_at: null, auto_reenable: true,
    custom_title: null, custom_message: null, updated_at: now.toISOString(), updated_by: null,
  };
  check("no row → ACTIVE", effectiveState(undefined, now).status === "ACTIVE");
  check("no window → the status applies", effectiveState(base, now).status === "MAINTENANCE");
  check("before starts_at → still ACTIVE",
    effectiveState({ ...base, starts_at: "2026-09-07T00:00:00Z" }, now).status === "ACTIVE");
  check("after ends_at + auto_reenable → ACTIVE again",
    effectiveState({ ...base, ends_at: "2026-09-06T00:00:00Z" }, now).status === "ACTIVE");
  check("after ends_at without auto_reenable → stays restricted",
    effectiveState({ ...base, ends_at: "2026-09-06T00:00:00Z", auto_reenable: false }, now).status === "MAINTENANCE");
  const inWindow = effectiveState({ ...base, ends_at: "2026-09-08T00:00:00Z" }, now);
  check("inside the window reopensAt = ends_at", inWindow.reopensAt === "2026-09-08T00:00:00.000Z", inWindow.reopensAt);
  check("without auto_reenable no reopen date is promised",
    effectiveState({ ...base, ends_at: "2026-09-08T00:00:00Z", auto_reenable: false }, now).reopensAt === null);
}

console.log("\nE. LOGIN SECURITY — Task 11 defaults in seconds");
{
  check("defaults: 120 s TTL, 7 days re-verify, IP check ON, device check ON",
    LOGIN_SECURITY_DEFAULTS.codeTtlSeconds === 120 && LOGIN_SECURITY_DEFAULTS.reverifyDays === 7
    && LOGIN_SECURITY_DEFAULTS.verifyNewIp === true && LOGIN_SECURITY_DEFAULTS.verifyNewDevice === true);
  const stored = toStoredSettings({ ...LOGIN_SECURITY_DEFAULTS, codeTtlSeconds: 5 });
  check("stored shape uses code_ttl_seconds and clamps the floor to 30",
    stored.code_ttl_seconds === "30" && !("code_ttl_minutes" in stored));
  check("stored ceiling is 3600",
    toStoredSettings({ ...LOGIN_SECURITY_DEFAULTS, codeTtlSeconds: 99999 }).code_ttl_seconds === "3600");
  const mail120 = renderSecurityCodeEmail({ code: "482193", deviceLabel: "iPhone • Safari", when: new Date("2026-09-06T12:00:00Z"), ttlSeconds: 120 });
  check("the code mail states the REAL 120 s lifetime (2 min)",
    mail120.text.includes("Kod wygasa za 2 min.") && mail120.html.includes("Kod wygasa za 2 min."));
  const mail90 = renderSecurityCodeEmail({ code: "482193", deviceLabel: "x", when: new Date(), ttlSeconds: 90 });
  check("odd TTLs render in seconds", mail90.text.includes("Kod wygasa za 90 s."));
}

console.log("\nF. AUTH SYNC — fingerprint covers the payload, never the secret");
{
  check("site URL and confirm redirect are grovbase.com",
    AUTH_SITE_URL === "https://grovbase.com" && AUTH_REDIRECT_ALLOW_LIST.includes("https://grovbase.com/auth/confirm"));
  const base = { site_url: "https://grovbase.com", mailer_subjects_confirmation: "X" };
  const smtp = {
    smtp_admin_email: "contact@grovbase.com", smtp_host: "h", smtp_port: "587",
    smtp_user: "u", smtp_sender_name: "GrovBase", smtp_pass: "secret-one",
  };
  const a = desiredFingerprint({ base, smtp });
  const b = desiredFingerprint({ base, smtp: { ...smtp, smtp_pass: "different-secret" } });
  const c = desiredFingerprint({ base: { ...base, mailer_subjects_confirmation: "Y" }, smtp });
  check("changing ONLY the password does not change the fingerprint", a === b);
  check("changing the payload does", a !== c);
  check("no fingerprint ever contains the secret", !a.includes("secret") && a.length === 64);
}

console.log("\nG. §51/§52 MATRIX — the exact scenario the brief asks for, per module");
{
  // Rows straight out of §51. Each is run through the SAME code path the app
  // uses: a stored DB row → effectiveState → menu rules → gate decision.
  const now = new Date("2026-09-06T12:00:00Z");
  const row = (key: string, status: string, hidden = false, extra: Partial<FeatureRow> = {}): FeatureRow => ({
    feature_key: key, status, hidden_from_menu: hidden,
    starts_at: null, ends_at: null, auto_reenable: true,
    custom_title: null, custom_message: null, updated_at: now.toISOString(), updated_by: null, ...extra,
  });
  const scenario: [FeatureKey, string, string, boolean][] = [
    // key, status, href, hidden_from_menu
    ["image_moda", "COMING_SOON", "/k/moda", false],
    ["image_ecommerce", "ACTIVE", "/k/ecommerce", false],
    ["image_social", "ACTIVE", "/k/social", false],
    ["image_mailing", "DISABLED", "/k/mailing", true],
    ["image_inne", "ACTIVE", "/k/inne", false],
    ["image_matching", "COMING_SOON", "/k/matching", false],
    ["prompts", "ACTIVE", "/prompts", false],
    ["generator", "MAINTENANCE", "/generator", false],
    ["retouch", "COMING_SOON", "/retusz", false],
    ["editor", "DISABLED", "/tools/editor", false],
    ["resize", "ACTIVE", "/tools/resize", false],
    ["compress", "ACTIVE", "/tools/compress", false],
    ["video", "COMING_SOON", "/wideo", false],
    ["products", "ACTIVE", "/products", false],
    ["inspirations", "ACTIVE", "/inspirations", false],
  ];
  const map: AvailabilityMap = { ...allDefaults() };
  for (const [key, status, , hidden] of scenario) {
    map[key] = effectiveState(row(key, status, hidden), now);
  }
  const expectedBadge: Record<string, string | null> = {
    ACTIVE: null, COMING_SOON: "soon", MAINTENANCE: "maintenance", DISABLED: "disabled",
  };
  for (const [key, status, href, hidden] of scenario) {
    const custVisible = status !== "DISABLED" && !hidden;
    const ok = map[key].status === status
      && menuVisible(map, href, false) === custVisible
      && menuVisible(map, href, true) === true            // §31 admin bypass
      && menuBadge(map, href) === expectedBadge[status];
    check(`${key} = ${status}${hidden ? " + hidden" : ""} → menu ${custVisible ? "visible" : "hidden"}, badge ${expectedBadge[status] ?? "none"}, admin sees it`,
      ok, `${map[key].status}/${menuVisible(map, href, false)}/${menuBadge(map, href)}`);
  }
  // §42: with Wideo taken down but still listed, the heading stays; hide it
  // from the menu too and the whole VIDEO section must disappear.
  check("VIDEO heading survives a COMING_SOON video",
    groupHasVisible(map, ["/wideo"], false) === true);
  const videoHidden: AvailabilityMap = { ...map, video: effectiveState(row("video", "COMING_SOON", true), now) };
  check("VIDEO heading disappears once video is hidden from the menu",
    groupHasVisible(videoHidden, ["/wideo"], false) === false
    && groupHasVisible(videoHidden, ["/wideo"], true) === true);

  // §53 bulk: the EDYTUJ category set to COMING_SOON, then restored.
  const editKeys: FeatureKey[] = ["retouch", "editor", "resize", "compress", "tools",
    "tool_upscale", "tool_expand", "tool_watermark"];
  const bulkSoon: AvailabilityMap = { ...allDefaults() };
  for (const k of editKeys) bulkSoon[k] = effectiveState(row(k, "COMING_SOON"), now);
  check("bulk: every EDYTUJ child carries the soon badge",
    editKeys.every((k) => bulkSoon[k].status === "COMING_SOON"));
  const bulkBack: AvailabilityMap = { ...allDefaults() };
  for (const k of editKeys) bulkBack[k] = effectiveState(row(k, "ACTIVE"), now);
  check("bulk: restoring ACTIVE clears every badge",
    editKeys.every((k) => bulkBack[k].status === "ACTIVE" && menuBadge(bulkBack, featureDescriptorPath(k)) === null));

  // §33/§35: a maintenance window entered from the Warsaw clock, stored UTC.
  const windowed = effectiveState(
    row("generator", "MAINTENANCE", false, { starts_at: "2026-09-06T18:00:00Z", ends_at: "2026-09-07T00:00:00Z" }),
    now,
  );
  check("before starts_at the module still works (§35)", windowed.status === "ACTIVE");
  const inside = effectiveState(
    row("generator", "MAINTENANCE", false, { starts_at: "2026-09-06T06:00:00Z", ends_at: "2026-09-07T00:00:00Z" }),
    now,
  );
  check("inside the window it is restricted and promises the real return date",
    inside.status === "MAINTENANCE" && inside.reopensAt === "2026-09-07T00:00:00.000Z", inside.reopensAt);
  const after = effectiveState(
    row("generator", "MAINTENANCE", false, { starts_at: "2026-09-05T06:00:00Z", ends_at: "2026-09-06T06:00:00Z" }),
    now,
  );
  check("after ends_at it reopens by itself (§34)", after.status === "ACTIVE");
}

/** The canonical route of a key — used by the bulk assertion above. */
function featureDescriptorPath(key: FeatureKey): string {
  return FEATURE_REGISTRY.find((f) => f.key === key)?.path ?? "/";
}

console.log(failures === 0 ? "\nAll feature tests passed.\n" : `\n${failures} feature test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
