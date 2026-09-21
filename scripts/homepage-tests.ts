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
const BUILDER = "components/admin/cms/builder.tsx";
const LINKS = "lib/cms-links.ts";

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

    /*
      THE FALLBACK MAY NOT OVERRULE THE FLAG.

      `authored.length > 0 ? authored : DEFAULT_HOME_BLOCKS` reads as a safety
      net and is the original bug in a new place: point "/" at "O nas", get the
      built-in landing, and the panel still says "O nas". The defaults are for
      the case where NO page is flagged at all.
    */
    check("a flagged page renders its own content, never the built-in default",
      /\btarget\s*\?\s*authored\s*:\s*DEFAULT_HOME_BLOCKS/.test(route),
      "the choice must be on whether a page is flagged, not on whether it has blocks");
    check("and the old length-based fallback is gone",
      !/authored\.length\s*>\s*0\s*\?/.test(route));

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

    /*
      WHERE "USTAW JAKO STRONĘ GŁÓWNĄ" LIVES — AND WHY THIS ASSERTION FLIPPED.

      An earlier revision of this guard pinned the OPPOSITE: a bordered button
      on the card surface. That was built to the brief of the day and it was
      wrong on the screen — a third control competing with Edytuj and Podgląd
      made every row read like a form. The action moved into the "•••" as its
      FIRST entry.

      Recorded rather than quietly rewritten, because a guard that changes its
      mind without saying so is a guard nobody can trust. What has NOT changed,
      and is asserted below, is the part that actually matters: there is exactly
      one place that can set the homepage, the current one cannot be re-set,
      and a draft is refused with a reason.
    */
    check("the homepage action is in the menu, not on the card surface",
      !/data-set-homepage=/.test(list) && /key:\s*"homepage"/.test(list),
      "no bordered button competing with Edytuj and Podgląd");
    check("and it is the FIRST entry, ahead of Duplikuj",
      list.indexOf('key: "homepage"') < list.indexOf('key: "duplicate"')
      && list.indexOf('key: "homepage"') > 0);
    check("exactly one place can set the homepage",
      (list.match(/setHomepageAction\(page\.id\)/g) ?? []).length === 1);
    check("the current homepage shows «To jest strona główna», disabled",
      /page\.isHomepage[\s\S]{0,200}cms\.isHomepage[\s\S]{0,80}disabled:\s*true/.test(list),
      "re-setting the page that already is the homepage must not look available");
    check("a draft is refused with a reason, not a silent error",
      /hint:\s*live\s*\?\s*undefined\s*:\s*t\("cms\.setHomepageNeedsPublish"\)/.test(list)
      && /disabled:\s*pending\s*\|\|\s*!live/.test(list));

    // The surface itself: two actions and the menu, nothing more.
    const surface = list.slice(list.indexOf("return (\n    <div className=\"flex flex-wrap items-center justify-end"));
    check("the card surface offers exactly Edytuj, Podgląd and the menu",
      /common\.edit/.test(surface) && /cms\.preview/.test(surface) && /<RowMenu/.test(surface)
      && !/cms\.setHomepage/.test(surface));
  }

  console.log("\nD3. THE MENU BEHAVES LIKE A MENU, INCLUDING ON A PHONE");
  {
    const list = codeOnly(read(LIST));
    check("it is measured against the viewport and scrolls when it cannot fit",
      /maxHeight/.test(list) && /overflow-y-auto/.test(list) && /overscroll-contain/.test(list),
      "a fixed, portalled panel cannot be reached by scrolling the page behind it");
    check("it flips to whichever side has room",
      /roomBelow/.test(list) && /roomAbove/.test(list));
    check("its width is clamped to a 320px screen",
      /Math\.min\(MENU_WIDTH,\s*window\.innerWidth/.test(list));
    check("a tap outside closes it, not just a mouse click",
      /touchstart/.test(list) && /mousedown/.test(list));
    check("role=menu is honoured with arrow keys, Home and End",
      /ArrowDown/.test(list) && /ArrowUp/.test(list) && /"Home"/.test(list) && /"End"/.test(list),
      "announcing role=menu and answering only Tab is worse than a plain list");
    check("Escape closes it and returns focus to the trigger",
      /"Escape"/.test(list) && /triggerRef\.current\?\.focus\(\)/.test(list));
  }

  console.log("\nD2. ONE «PODGLĄD», IN THE LIST AND IN THE EDITOR");
  {
    const list = codeOnly(read(LIST));
    const builder = codeOnly(read(BUILDER));

    // The list used to draw "Podgląd" and, next to it, a bare external-link
    // icon opening the live URL — two adjacent controls, one unlabelled.
    check("the list has exactly one control named Podgląd",
      (list.match(/t\("cms\.preview"\)/g) ?? []).length === 1,
      "the live URL belongs in the menu as «Otwórz stronę»");
    check("and the live address comes from the shared helper",
      /publicPathFor\(/.test(list) && !/function publicPath\(/.test(list));
    const links = codeOnly(read(LINKS));
    check("which lives in one place both screens import",
      /export function publicPathFor/.test(links) && /export function pageIsLive/.test(links),
      "the list and the builder each had their own idea of where a page lives, and they differed");

    // The editor had a toolbar link named "Podgląd" sitting above a PANE named
    // "Podgląd" showing the same route in an iframe — and below xl the two were
    // stacked on top of each other.
    check("the editor's toolbar no longer repeats the preview pane",
      !/href=\{previewPath\}/.test(builder),
      "the pane IS the preview; a second link to /podglad is the duplicate");
    check("what it offers instead is named «Otwórz stronę»",
      /data-page-open-public/.test(builder) && /t\("cms\.openPublic"\)/.test(builder));
    check("and it only appears when the page really has an address",
      /publicUrl\s*&&/.test(builder) && /publicPathFor\(page\)/.test(builder));
    check("the preview pane and its fullscreen view are untouched",
      /data-cms-frame/.test(builder) && /data-close-fullscreen/.test(builder));
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
    /*
      A FIELD THE COPY WRITES MUST BE A FIELD THE READ BROUGHT BACK.

      This is the listAssets/metadata bug in another table: the insert names
      `audience: b.audience`, the projection forgets to select it, and the copy
      is written with `undefined` — silently, with types perfectly happy,
      because `b` is typed from a select list that a type checker has no opinion
      about. So the two lists are compared rather than each asserted alone.
    */
    const service = codeOnly(read(SERVICE));
    const blockSelect = service.match(/BLOCK_SELECT\s*=\s*"([^"]+)"/)?.[1] ?? "";
    check("the block projection is findable at all", blockSelect.length > 0,
      "if this is empty every comparison below is vacuous");

    for (const field of ["content", "style", "code", "show_from", "show_until", "audience"]) {
      check(`and every section's ${field}`, new RegExp(`\\b${field}:`).test(body));
      check(`  …which listBlocks actually selects`,
        new RegExp(`\\b${field}\\b`).test(blockSelect),
        `BLOCK_SELECT = "${blockSelect}"`);
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
