/**
 * PHOTOROOM INTEGRATION — the logic tests.
 *
 * What is worth testing here is not "does the HTTP call work" — that needs a
 * key and a live vendor, and a mock of it proves nothing. What IS worth
 * testing is everything that decides WHAT we send and WHAT we charge, because
 * those are the two places a wrong constant ships silently:
 *
 *   · a missing `removeBackground=false` turns an upscale into a cutout;
 *   · a wrong per-call cost quietly sells an operation below its floor;
 *   · a sandbox key charging credits bills a seller for a watermark;
 *   · a free-allowance window that drifts gives away more than was offered.
 *
 * So the request builder is exercised against a stub `fetch` and the fields it
 * produced are read back, and the pricing and window maths are checked
 * directly.
 */
import {
  BACKGROUND_PROVIDERS, EDIT_PROVIDERS, EXPAND_PROVIDERS, UPSCALE_PROVIDERS,
  PHOTOROOM_EDIT_USD, PHOTOROOM_SEGMENT_USD, isSandboxKey,
  type Creds, type ToolBytes,
} from "@/lib/images/providers";
import { TOOLS, toolBySlug, DEFAULT_SETTINGS } from "@/lib/images/tools";
import { creditsForCost, DEFAULT_BILLING, quote } from "@/lib/images/pricing";
import { windowStart, planQualifies, FREE_ELIGIBLE, FREE_TOOL_DEFAULT } from "@/lib/server/free-tools";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${String(extra).slice(0, 300)}`}`);
  if (!cond) failures += 1;
}

/* ── a fetch that records instead of sending ───────────────────────────── */

type Sent = { url: string; headers: Record<string, string>; fields: Record<string, string> };
let lastSent: Sent | null = null;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const body = init?.body;
  const fields: Record<string, string> = {};
  if (body instanceof FormData) {
    for (const [k, v] of body.entries()) if (typeof v === "string") fields[k] = v;
  }
  lastSent = {
    url: String(url),
    headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    fields,
  };
  // One opaque PNG byte is enough: the code only checks the buffer is not empty.
  return new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png", "x-request-id": "req_test" },
  });
}) as typeof fetch;

const IMG: ToolBytes = { bytes: Buffer.from([1, 2, 3]), mime: "image/jpeg" };
const LIVE: Creds = { apiKey: "live_abcdef123456" };
const SANDBOX: Creds = { apiKey: "sandbox_abcdef123456" };

const photoroomOf = <T extends { slug: string }>(list: T[]) => list.find((p) => p.slug === "photoroom");

