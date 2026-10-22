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
 * And, since the pre-launch landing (V2), a fourth:
 *
 *   A FUNNEL EVENT THAT SAYS TOO MUCH. Eight named events now leave the
 *   browser. The list is closed, their parameters are an allowlist of short
 *   scalars, and nothing — no e-mail, no token, no referral code — can ride
 *   along by accident. Section F holds that line, and section E holds the
 *   other one: all of it still goes through the one tracker in the one file.
 *
 * The tracker is driven here exactly as the browser drives it, against a plain
 * array standing in for `window.dataLayer` — no DOM, no network.
 *
 * Run: npm run test:analytics
 */
import { readFileSync, readdirSync, statSync } from "fs";
import {
  EVENT_PARAM_KEYS, PRELAUNCH_EVENTS, createTracker, eventParams, gaEnabled, isPrelaunchEvent,
  sanitizePageLocation, type EventParams, type PrelaunchEvent, type Tracker,
} from "../lib/analytics/ga";

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
function tracked(dl: unknown[], id: string, href: string | null = null): { ga: Tracker; clock: ReturnType<typeof fakeClock> } {
  const clock = fakeClock();
  return { ga: createTracker(dl, id, { ...clock.options, currentHref: () => href }), clock };
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
/** gtag.js runs a queue entry as a command ONLY when it is an `arguments`
 *  object (Google's `function gtag(){dataLayer.push(arguments)}`); an array is
 *  not a command — the production bug this suite now guards. */
const isArgs = (e: unknown) => Object.prototype.toString.call(e) === "[object Arguments]";
const cmd = (e: unknown): unknown[] | null => (isArgs(e) ? Array.from(e as ArrayLike<unknown>) : null);
const events = (dl: unknown[]) => dl.map(cmd).filter((e): e is unknown[] => !!e && e[0] === "event");
const configs = (dl: unknown[]) => dl.map(cmd).filter((e): e is unknown[] => !!e && e[0] === "config");

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
      cmd(dl[0])?.[0] === "js" && cmd(dl[1])?.[0] === "config");
    check("EVERY entry is an `arguments` object (gtag.js ignores arrays as commands) — the GA4 no-data root cause",
      dl.length === 2 && dl.every((e) => isArgs(e) && !Array.isArray(e)), dl.map((e) => Object.prototype.toString.call(e)).join());
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

    /*
      THE FUNNEL GOES THROUGH THE SAME DOOR.

      `trackEvent` is the only way a component sends a funnel event, and it
      reaches the queue through the SAME module-level tracker as the
      page_views. That is what keeps "one config per document" (B) true with
      events in the mix: a second tracker would be a second `config`, and a
      component pushing to dataLayer itself would be a second integration that
      none of the checks above can see.
    */
    check("trackEvent is exported from the one integration file",
      /export function trackEvent\(/.test(component));
    const trackBody = component.match(/export function trackEvent\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    check("…and is a no-op on the server and without a measurement ID, before anything else",
      /^\s*if\s*\(\s*typeof window === "undefined"\s*\|\|\s*!gaEnabled\(\)\s*\)\s*return;/.test(trackBody),
      trackBody.trim());
    check("…then sends through the shared tracker, not one of its own",
      /trackerFor\(\)\.event\(name,\s*params\)/.test(trackBody) && !/createTracker\(/.test(trackBody));
    check("the integration builds exactly one tracker",
      (component.match(/createTracker\(/g) ?? []).length === 1);
    check("and the page_views use that same one",
      /function PageViews\(\)[\s\S]*?trackerFor\(\)/.test(component));

    // Every source file, read as code. A sweep rather than a grep because the
    // two analytics files explain gtag at length in comments, and a comment
    // naming a thing is not a call to it.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = `${dir}/${entry}`;
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    };
    const GA_FILE = "lib/analytics/ga.ts";
    const INTEGRATION = "components/analytics/google-analytics.tsx";
    const sources = ["app", "lib", "components"].flatMap((d) => walk(d))
      .map((file) => ({ file, src: codeOnly(read(file)) }));
    check("the sweep found the application", sources.length > 100, String(sources.length));
    const outside = (re: RegExp) => sources
      .filter((s) => s.file !== GA_FILE && s.file !== INTEGRATION && re.test(s.src))
      .map((s) => s.file);
    check("no gtag() call outside the analytics module", outside(/\bgtag\s*\(/).length === 0,
      outside(/\bgtag\s*\(/).join(", "));
    check("nothing reaches for window.gtag", sources.every((s) => !/window\.gtag\b/.test(s.src)),
      sources.filter((s) => /window\.gtag\b/.test(s.src)).map((s) => s.file).join(", "));
    check("dataLayer is touched by the two analytics files only", outside(/\bdataLayer\b/).length === 0,
      outside(/\bdataLayer\b/).join(", "));
    check("nobody else builds a tracker or a gtag shim",
      outside(/\b(createTracker|makeGtag)\b/).length === 0,
      outside(/\b(createTracker|makeGtag)\b/).join(", "));

    /*
      THE CALL SITES. The landing's islands call trackEvent; every one of them
      must import it from the integration rather than re-implement it, and
      every event named in a literal must be on the list. A call through a
      variable is allowed — an island may wrap trackEvent to stay quiet inside
      the editor's preview frame — because the PrelaunchEvent type already
      holds that line at compile time; those calls are counted, not failed.
      The file count is printed: zero is a legitimate answer while the landing
      is being built, and it says so instead of passing silently.
    */
    const callers = sources.filter((s) => s.file !== INTEGRATION && /\btrackEvent\s*\(/.test(s.src));
    let viaVariable = 0;
    for (const c of callers) {
      check(`${c.file} imports trackEvent from the integration`,
        /import\s*\{[^}]*\btrackEvent\b[^}]*\}\s*from\s*["']@\/components\/analytics\/google-analytics["']/.test(c.src));
      const names = [...c.src.matchAll(/\btrackEvent\(\s*(["'`])([^"'`]*)\1/g)].map((m) => m[2]);
      viaVariable += (c.src.match(/\btrackEvent\s*\(/g) ?? []).length - names.length;
      const unknown = names.filter((n) => !isPrelaunchEvent(n));
      check(`${c.file}: every event it names is on the list`, unknown.length === 0, unknown.join(", "));
    }
    console.log(`  · ${callers.length} file(s) call trackEvent; ${viaVariable} call(s) pass the name through a typed variable`);

    // prelaunch_referral_confirmed is on the list for ONE vocabulary, but it
    // happens on the server — the referred person's confirmation — and is
    // counted in the database. A browser that sent it would be guessing.
    const clientFiles = sources.filter((s) => /^\s*["']use client["']/.test(read(s.file)));
    const claims = clientFiles.filter((s) => s.src.includes("prelaunch_referral_confirmed")).map((s) => s.file);
    check("no client file sends prelaunch_referral_confirmed", claims.length === 0, claims.join(", "));
  }

  console.log("\nF. FUNNEL EVENTS — A CLOSED LIST, AN ALLOWLIST, NOTHING WHEN OFF");
  {
    /** Order-insensitive deep equality for the small plain objects here. */
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a, Object.keys((a ?? {}) as object).sort())
        === JSON.stringify(b, Object.keys((b ?? {}) as object).sort());

    // The design's event map (§7), verbatim. A ninth event, a renamed one or
    // a typo is a deliberate edit HERE, reviewed — not a new stream of data
    // to a third party that nobody decided to send.
    const EXPECTED_EVENTS = [
      "prelaunch_page_view", "prelaunch_before_after_interaction", "prelaunch_form_start",
      "prelaunch_signup_submitted", "prelaunch_email_confirmed", "prelaunch_referral_shared",
      "prelaunch_referral_confirmed", "prelaunch_cta_clicked",
    ];
    check("the event list is exactly the eight the design names",
      JSON.stringify([...PRELAUNCH_EVENTS]) === JSON.stringify(EXPECTED_EVENTS), PRELAUNCH_EVENTS.join(", "));
    check("no event is listed twice", new Set(PRELAUNCH_EVENTS).size === PRELAUNCH_EVENTS.length);
    check("every name is snake_case under prelaunch_, within GA4's 40-character limit",
      PRELAUNCH_EVENTS.every((n) => /^prelaunch_[a-z]+(?:_[a-z]+)*$/.test(n) && n.length <= 40));
    check("isPrelaunchEvent accepts every listed name", PRELAUNCH_EVENTS.every((n) => isPrelaunchEvent(n)));
    const notEvents: unknown[] = [
      "page_view", "prelaunch_unknown", "PRELAUNCH_PAGE_VIEW", "", " prelaunch_page_view",
      undefined, null, 42, ["prelaunch_page_view"], { name: "prelaunch_page_view" },
    ];
    check("…and refuses everything else, including GA's own page_view",
      notEvents.every((n) => !isPrelaunchEvent(n)),
      notEvents.filter((n) => isPrelaunchEvent(n)).map((n) => JSON.stringify(n)).join(", "));

    const EXPECTED_KEYS = ["section", "form_variant", "pair_index", "channel", "method", "cta_id", "traffic_source"];
    check("the parameter allowlist is exactly the seven keys the design names",
      JSON.stringify([...EVENT_PARAM_KEYS]) === JSON.stringify(EXPECTED_KEYS), EVENT_PARAM_KEYS.join(", "));
    // The same vocabulary the page_location sanitiser refuses (section D): no
    // allowed key may even LOOK like it carries a credential or an address.
    check("no allowed key is named like a secret or a person",
      EVENT_PARAM_KEYS.every((k) => !["token", "secret", "code", "key", "hash", "email", "auth", "session", "name", "user"]
        .some((part) => k.includes(part))));

    const full: EventParams = {
      section: "thumbs", form_variant: "hero", pair_index: 3, channel: "allegro",
      method: "copy", cta_id: "gallery_cta", traffic_source: "facebook",
    };
    check("every allowed key with a plain value passes unchanged", same(eventParams(full), full),
      JSON.stringify(eventParams(full)));
    check("no params is an empty object", same(eventParams(undefined), {}));

    // Cast on purpose: these are exactly the shapes the type is there to stop,
    // arriving anyway — from a spread, a stale caller, or an `as`.
    const leaky = {
      email: "jan@example.com", token: "SECRETTOKEN", t: "SECRETTOKEN", ref_code: "ABCD2345",
      referral_code: "ABCD2345", code: "x", answer: "x", user_id: "u", first_name: "Jan",
      page_location: "https://grovbase.com/?token=SECRETTOKEN",
    } as unknown as EventParams;
    check("unknown keys are dropped, whatever they hold", same(eventParams(leaky), {}),
      JSON.stringify(eventParams(leaky)));
    check("an e-mail address in an allowed key is dropped",
      !("traffic_source" in eventParams({ traffic_source: "jan@example.com" })));
    check("so is a URL carrying a token",
      !("traffic_source" in eventParams({ traffic_source: "https://x.pl/?token=abc" })));
    check("and free text with spaces (a name, a sentence)",
      !("section" in eventParams({ section: "Jan Kowalski" })));
    const at64 = "a".repeat(64);
    check("64 characters is the longest value kept", eventParams({ cta_id: at64 }).cta_id === at64);
    check("65 is dropped — not truncated into a different value",
      !("cta_id" in eventParams({ cta_id: "a".repeat(65) })));
    check("an empty string is not a value", !("section" in eventParams({ section: "" })));
    const shapes = { section: {}, method: [], channel: true, cta_id: null } as unknown as EventParams;
    check("objects, arrays, booleans and null are dropped", same(eventParams(shapes), {}),
      JSON.stringify(eventParams(shapes)));
    check("a number is kept as a whole number", eventParams({ pair_index: 2.6 }).pair_index === 3);
    check("NaN and Infinity are not numbers worth sending",
      same(eventParams({ pair_index: Number.NaN, section: Number.POSITIVE_INFINITY }), {}));

    // A property, not an anecdote: whatever arrives, what leaves is a subset
    // of the allowlist holding short plain tokens or whole numbers.
    let seed = 20261019;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const KEY_POOL = [...EXPECTED_KEYS, "email", "token", "ref_code", "page_location", "user", "x"];
    const VALUE_POOL: unknown[] = [
      "ok", "hero", "a@b.pl", "https://grovbase.com/", "x".repeat(80), "", " ", "ż", "drop table",
      7, -1, 3.5, Number.NaN, null, true, {}, [], "A-b_c.9",
    ];
    let bad = 0;
    for (let i = 0; i < 500; i++) {
      const input: Record<string, unknown> = {};
      for (let j = 0; j < 4; j++) input[pick(KEY_POOL)] = pick(VALUE_POOL);
      const out = eventParams(input as EventParams);
      for (const [k, v] of Object.entries(out)) {
        const okKey = (EVENT_PARAM_KEYS as readonly string[]).includes(k);
        const okValue = typeof v === "number" ? Number.isInteger(v) : /^[a-z0-9_.-]{1,64}$/i.test(v);
        if (!okKey || !okValue) bad++;
      }
    }
    check("500 random inputs: only allowlisted keys with short plain values ever leave", bad === 0,
      `${bad} bad entr${bad === 1 ? "y" : "ies"}`);

    {
      const dl: unknown[] = [];
      const { ga, clock } = tracked(dl, "");
      ga.event("prelaunch_page_view", { traffic_source: "facebook" });
      check("no measurement ID: an event pushes nothing at all", dl.length === 0, JSON.stringify(dl));
      check("…and schedules nothing", !clock.pending);
    }
    {
      const dl: unknown[] = [];
      const { ga } = tracked(dl, ID);
      ga.event("not_on_the_list" as PrelaunchEvent);
      check("an unlisted name sends nothing — and does not even initialise for it", dl.length === 0,
        JSON.stringify(dl));
    }
    {
      // AN EVENT CAN BE THE FIRST THING A DOCUMENT SENDS — a form focused
      // before the page_view settled — so it must bring its own `config`
      // first, or it would reach gtag.js ahead of the property it belongs to.
      const dl: unknown[] = [];
      const { ga, clock } = tracked(dl, ID);
      ga.event("prelaunch_form_start", { form_variant: "hero" });
      check("an event in a fresh document initialises first: js, config, event",
        cmd(dl[0])?.[0] === "js" && cmd(dl[1])?.[0] === "config" && cmd(dl[2])?.[0] === "event",
        dl.map((e) => String(cmd(e)?.[0])).join(", "));
      check("…with send_page_view off, so it does not smuggle in a page_view",
        JSON.stringify(configs(dl)[0]).includes('"send_page_view":false'));
      check("…sent at once, not held back by the page_view settle timer",
        events(dl).length === 1 && !clock.pending);

      ga.event("prelaunch_cta_clicked", { cta_id: "sticky", section: "hero" });
      ga.init();
      ga.pageView("https://grovbase.com/"); clock.run();
      check("events, a late init and a page_view still share one config", configs(dl).length === 1,
        `${configs(dl).length}`);
      check("and the page_view is still reported, once",
        events(dl).filter((e) => e[1] === "page_view").length === 1);
      check("every queued entry is an `arguments` object", dl.every((e) => isArgs(e)));
    }
    {
      const dl: unknown[] = [];
      const { ga } = tracked(dl, ID);
      ga.event("prelaunch_signup_submitted",
        { form_variant: "final", email: "jan@example.com", token: "SECRETTOKEN" } as unknown as EventParams);
      const sent = events(dl)[0] as [string, string, Record<string, unknown>] | undefined;
      check("the event reaches GA as (event, name, allowlisted params)",
        sent?.[1] === "prelaunch_signup_submitted" && same(sent?.[2], { form_variant: "final" }),
        JSON.stringify(sent));
      check("no queued command anywhere holds the address or the token",
        !JSON.stringify(dl).includes("@") && !JSON.stringify(dl).includes("SECRETTOKEN"), JSON.stringify(dl));
      check("without a document there is no address to name", !JSON.stringify(sent).includes("page_location"));

      ga.event("prelaunch_before_after_interaction", { section: "thumbs", pair_index: 0 });
      ga.event("prelaunch_before_after_interaction", { section: "thumbs", pair_index: 0 });
      // "Once per tile" is the CALLER's rule (the gallery island remembers
      // which tiles it reported); the tracker does not guess at intent.
      check("the tracker does not swallow repeats — once-per-tile is the caller's rule",
        events(dl).length === 3);
    }
    {
      // gtag.js fills a missing page_location from document.location — the RAW
      // address. So every event names the sanitised one itself (review S9).
      const dl: unknown[] = [];
      const { ga } = tracked(dl, ID, "https://grovbase.com/?ref_code=ABCD2345&utm_source=fb#t=SECRETTOKEN");
      ga.event("prelaunch_page_view", { traffic_source: "facebook" });
      const sent = events(dl)[0] as [string, string, Record<string, unknown>] | undefined;
      check("an event carries the SANITISED page_location: the referral code and the fragment never reach GA",
        sent?.[2].page_location === "https://grovbase.com/?utm_source=fb"
          && !JSON.stringify(dl).includes("ABCD2345") && !JSON.stringify(dl).includes("SECRETTOKEN"),
        JSON.stringify(sent));
    }
  }

  console.log(failures === 0
    ? "\nAll analytics tests passed."
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("analytics tests crashed:", e); process.exit(1); });
