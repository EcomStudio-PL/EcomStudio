/**
 * THE SIX CHECKS, ASSERTED AGAINST THE ARTIFACT PRODUCTION ACTUALLY SERVES.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE OTHER TWO.
 *
 *   scripts/analytics-tests.ts        the rules, driven directly
 *   scripts/analytics-browser-probe   the wiring, in a real Chromium
 *   this file                         the SHIPPED BUNDLE, read as text
 *
 * The container this runs in cannot reach grovbase.com or googletagmanager.com
 * (both refused at the egress proxy — measured, HTTP 000), so a browser cannot
 * be pointed at the live site from here. What CAN be done is read the minified
 * module the live site serves and assert the six properties on it directly,
 * which is a stronger claim than a local rebuild: it is the artifact, not a
 * reproduction of it.
 *
 * Point it at the file with the deployed chunk's text:
 *   node scripts/ga-production-check.mjs <path-to-chunk.js>
 */
import { readFileSync } from "fs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/ga-production-check.mjs <chunk.js>"); process.exit(2); }
const src = readFileSync(file, "utf8");

let failures = 0;
function check(n, cond, evidence) {
  if (cond) console.log(`  ✓ ${n}${evidence ? `\n      ${evidence}` : ""}`);
  else { failures++; console.error(`  ✗ ${n}${evidence ? `\n      ${evidence}` : ""}`); }
}
/** Assert a literal is present and show it, so the reader sees the evidence
 *  rather than trusting the boolean. */
function has(n, needle) {
  check(n, src.includes(needle), `found: ${needle}`);
}

console.log("Reading:", file, `(${src.length} bytes)\n`);

console.log("1. THE MEASUREMENT ID APPEARS EXACTLY ONCE");
{
  const hits = [...src.matchAll(/G-CW61S1HTSF/g)].length;
  check("defined once, as a single constant", hits === 1 && src.includes('let i="G-CW61S1HTSF"'),
    `occurrences in the module: ${hits}`);
  check("and every use goes through that constant",
    src.includes('src:"https://www.googletagmanager.com/gtag/js?id=".concat(i)'),
    "the script src is built from `i`, not from a second literal");
}

console.log("\n2. gtag.js IS ACTUALLY REQUESTED, AND DOES NOT BLOCK");
{
  has("the tag URL is the official one", 'https://www.googletagmanager.com/gtag/js?id=');
  has("loaded through next/script, after hydration", 'strategy:"afterInteractive"');
  check("nothing asks for beforeInteractive, which would block the render",
    !src.includes("beforeInteractive"));
  check("an unconfigured deployment renders no tag at all",
    /return o\(\)\?/.test(src), "the component short-circuits on gaEnabled()");
}

console.log("\n4. ONE page_view ON FIRST LOAD — NOT TWO");
{
  has("gtag.js is told not to send its own", "send_page_view:!1");
  check("config is guarded, so a remount cannot send a second one",
    src.includes("init(){!u&&o(t)&&(u=!0"), "`u` is the once-flag");
  check("js is queued before config, as Google's snippet does",
    src.indexOf('push(["js"') < src.indexOf('push(["config"'));
  check("the page_view comes from the app's own path",
    src.includes('push(["event","page_view"'));
}

console.log("\n5. ONE page_view PER NAVIGATION, NO DUPLICATES");
{
  check("the effect re-runs on pathname AND query",
    /usePathname\)\(\),t=\(0,r\.useSearchParams\)\(\)/.test(src)
    && /\},\[e,t\]\)/.test(src), "deps are [pathname, searchParams]");
  has("an address must settle before it counts", "l.settleMs)?n:300");
  check("a pending report is cancelled when the address moves again",
    src.includes("null!==x&&d(x)"), "clearTimer on the in-flight handle");
  check("and the same address is never reported twice in a row",
    src.includes("s!==m&&(m=s"), "last-reported comparison");
}

console.log("\n6. NO TOKEN, OTP, CODE OR SESSION IN WHAT IS SENT");
{
  has("the sensitive-name list ships",
    '["token","secret","password","passwd","pwd","otp","code","key","signature","sig","auth","session","jwt","hash","email","credential"]');
  check("a matching parameter is dropped rather than sent",
    src.includes("&&n.append(e,a)"), "only non-sensitive params are re-appended");
  check("THE FRAGMENT IS NEVER INCLUDED — this is the recovery-token case",
    src.includes('.concat(t.origin).concat(t.pathname).concat(a?"?".concat(a):"")')
    && !/concat\(t\.hash\)/.test(src),
    "page_location is origin + pathname + filtered query, and nothing else");
  check("a malformed address degrades instead of throwing",
    src.includes('catch(e){return"/"}'));
  check("campaign parameters are NOT in the block list",
    !/["'](utm_source|utm_medium|utm_campaign|gclid|fbclid)["']/.test(src),
    "attribution survives, which is the point of installing this");
}

console.log(failures === 0
  ? "\nAll production-bundle checks passed."
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
