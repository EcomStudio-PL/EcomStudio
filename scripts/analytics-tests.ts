/**
 * GOOGLE ANALYTICS 4 — ONE CONFIG, ONE EVENT PER VISIT, NO CREDENTIALS.
 *
 * WHAT THIS EXISTS TO CATCH. Three failure modes, none of which is visible in
 * the browser and all of which are visible in GA a week later:
 *
 *   DOUBLE PAGE_VIEW. gtag.js sends its own page_view when it processes
 *   `config`, and an App Router app must also report client-side navigations.
 *   Get that wrong and every session's first page is counted twice — the
 *   numbers still look plausible, which is what makes it expensive.
 *
 *   DOUBLE INITIALISATION. A component that remounts, or React running an
 *   effect twice in development, re-sends `config` and starts a second
 *   measurement context.
 *
 *   CREDENTIALS IN page_location. This application puts real secrets in URLs —
 *   Supabase recovery tokens in the fragment, the OAuth `code` in the query,
 *   per-recipient newsletter tokens. `page_location` is a full URL. Sending
 *   one to Google is handing out a working key, and nothing fails when it
 *   happens.
 *
 * The tracker is driven here exactly as the browser drives it, against a plain
 * array standing in for `window.dataLayer` — no DOM, no network.
 *
 * Run: npm run test:analytics
 */
import { readFileSync } from "fs";
import { createTracker, gaEnabled, sanitizePageLocation, type Tracker } from "../lib/analytics/ga";

/*
  FAKE TIMERS, because a page_view now waits for the address to settle.

  `createTracker` takes its scheduler so the settle rule can be driven a step
  at a time instead of slept through. `run()` fires whatever is pending, which
  is what "the router stopped moving" means.
*/
function fakeClock() {
  let queued: (() => void) | null = null;
  let handle = 0;
  return {
    options: {
      setTimer: (fn: () => void) => { queued = fn; return ++handle; },
      clearTimer: () => { queued = null; },
    },
    /** Let the pending address settle. */
    run() { const fn = queued; queued = null; fn?.(); },
    get pending() { return queued !== null; },
  };
}

/** A tracker whose clock this test controls. */
function tracked(dl: unknown[], id: string): { ga: Tracker; clock: ReturnType<typeof fakeClock> } {
  const clock = fakeClock();
  return { ga: createTracker(dl, id, clock.options), clock };
}

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const read = (p: string) => readFileSync(p, "utf8");
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The `const csp = [...]` literal from next.config.mjs, line comments removed,
 *  joined the way the config joins it. See section E for why it is read this
 *  way rather than with the general comment stripper. */
function cspDirectives(configSrc: string): string {
  const array = configSrc.match(/const csp = \[([\s\S]*?)\]\.join/)?.[1] ?? "";
  return array
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .split("\n").map((l) => l.trim()).join(" ");
}

const ID = "G-CW61S1HTSF";
const events = (dl: unknown[]) => dl.filter((e) => Array.isArray(e) && e[0] === "event");
const configs = (dl: unknown[]) => dl.filter((e) => Array.isArray(e) && e[0] === "config");