async function main() {
  console.log("\nA. PHOTOROOM IS REGISTERED FOR EVERY CAPABILITY IT CAN SERVE");
  {
    check("background removal", Boolean(photoroomOf(BACKGROUND_PROVIDERS)));
    check("upscale", Boolean(photoroomOf(UPSCALE_PROVIDERS)));
    check("expand", Boolean(photoroomOf(EXPAND_PROVIDERS)));
    check("the generative edits", Boolean(photoroomOf(EDIT_PROVIDERS)));
    // Cheapest-first is the whole contract of the preference arrays: an operator
    // with two keys must keep paying the cheaper vendor.
    const upscaleIdx = UPSCALE_PROVIDERS.findIndex((p) => p.slug === "photoroom");
    check("it is LAST among upscalers — $0.10 is the dearest option",
      upscaleIdx === UPSCALE_PROVIDERS.length - 1, `index ${upscaleIdx}`);
    const bg = BACKGROUND_PROVIDERS.findIndex((p) => p.slug === "photoroom");
    const falBg = BACKGROUND_PROVIDERS.findIndex((p) => p.slug === "fal");
    check("fal still outranks it for background removal", falBg >= 0 && falBg < bg);
  }

  console.log("\nB. BACKGROUND REMOVAL STAYS ON THE CHEAP ENDPOINT");
  {
    const p = photoroomOf(BACKGROUND_PROVIDERS)!;
    const res = await p.removeBackground(IMG, LIVE);
    check("calls /v1/segment, not /v2/edit", lastSent!.url.includes("/v1/segment"), lastSent!.url);
    check("costs the Basic rate", res.costUsd === PHOTOROOM_SEGMENT_USD, res.costUsd);
    check("the Basic rate is five times cheaper than an edit",
      PHOTOROOM_SEGMENT_USD * 5 === PHOTOROOM_EDIT_USD);
    check("authenticates with x-api-key", lastSent!.headers["x-api-key"] === LIVE.apiKey);
    check("never sends the key in a query string", !lastSent!.url.includes(LIVE.apiKey));
  }

  console.log("\nC. THE WHOLE PHOTO SURVIVES THE EDITS THAT ACT ON THE PHOTO");
  {
    // This is the regression the integration exists to avoid: /v2/edit cuts the
    // subject out by DEFAULT, so anything that means "improve this photograph"
    // has to say so explicitly or it returns a transparent cutout instead.
    const up = photoroomOf(UPSCALE_PROVIDERS)!;
    await up.upscale(IMG, { factor: 2, width: 800, height: 600 }, LIVE);
    check("upscale keeps the background", lastSent!.fields.removeBackground === "false", lastSent!.fields);
    check("upscale frames on the original", lastSent!.fields.referenceBox === "originalImage");
    check("upscale asks for a documented mode",
      ["ai.fast", "ai.slow"].includes(lastSent!.fields["upscale.mode"]), lastSent!.fields["upscale.mode"]);

    const edits = photoroomOf(EDIT_PROVIDERS)!;
    await edits.edit(IMG, "relight", { lighting: "auto" }, LIVE);
    check("relight keeps the background", lastSent!.fields.removeBackground === "false");
    check("relight sends a documented lighting mode",
      ["ai.auto", "ai.preserve-hue-and-saturation", "ai.optimize-portrait"]
        .includes(lastSent!.fields["lighting.mode"]), lastSent!.fields["lighting.mode"]);

    await edits.edit(IMG, "beautify", { beautify: "food" }, LIVE);
    check("beautify keeps the background", lastSent!.fields.removeBackground === "false");
    check("beautify passes the food mode through", lastSent!.fields["beautify.mode"] === "ai.food");

    await edits.edit(IMG, "uncrop", {}, LIVE);
    check("uncrop keeps the background", lastSent!.fields.removeBackground === "false");
    check("uncrop sends ai.auto", lastSent!.fields["uncrop.mode"] === "ai.auto");
  }

  console.log("\nD. THE EDITS THAT ACT ON THE SUBJECT LET IT BE CUT OUT");
  {
    const edits = photoroomOf(EDIT_PROVIDERS)!;
    await edits.edit(IMG, "ai_shadow", { shadow: "soft" }, LIVE);
    check("a cast shadow does NOT force the background back",
      lastSent!.fields.removeBackground === undefined, lastSent!.fields.removeBackground);
    check("shadow sends a documented mode",
      ["ai.soft", "ai.auto-with-overrides"].includes(lastSent!.fields["shadow.mode"]),
      lastSent!.fields["shadow.mode"]);

    await edits.edit(IMG, "ghost_mannequin", {}, LIVE);
    check("ghost mannequin does not force the background back",
      lastSent!.fields.removeBackground === undefined);
    check("ghost mannequin sends ai.auto", lastSent!.fields["ghostMannequin.mode"] === "ai.auto");
  }

  console.log("\nE. A DESCRIBED BACKGROUND AND A FLAT COLOUR ARE ALTERNATIVES");
  {
    const edits = photoroomOf(EDIT_PROVIDERS)!;
    await edits.edit(IMG, "ai_background", { prompt: "marble counter", color: "#FFFFFF" }, LIVE);
    check("a prompt wins and the colour is not also sent",
      lastSent!.fields["background.prompt"] === "marble counter"
      && lastSent!.fields["background.color"] === undefined, lastSent!.fields);

    await edits.edit(IMG, "ai_background", { prompt: "   ", color: "#101820" }, LIVE);
    check("a blank prompt falls back to the colour",
      lastSent!.fields["background.color"] === "101820"
      && lastSent!.fields["background.prompt"] === undefined, lastSent!.fields);
    check("the colour is sent without the leading hash",
      !String(lastSent!.fields["background.color"]).includes("#"));
  }

  console.log("\nF. A SANDBOX KEY IS FREE, AND KNOWN TO BE");
  {
    check("the prefix is recognised", isSandboxKey("sandbox_abc") && isSandboxKey("SANDBOX_abc"));
    check("a live key is not mistaken for one", !isSandboxKey("live_abc") && !isSandboxKey("abc"));

    const edits = photoroomOf(EDIT_PROVIDERS)!;
    const sandboxRun = await edits.edit(IMG, "relight", {}, SANDBOX);
    check("a sandbox edit records zero cost", sandboxRun.costUsd === 0, sandboxRun.costUsd);
    const liveRun = await edits.edit(IMG, "relight", {}, LIVE);
    check("a live edit records the Plus rate", liveRun.costUsd === PHOTOROOM_EDIT_USD, liveRun.costUsd);

    const bg = photoroomOf(BACKGROUND_PROVIDERS)!;
    check("sandbox background removal is free too",
      (await bg.removeBackground(IMG, SANDBOX)).costUsd === 0);

    // The consequence that matters: a watermarked result costs the seller nothing.
    check("zero cost means zero credits at the floor",
      quote(0, 0, DEFAULT_BILLING).credits === 0);
  }

  console.log("\nG. THE SIX NEW TOOLS ARE COMPLETE CATALOGUE ENTRIES");
  {
    const NEW = ["ai_background", "relight", "ai_shadow", "beautify", "uncrop", "ghost_mannequin"] as const;
    for (const slug of NEW) {
      const tool = toolBySlug(slug);
      check(`${slug} — is in the catalogue`, Boolean(tool));
      check(`${slug} — is paid and declares the edit capability`,
        tool?.kind === "paid" && tool?.capability === "edit");
      check(`${slug} — names the operation it asks for`, tool?.operation === slug);
      check(`${slug} — has a service row to price it`, Boolean(tool?.service));
      check(`${slug} — has default settings`, Boolean(DEFAULT_SETTINGS[slug]));
    }
    // Every edit tool must be servable, or the card would advertise a tool that
    // can never run whatever key an operator connects.
    const edits = photoroomOf(EDIT_PROVIDERS)!;
    for (const tool of TOOLS.filter((t) => t.capability === "edit")) {
      check(`${tool.slug} — some provider supports it`, edits.supports(tool.operation!));
    }
    const sorts = TOOLS.map((t) => t.sortOrder);
    check("sort orders stay unique", new Set(sorts).size === sorts.length);
    const services = TOOLS.map((t) => t.service);
    check("service slugs stay unique", new Set(services).size === services.length);
  }

  console.log("\nH. AN EDIT IS PRICED ABOVE ITS FLOOR, NOT AT THE ADMIN'S GUESS");
  {
    const b = DEFAULT_BILLING;
    const needed = creditsForCost(PHOTOROOM_EDIT_USD, b);
    const q = quote(PHOTOROOM_EDIT_USD, 1, b);
    check("a $0.10 call needs more than the 1-credit floor", needed > 1, needed);
    check("the floor cannot undercut the margin rule", q.credits === needed, q.credits);
    check("the realised margin clears the configured floor",
      q.marginPercent >= b.minMarginPercent, q.marginPercent.toFixed(1));
    check("and it is not reported as below the floor", !q.belowFloor);
    // The cheap endpoint stays materially cheaper for the seller too.
    check("background removal prices under an edit",
      quote(PHOTOROOM_SEGMENT_USD, 1, b).credits < q.credits);
  }

  console.log("\nI. THE FREE ALLOWANCE IS BOUNDED AND PREDICTABLE");
  {
    check("only background removal may be given away",
      FREE_ELIGIBLE.length === 1 && FREE_ELIGIBLE[0] === "remove_bg", FREE_ELIGIBLE);
    check("it ships switched off", FREE_TOOL_DEFAULT.enabled === false);

    const noon = new Date("2026-09-12T14:30:00Z");
    check("a daily window starts at midnight UTC",
      windowStart("day", noon).toISOString() === "2026-09-12T00:00:00.000Z",
      windowStart("day", noon).toISOString());
    // 2026-09-12 is a Saturday; Monday-based weeks start on the 7th.
    check("a weekly window starts on Monday",
      windowStart("week", noon).toISOString() === "2026-09-07T00:00:00.000Z",
      windowStart("week", noon).toISOString());
    check("a monthly window starts on the 1st",
      windowStart("month", noon).toISOString() === "2026-09-01T00:00:00.000Z",
      windowStart("month", noon).toISOString());
    // A window must never move backwards within itself, or a seller's counter
    // would reset mid-day and the allowance would be unbounded.
    const early = windowStart("day", new Date("2026-09-12T00:00:01Z"));
    const late = windowStart("day", new Date("2026-09-12T23:59:59Z"));
    check("every instant in a day maps to one window", early.getTime() === late.getTime());

    const all = { ...FREE_TOOL_DEFAULT, plans: [] as string[] };
    check("an empty plan list means every plan qualifies",
      planQualifies(all, null) && planQualifies(all, "pro"));
    const pro = { ...FREE_TOOL_DEFAULT, plans: ["pro"] };
    check("a named plan list excludes everyone else",
      planQualifies(pro, "pro") && !planQualifies(pro, "free") && !planQualifies(pro, null));
  }


  globalThis.fetch = realFetch;
  console.log(failures === 0 ? "\nAll Photoroom tests passed.\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

// A function rather than top-level await: these scripts are bundled to CJS,
// which has no top-level await, and the bundler's error was being swallowed by
// --log-level=silent. A test suite that silently does not run is worse than no
// test suite, so it runs inside main() where the format supports it.
void main();
