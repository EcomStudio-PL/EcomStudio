/**
 * THERE IS ONE ANSWER TO "WHICH PAGE IS THE HOMEPAGE", AND ONE PLACE IT COMES
 * FROM.
 *
 * WHAT THIS EXISTS TO CATCH, in the exact shape it happened.
 *
 * On 2026-09-20 the admin panel showed "Strona premiery" as the active
 * homepage and grovbase.com served the ordinary landing. The database half of
 * that story is proven in scripts/homepage-sql-tests.sh — an anonymous read of
 * app_settings raised instead of filtering, so the public route fell through to
 * its "full" default. This file guards the OTHER half, which no policy can fix:
 * the fact was written down twice.
 *
 *   app_settings.homepage.mode  =  "full" | "waitlist"      ← a setting
 *   app/page.tsx                →  'home' | 'premiera'      ← two literals
 *   page-list.tsx               →  slug === 'home' ? mode === 'full' : …
 *
 * Three spellings of one fact, in three files, each able to drift from the
 * others without anything failing. Types have no opinion about that, and
 * neither does a build.
 *
 * So the assertions below are about DATA FLOW and about ABSENCE: the resolver
 * exists and is the only reader; the route and the panel both go through it;
 * and the retired spellings are gone rather than merely unused. Every source
 * check runs against the file with comments stripped — a guard that can be
 * satisfied by prose describing the old system is not a guard, which is the
 * lesson scripts/tile-bytes-tests.ts learned the hard way.
 *
 * Run: npm run test:homepage
 */
import { readFileSync } from "fs";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const read = (p: string) => readFileSync(p, "utf8");