async function main() {
  console.log("A. IS IT ON AT ALL");
  {
    check("a real measurement ID enables it", gaEnabled(ID));
    check("an empty one does not", !gaEnabled(""));
    check("whitespace is not an ID", !gaEnabled("   "));
    check("a Universal Analytics property is not a GA4 one", !gaEnabled("UA-12345-1"));
    check("and neither is a container ID", !gaEnabled("GTM-ABCDEF"));

    const dl: unknown[] = [];
    const { ga: off, clock } = tracked(dl, "");
    off.init();
    off.pageView("https://grovbase.com/");
    clock.run();
    check("an unconfigured deployment pushes nothing at all", dl.length === 0,
      JSON.stringify(dl));
    check("and schedules nothing either", !clock.pending);
  }

  console.log("\nB. EXACTLY ONE CONFIG PER DOCUMENT");
  {
    const dl: unknown[] = [];
    const { ga } = tracked(dl, ID);
    ga.init(); ga.init(); ga.init();
    check("three init calls produce one config", configs(dl).length === 1,
      `${configs(dl).length}`);
    check("and it names this property", JSON.stringify(dl).includes(ID));
    check("with send_page_view disabled — the whole duplicate fix",
      JSON.stringify(configs(dl)[0]).includes('"send_page_view":false'),
      JSON.stringify(configs(dl)[0]));
    check("js is sent before config, as Google's snippet does",
      Array.isArray(dl[0]) && (dl[0] as unknown[])[0] === "js");
  }

  console.log("\nC. ONE PAGE_VIEW PER VISIT — NOT TWO, NOT NONE");
  {
    const dl: unknown[] = [];
    const { ga, clock } = tracked(dl, ID);
    ga.init();

    // The first load. `config` sent none, so this is the only one.
    ga.pageView("https://grovbase.com/");
    check("nothing is reported until the address settles", events(dl).length === 0);
    clock.run();
    check("the first load is reported exactly once", events(dl).length === 1);

    // React StrictMode runs the effect twice on mount; a refocus, a theme
    // toggle and a re-render all land here too.
    ga.pageView("https://grovbase.com/"); clock.run();
    check("a repeat of the same address is not a second visit", events(dl).length === 1,
      `${events(dl).length}`);

    ga.pageView("https://grovbase.com/cennik"); clock.run();
    check("a real navigation is", events(dl).length === 2);

    ga.pageView("https://grovbase.com/cennik?plan=pro"); clock.run();
    check("and so is a change of query", events(dl).length === 3);

    ga.pageView("https://grovbase.com/"); clock.run();
    check("coming back counts again", events(dl).length === 4);

    const last = events(dl)[3] as [string, string, Record<string, unknown>];
    check("every event is a page_view", events(dl).every((e) => (e as unknown[])[1] === "page_view"));
    check("carrying the address it is about", last[2].page_location === "https://grovbase.com/");
  }

  console.log("\nC2. A ROUTE THAT REDIRECTS IS STILL ONE VISIT");
  {
    /*
      THE EXACT SEQUENCE THE BROWSER PROBE FOUND, and it was three events for
      one click: clicking "Zacznij za darmo" navigates to /register, which is a
      server redirect() to /?auth=register, which the router commits without a
      document load. The visitor never left the landing page.
    */
    const dl: unknown[] = [];
    const { ga, clock } = tracked(dl, ID);
    ga.init();
    ga.pageView("https://grovbase.com/"); clock.run();
    check("the landing counts once", events(dl).length === 1);

    ga.pageView("https://grovbase.com/register");          // committed, in flight
    ga.pageView("https://grovbase.com/?auth=register");    // where it lands
    clock.run();
    check("a redirect back to the same page adds nothing", events(dl).length === 1,
      JSON.stringify(events(dl).map((e) => (e as [string, string, Record<string, unknown>])[2].page_location)));

    // A redirect that genuinely ends somewhere else is one visit to THAT page.
    ga.pageView("https://grovbase.com/stary-adres");
    ga.pageView("https://grovbase.com/nowy-adres");
    clock.run();
    check("a redirect to a different page counts once", events(dl).length === 2);
    check("and reports the destination, not the waypoint",
      (events(dl)[1] as [string, string, Record<string, unknown>])[2].page_location
        === "https://grovbase.com/nowy-adres");
  }

  console.log("\nD. NOTHING PRIVATE LEAVES THE APPLICATION");
  {
    // The exact shapes this app produces.
    const cases: [string, string, string][] = [
      ["a recovery link's fragment is dropped whole",
        "https://grovbase.com/reset-password#access_token=eyJhbGci&refresh_token=v1.MRq&type=recovery",
        "https://grovbase.com/reset-password"],
      ["an OAuth code never reaches Google",
        "https://grovbase.com/auth/callback?code=4/0AY0e-g7",
        "https://grovbase.com/auth/callback"],
      ["nor a newsletter recipient token",
        "https://grovbase.com/wypisz-sie/abc?token=9f2c",
        "https://grovbase.com/wypisz-sie/abc"],
      ["nor a signed-URL signature",
        "https://grovbase.com/x?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA",
        "https://grovbase.com/x"],
      ["nor an e-mail address",
        "https://grovbase.com/?email=someone%40example.com",
        "https://grovbase.com/"],
      ["nor anything named like a secret",
        "https://grovbase.com/?apikey=k&session=s&otp=123456&password=hunter2",
        "https://grovbase.com/"],
      ["the auth modal's state is not a page either",
        "https://grovbase.com/?auth=login",
        "https://grovbase.com/"],
      // The other half: attribution is the reason to install analytics.
      ["campaign parameters survive, or this was pointless",
        "https://grovbase.com/?utm_source=fb&utm_medium=cpc&utm_campaign=launch",
        "https://grovbase.com/?utm_source=fb&utm_medium=cpc&utm_campaign=launch"],
      ["and so do the ad click IDs",
        "https://grovbase.com/?gclid=abc&fbclid=def",
        "https://grovbase.com/?gclid=abc&fbclid=def"],
      ["an ordinary filter is kept",
        "https://grovbase.com/k/moda?sort=new",
        "https://grovbase.com/k/moda?sort=new"],
    ];
    for (const [name, input, expected] of cases) {
      check(name, sanitizePageLocation(input) === expected, sanitizePageLocation(input));
    }
    check("a malformed href degrades instead of throwing",
      sanitizePageLocation("not a url") === "/");

    // And end to end, through the tracker rather than the helper alone.
    const dl: unknown[] = [];
    const { ga, clock } = tracked(dl, ID);
    ga.init();
    ga.pageView("https://grovbase.com/reset-password#access_token=SECRET");
    clock.run();
    check("no queued command anywhere contains the token",
      !JSON.stringify(dl).includes("SECRET"), JSON.stringify(dl));
  }

  console.log("\nE. ONE INTEGRATION, ONE SCRIPT, ONE ID");
  {
    const component = codeOnly(read("components/analytics/google-analytics.tsx"));
    const module_ = codeOnly(read("lib/analytics/ga.ts"));
    const layout = codeOnly(read("app/layout.tsx"));
    /*
      THE POLICY, NOT THE PROSE AROUND IT — and getting here took two tries.

      Reading next.config.mjs raw, "nothing broader was opened up" failed on
      the word `doubleclick`, which appears only in the comment EXPLAINING why
      that domain is deliberately absent. The same leniency would have let the
      positive checks pass on a comment describing a directive nobody wrote.

      Running it through codeOnly() then failed differently and more
      interestingly: `https://*.supabase.co` contains `/` followed by `/*`, so
      the block-comment stripper treated the rest of the policy as a comment
      and deleted it. (Checked: no .ts or .tsx source this repo's guards read
      contains that sequence, so the other files are unaffected.)

      So the array itself is extracted and only its line comments removed. What
      is tested is the value that ships.
    */
    const config = cspDirectives(read("next.config.mjs"));
    check("the policy itself was found, not the file around it",
      config.includes("default-src") && config.includes("connect-src"),
      "if this is empty every CSP check below is vacuous");

    check("the measurement ID is read in exactly one file",
      /process\.env\.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID/.test(module_)
      && !/process\.env\.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID/.test(component));

    const { execSync } = await import("child_process");
    const grep = (pattern: string) => execSync(
      `grep -rlF '${pattern}' app lib components --include=*.ts --include=*.tsx || true`,
      { encoding: "utf8" },
    ).split("\n").map((l) => l.trim()).filter(Boolean);
    check("the search works — the component is findable", grep("GoogleAnalytics").length > 0);
    check("no measurement ID is hardcoded in the source",
      grep("G-CW61S1HTSF").length === 0, grep("G-CW61S1HTSF").join(", "));
    check("gtag is not sprinkled around the app",
      grep("googletagmanager.com").length === 1,
      grep("googletagmanager.com").join(", "));

    check("exactly one script tag is rendered",
      (component.match(/<Script/g) ?? []).length === 1);
    check("and it does not block the render",
      /strategy="afterInteractive"/.test(component) && !/beforeInteractive/.test(component));
    check("an unconfigured deployment renders no tag at all",
      /if\s*\(!gaEnabled\(\)\)\s*return null/.test(component));
    check("useSearchParams is isolated behind Suspense, so prerendering survives",
      /<Suspense/.test(component) && /useSearchParams/.test(component));
    check("it is mounted once, in the root layout",
      (layout.match(/<GoogleAnalytics/g) ?? []).length === 1);

    // CSP: the tag is fetched and the collector is called cross-origin, and
    // this project ships a real policy that blocks external scripts by default.
    check("CSP allows the tag to load", /script-src[^;]*https:\/\/www\.googletagmanager\.com/.test(config));
    check("CSP allows the collector to be reached",
      /connect-src[^;]*https:\/\/www\.google-analytics\.com/.test(config)
      && /connect-src[^;]*https:\/\/\*\.google-analytics\.com/.test(config));
    check("and nothing broader was opened up while doing it",
      !/script-src[^;]*\*\.google\.com/.test(config)
      && !/doubleclick/.test(config)
      && /default-src 'self'/.test(config),
      "only the two Google hosts GA4 needs, no ads domains");
  }

  console.log(failures === 0
    ? "\nAll analytics tests passed."
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("analytics tests crashed:", e); process.exit(1); });
