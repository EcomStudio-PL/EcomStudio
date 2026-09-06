/**
 * TASK 11 TESTS — feature availability (registry, href mapping, windows),
 * the login-security seconds defaults, and the auth-sync fingerprint.
 *
 * Pure functions only, bundled like the other suites (server-only stub, no
 * network, no database).
 */
import {
  FEATURE_KEYS, allActive, featureForHref, featureForToolSlug, menuBadge, menuVisible,
  type AvailabilityMap, type FeatureState,
} from "@/lib/features";
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

console.log("\nA. REGISTRY (C11) — the untouchable modules have no key at all");
{
  const forbidden = ["login", "logout", "auth", "security", "settings", "credits", "billing", "plan", "support", "confirm"];
  check("no auth/security/settings/billing key exists",
    forbidden.every((f) => !(FEATURE_KEYS as readonly string[]).includes(f)),
    FEATURE_KEYS.join(","));
  check("the registry carries the real modules",
    ["generator", "prompts", "video", "retouch", "editor", "resize", "compress", "tools", "products", "library", "inspirations"]
      .every((k) => (FEATURE_KEYS as readonly string[]).includes(k)));
}

console.log("\nB. HREF → FEATURE — prefixes, query stripping, no bypass surface");
{
  const cases: [string, string | null][] = [
    ["/generator", "generator"],
    ["/k/moda", "generator"],
    ["/prompts/abc", "prompts"],
    ["/wideo", "video"],
    ["/retusz", "retouch"],
    ["/tools/editor", "editor"],
    ["/tools/editor?tool=shadow", "editor"],
    ["/tools/resize", "resize"],
    ["/tools/compress", "compress"],
    ["/tools/upscale", "tools"],
    ["/tools", "tools"],
    ["/products/123", "products"],
    ["/library?tab=history", "library"],
    ["/history", "library"],
    ["/inspirations", "inspirations"],
    ["/settings", null],
    ["/login", null],
    ["/credits", null],
    ["/auth/security-check", null],
    ["/home", null],
  ];
  for (const [href, expected] of cases) {
    check(`${href} → ${expected ?? "not a feature"}`, featureForHref(href) === expected, String(featureForHref(href)));
  }
  check("a ?admin=true query never changes the mapping",
    featureForHref("/generator?admin=true") === "generator" && featureForHref("/settings?admin=true") === null);
  check("tool slugs map to their own features",
    featureForToolSlug("editor") === "editor" && featureForToolSlug("format") === "resize"
    && featureForToolSlug("compress") === "compress" && featureForToolSlug("upscale") === "tools");
}

console.log("\nC. MENU RULES — hidden for customers, badged for admins");
{
  const disabledState: FeatureState = { status: "DISABLED", hiddenFromMenu: false, customTitle: null, customMessage: null, reopensAt: null };
  const soonState: FeatureState = { status: "COMING_SOON", hiddenFromMenu: false, customTitle: null, customMessage: null, reopensAt: null };
  const hiddenActive: FeatureState = { status: "COMING_SOON", hiddenFromMenu: true, customTitle: null, customMessage: null, reopensAt: null };
  const map: AvailabilityMap = { ...allActive(), generator: disabledState, prompts: soonState, library: hiddenActive };
  check("DISABLED vanishes for a customer", menuVisible(map, "/generator", false) === false);
  check("…but stays visible for an admin", menuVisible(map, "/generator", true) === true);
  check("…with the 'disabled' badge", menuBadge(map, "/generator") === "disabled");
  check("COMING_SOON stays listed with the 'soon' badge",
    menuVisible(map, "/prompts", false) === true && menuBadge(map, "/prompts") === "soon");
  check("hidden_from_menu hides for customers, not for admins",
    menuVisible(map, "/library", false) === false && menuVisible(map, "/library", true) === true);
  check("a non-feature href is always visible", menuVisible(map, "/settings", false) === true);
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

console.log(failures === 0 ? "\nAll feature tests passed.\n" : `\n${failures} feature test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