/** Comments are not code. See the header. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")  // JSX comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const RESOLVER = "lib/server/homepage.ts";
const ROUTE = "app/page.tsx";
const ACTIONS = "app/actions/cms.ts";
const LIST = "components/admin/cms/page-list.tsx";
const SETTINGS = "components/admin/site-settings.tsx";
const SERVICE = "lib/services/cms.ts";

async function main() {
  console.log("A. ONE RESOLVER, AND IT READS THE FLAG ON THE PAGE");
  {
    const resolver = codeOnly(read(RESOLVER));
    check("getActiveHomepage exists",
      /export async function getActiveHomepage/.test(resolver));
    check("it reads cms_pages, not a settings row",
      /from\("cms_pages"\)/.test(resolver) && !/app_settings/.test(resolver));
    check("it selects on the is_homepage flag",
      /\.eq\("is_homepage",\s*true\)/.test(resolver));
    check("it reads as a VISITOR would — the anonymous client",
      /createAnonClient\(SUPABASE_URL,\s*SUPABASE_ANON_KEY\)/.test(resolver),
      "reading with the caller's own client is how the admin and the public came to disagree");
    check("and it is invalidated by the same tag every other page read is",
      /tags:\s*\[CMS_TAG\]/.test(resolver));
    check("a page that is not live is not the homepage",
      /isLive\(/.test(resolver));
  }

  console.log("\nB. THE RETIRED SPELLINGS ARE GONE, NOT MERELY UNUSED");
  {
    const { execSync } = await import("child_process");
    /*
      -F, FIXED STRINGS, AND THE REASON IS NOT STYLE.

      The first version of this section passed `getHomepageMode\(supabase` to a
      basic-regex grep, where `\(` opens a group that never closes. grep exited
      with "Unmatched ( or \(" — and the `|| true` turned that into an empty
      result, which reads as "no occurrences found". Two absence assertions were
      passing because the search had crashed. The positive control below exists
      so that can never be silent again.
    */
    const grep = (pattern: string) => execSync(
      `grep -rlF '${pattern}' app lib components --include=*.ts --include=*.tsx || true`,
      { encoding: "utf8" },
    ).split("\n").map((l) => l.trim()).filter(Boolean);

    check("the search itself works — something does call getActiveHomepage",
      grep("getActiveHomepage").length > 0,
      "if this is 0 the grep is broken and every absence check below is vacuous");

    const oldResolver = grep("getHomepageMode(supabase");
    check("no getHomepageMode anywhere", oldResolver.length === 0, oldResolver.join(", "));
    const oldAction = grep("setHomepageModeAction");
    check("no setHomepageModeAction anywhere", oldAction.length === 0, oldAction.join(", "));

    // The settings row may still be READ by something unrelated one day; what
    // must not come back is a second homepage decision made from it.
    const settingsReaders = grep('eq("key", "homepage")');
    check("nothing resolves the homepage from app_settings any more",
      settingsReaders.length === 0,
      settingsReaders.join(", "));
  }

  console.log("\nC. THE PUBLIC ROUTE GOES THROUGH THE RESOLVER AND NOWHERE ELSE");
  {
    const route = codeOnly(read(ROUTE));
    check("/ calls getActiveHomepage", /getActiveHomepage\(\)/.test(route));
    check("and does not name the launch page by slug",
      !/["']premiera["']/.test(route),
      "a hardcoded slug is the second spelling this module was rebuilt to remove");
    check("the launch branch is chosen by kind, not by a mode",
      /kind\s*===\s*"launch"/.test(route));
    check("nothing that is not flagged and live falls through to a blank page",
      /DEFAULT_HOME_BLOCKS/.test(route));

    // THE LAUNCH PAGE IS APPROVED AND MUST RENDER EXACTLY AS IT DID. The route
    // may decide WHETHER to render it; it may not change WHAT it renders with.
    const props = [...route.matchAll(/<LaunchPage([\s\S]*?)\/>/g)]
      .flatMap((m) => [...m[1]!.matchAll(/(\w+)=\{/g)].map((p) => p[1]!));
    const expected = [
      "social", "content", "signedIn", "showAuthEntry", "waitlistFields",
      "loginLabel", "privacyLabel", "termsLabel", "rightsLabel",
    ];
    check("the launch page is handed exactly the props it was handed before",
      props.length === expected.length && expected.every((p) => props.includes(p)),
      `got: ${props.join(", ")}`);
  }

  console.log("\nD. THE PANEL READS THE SAME FLAG, AND CANNOT DISAGREE WITH IT");
  {
    const list = codeOnly(read(LIST));
    const service = codeOnly(read(SERVICE));
    check("the page projection carries the flag",
      /is_homepage/.test(service) && /isHomepage:\s*row\.is_homepage/.test(service));
    check("the badge is rendered straight off the row",
      /page\.isHomepage|p\.isHomepage/.test(list));
    check("the list computes nothing about which page is the homepage",
      !/mode\s*===\s*["'](full|waitlist)["']/.test(list),
      "isHomeSlot() was a second implementation of the resolver, in the browser");
    check("and the mode prop is gone from its interface",
      !/\bmode:\s*string/.test(list));

    const settings = codeOnly(read(SETTINGS));
    check("the settings screen no longer offers a second switch",
      !/setHomepageModeAction/.test(settings) && !/data-home-mode/.test(settings));
    check("it reports the homepage instead of setting it",
      /homepageTitle/.test(settings));
  }

  console.log("\nE. EVERY MUTATION IS ADMIN-ONLY, SERVER-SIDE, AND ATOMIC");
  {
    const actions = codeOnly(read(ACTIONS));

    check("setHomepageAction exists and begins by establishing who is asking",
      /export async function setHomepageAction[\s\S]{0,200}requireAdmin\(\)/.test(actions));
    check("and it does the switch in ONE transaction, through the RPC",
      /rpc\("cms_set_homepage"/.test(actions),
      "two PostgREST calls would leave '/' briefly belonging to nobody");
    check("it never writes is_homepage directly",
      !/update[\s\S]{0,80}is_homepage:\s*true/.test(actions),
      "a direct write cannot clear the previous flag in the same transaction");

    // requireAdmin is the panel's error message, not the lock — RLS is. It
    // still has to be there on every one of these, or a stale session gets an
    // empty result set instead of a sentence.
    for (const fn of [
      "setHomepageAction", "duplicatePageAction", "archivePageAction", "deletePageAction",
      "publishPageAction", "unpublishPageAction", "schedulePageAction", "cancelScheduleAction",
    ]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      check(`${fn} establishes the caller before doing anything`,
        /requireAdmin\(\)/.test(body.slice(0, 400)));
    }

    for (const fn of ["archivePageAction", "unpublishPageAction", "schedulePageAction", "cancelScheduleAction"]) {
      const start = actions.indexOf(`export async function ${fn}`);
      const body = actions.slice(start, start + 900);
      check(`${fn} refuses to take the front door off the air`,
        /isHomepage\(supabase,\s*pageId\)/.test(body));
    }
    const del = actions.slice(actions.indexOf("export async function deletePageAction"));
    check("deletePageAction refuses to delete the homepage",
      /is_homepage/.test(del.slice(0, 900)));
  }

  console.log("\nF. A COPY IS A FAITHFUL COPY, AND NEVER A SECOND FRONT DOOR");
  {
    const actions = codeOnly(read(ACTIONS));
    const start = actions.indexOf("export async function duplicatePageAction");
    const body = actions.slice(start, actions.indexOf("export async function", start + 10));

    // Read back from the source row: anything not selected cannot be copied,
    // which is how header_mode, footer_mode, promo and template were being
    // silently dropped.
    for (const column of ["seo", "header_mode", "footer_mode", "promo", "template"]) {
      check(`the copy carries ${column}`,
        new RegExp(`select\\("[^"]*\\b${column}\\b`).test(body) && new RegExp(`\\b${column}:`).test(body));
    }
    for (const field of ["content", "style", "code", "show_from", "show_until", "audience"]) {
      check(`and every section's ${field}`, new RegExp(`\\b${field}:`).test(body));
    }

    check("the copy is a draft", /status:\s*"draft"/.test(body));
    check("the copy is an ordinary page, never a launch page", /kind:\s*"standard"/.test(body));
    check("the copy is never the homepage", /is_homepage:\s*false/.test(body),
      "the unique index would refuse it anyway — saying so here is what stops someone trying");
    check("the copy takes no menu slot", /nav_group:\s*null/.test(body));
    check("the copy takes no anchor or analytics name",
      /anchor:\s*null/.test(body) && /analytics_id:\s*null/.test(body));
    check("the copy does not inherit the original's version history",
      !/cms_page_versions/.test(body));
    check("its slug is derived and made unique",
      /-kopia/.test(body) && /-kopia-\$\{n\}/.test(body));
  }

  console.log("\nG. NOTHING IMPORTANT IS DECIDED BY A 15px ICON");
  {
    const list = codeOnly(read(LIST));

    // The row this replaced put Historia, Duplikuj, Archiwizuj and Usuń in a
    // strip of h-9 w-9 icon buttons with a 2px gap — 36px targets, four pixels
    // apart, one of which deletes a page. Everything an admin can press is a
    // 44px target now, and everything behind the menu carries a word.
    // Scoped to the two components that draw the controls, so a 6px divider
    // somewhere else in the file is not a failure. `h-1.5` reads as h-1 here,
    // which is the intent: nothing inside these two may be that small.
    const controls = list.slice(list.indexOf("function RowActions"), list.indexOf("function HomeBadge"));
    check("the scope is the control code, not the whole file",
      controls.length > 500 && /MoreHorizontal/.test(controls),
      "if RowActions/RowMenu moved, this check is measuring nothing");
    const heights = [...controls.matchAll(/\bh-(\d+|\[[^\]]+\])/g)].map((m) => m[1]!);
    const small = heights.filter((h) => /^\d+$/.test(h) && Number(h) < 11);
    check("every fixed-height control in the list is at least 44px (h-11)",
      small.length === 0, `found h-${small.join(", h-")}`);
    check("and the menu's own rows have a 44px floor",
      /min-h-\[44px\]/.test(list));

    check("the trigger announces itself to a screen reader",
      /aria-haspopup="menu"/.test(list) && /aria-label=\{label\}/.test(list));
    check("the panel is a menu, not a div full of buttons",
      /role="menu"/.test(list) && /role="menuitem"/.test(list));
    check("Escape closes it and a click outside closes it",
      /"Escape"/.test(list) && /mousedown/.test(list));
    check("every menu entry carries a word, not just a glyph",
      !/label:\s*""/.test(list) && /\{item\.label\}/.test(list));
    check("an unavailable entry says WHY rather than just greying out",
      /item\.hint/.test(list) && /homepageLocked|setHomepageNeedsPublish/.test(list));

    // PRIMARY means spelled out. Edytuj and Podgląd are the two an admin came
    // for; they are links with text, not icons in the overflow menu.
    check("Edytuj and Podgląd stay in the row, in words",
      /common\.edit/.test(list) && /cms\.preview/.test(list));
  }

  console.log(failures === 0
    ? "\nAll homepage tests passed."
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("homepage tests crashed:", e); process.exit(1); });
