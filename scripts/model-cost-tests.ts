/**
 * MODEL COST — one price per generation, and the real provider cost (0133).
 *
 * No network, no database, no paid request: Google's responses come from a
 * fake fetch, prices from in-memory lists, and the paths that cannot run in
 * isolation (the generation loop, the routes) are checked in their source.
 *
 *   C1  customer price: a GrovBase prompt costs what the model costs (7/7/12)
 *   C2  provider cost: official per-image price per quality ($0.134/0.134/0.24)
 *   C3  input + thinking tokens priced ONLY when Google reported them
 *   C4  the adapter reads thinking tokens apart (generateContent + Interactions)
 *   C5  revenue / cost / margin at list price; FX only converts the cost
 *   C6  one charge, one cost: the ledger gets the sum of the traced calls
 *   C7  "Próby = 1" is one request per image per model (fallbacks included)
 *   C8  the surcharge is gone from every price path and pinned to 0 in the DB
 *
 *   npm run test:modelcost
 */
import { readFileSync } from "node:fs";
import { imageCallCost, findUnitPrice, type TokenPrice, type UnitPrice } from "../lib/ai/usage-cost";
import { listMargin, usdMicrosToPlnCents } from "../lib/api-economics";
import { unitPrice, type GenModel } from "../components/genv3/types";
import { toRow } from "../lib/server/ai-usage";
import { googleAdapter } from "../lib/ai/providers/google";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
/** Source without comments: a claim in a comment proves nothing. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

const NB_PRO = "gemini-3-pro-image";
// The price lists exactly as migration 0133 seeds them.
const UNIT: UnitPrice[] = [
  { providerSlug: "google", model: NB_PRO, unitKind: "image", resolution: "1K", quality: "*", usdMicrosPerUnit: 134000 },
  { providerSlug: "google", model: NB_PRO, unitKind: "image", resolution: "2K", quality: "*", usdMicrosPerUnit: 134000 },
  { providerSlug: "google", model: NB_PRO, unitKind: "image", resolution: "4K", quality: "*", usdMicrosPerUnit: 240000 },
];
const TOKENS: TokenPrice[] = [{ providerSlug: "google", model: NB_PRO, inputPerMTok: 2_000_000, outputPerMTok: 12_000_000 }];
const FLAT = 134000;

async function main() {
  const migration = read("supabase/migrations/0133_model_cost_official_prices.sql");

  console.log("\nC1. Customer price — one price whoever wrote the prompt");
  const gm: GenModel = {
    id: "m", name: "Nano Banana Pro", badge: null, badgeTone: null, description: null,
    pricing: { "1K": 7, "2K": 7, "4K": 12 }, resolutions: ["1K", "2K", "4K"], ratios: ["1:1"], exactRatios: ["1:1"],
    maxOutputs: 1, supportsRefs: true, qualities: [], qualityPricing: {},
  };
  for (const [res, want] of [["1K", 7], ["2K", 7], ["4K", 12]] as const) {
    check(`UI quote ${res}: managed (GrovBase prompt) = custom = ${want} kr`,
      unitPrice(gm, res, "managed") === want && unitPrice(gm, res, "custom") === want, [unitPrice(gm, res, "managed"), unitPrice(gm, res, "custom")]);
  }
  check("migration pins Nano Banana Pro to 1K 7 · 2K 7 · 4K 12", /jsonb_build_object\('1K', 7, '2K', 7, '4K', 12\)/.test(migration));

  console.log("\nC2. Provider cost — Google's official price per output image");
  for (const [res, want] of [["1K", 134000], ["2K", 134000], ["4K", 240000]] as const) {
    const c = imageCallCost(UNIT, TOKENS, "google", NB_PRO, 1, { resolution: res, perImageFallbackUsdMicros: FLAT });
    check(`${res}: base = total = $${want / 1e6} with no usage`, c.base.basis === "estimated" && c.base.usdMicros === want
      && c.total.basis === "estimated" && c.total.usdMicros === want && !c.tokensPriced, c);
  }
  const two = imageCallCost(UNIT, TOKENS, "google", NB_PRO, 2, { resolution: "4K" });
  check("two 4K images = 2 × $0.24", two.total.basis !== "unknown" && two.total.usdMicros === 480000, two);
  const flatOnly = imageCallCost([], TOKENS, "google", NB_PRO, 1, { resolution: "4K", perImageFallbackUsdMicros: FLAT });
  check("no unit-price row → the model's flat per-image cost, labelled estimated", flatOnly.base.basis === "estimated" && flatOnly.base.usdMicros === FLAT);
  const unknown = imageCallCost([], TOKENS, "google", NB_PRO, 1, { resolution: "1K", perImageFallbackUsdMicros: 0 });
  check("no price at all → UNKNOWN, never a confident $0", unknown.total.basis === "unknown" && !unknown.tokensPriced);
  check("a failed call with no image costs $0 base", imageCallCost(UNIT, TOKENS, "google", NB_PRO, 0, { resolution: "1K" }).total.basis === "estimated");
  check("the preview id is priced by the same rows (prefix)", findUnitPrice(UNIT, "google", `${NB_PRO}-preview`, "image", "4K")?.usdMicrosPerUnit === 240000);
  check("migration seeds 1K 134000 · 2K 134000 · 4K 240000 and the flat 134000",
    /'1K', '\*', 134000\)/.test(migration) && /'2K', '\*', 134000\)/.test(migration) && /'4K', '\*', 240000\)/.test(migration)
    && /internal_cost_usd_micros = 134000/.test(migration));

  console.log("\nC3. Input + thinking — priced only when Google reported them");
  const used = imageCallCost(UNIT, TOKENS, "google", NB_PRO, 1, { resolution: "1K", inputTokens: 1000, thoughtTokens: 500 });
  // 1000 × $2/1M = $0.002 ; 500 × $12/1M = $0.006
  check("1K + 1000 input + 500 thinking = 134000 + 2000 + 6000 micros", used.total.basis !== "unknown" && used.total.usdMicros === 142000 && used.tokensPriced, used);
  check("…and the base stays the official image price", used.base.basis !== "unknown" && used.base.usdMicros === 134000);
  const onlyIn = imageCallCost(UNIT, TOKENS, "google", NB_PRO, 1, { resolution: "4K", inputTokens: 560 });
  check("input only (no thinking reported): 240000 + 560 × 2 = 241120", onlyIn.total.basis !== "unknown" && onlyIn.total.usdMicros === 241120, onlyIn);
  const noPrice = imageCallCost(UNIT, [], "google", NB_PRO, 1, { resolution: "1K", inputTokens: 1000, thoughtTokens: 500 });
  check("usage reported but no token price → total = base (nothing invented)", noPrice.total.basis !== "unknown" && noPrice.total.usdMicros === 134000 && !noPrice.tokensPriced);
  const noUsage = imageCallCost(UNIT, TOKENS, "google", NB_PRO, 1, { resolution: "1K", inputTokens: null, thoughtTokens: null });
  check("no usage in the response → total = base (nothing invented)", noUsage.total.basis !== "unknown" && noUsage.total.usdMicros === 134000 && !noUsage.tokensPriced);
  check("image output tokens are never an input to the price (no double count)", !/outputTokens/.test(code("lib/ai/usage-cost.ts").slice(code("lib/ai/usage-cost.ts").indexOf("export function imageCallCost"))));
  check("migration: token row input $2/1M, thinking (text output) $12/1M", /'google', 'gemini-3-pro-image', 2000000, 12000000/.test(migration));

  console.log("\nC4. The adapter reads thinking tokens apart — response parsing only, request untouched");
  const realFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QUJD" } }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 1120, thoughtsTokenCount: 344 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const gen = await googleAdapter.generate({ model_identifier: NB_PRO, supported_resolutions: ["1K", "2K", "4K"] } as never, {
    prompt: "P", aspectRatio: "1:1", resolution: "2K", quantity: 1, referenceImages: [{ base64: "QUJD", mime: "image/png" }],
    productLock: { fidelityInstructions: "" },
  } as never, { apiKey: "k", baseUrl: null } as never);
  check("generateContent: input 812, output 1120+344, thinking 344",
    gen.usage?.inputTokens === 812 && gen.usage?.outputTokens === 1464 && gen.usage?.thoughtTokens === 344, gen.usage);
  check("exactly one HTTP request for one image", bodies.length === 1);
  const priced = imageCallCost(UNIT, TOKENS, "google", NB_PRO, gen.images.length, { resolution: "2K", inputTokens: gen.usage?.inputTokens, thoughtTokens: gen.usage?.thoughtTokens });
  check("…priced: 134000 + 812×2 + 344×12 = 139752 micros", priced.total.basis !== "unknown" && priced.total.usdMicros === 139752, priced);

  bodies.length = 0;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({
      id: "int-1", status: "completed",
      steps: [{ type: "user_input", content: [] }, { type: "model_output", content: [{ type: "image", data: "QUJD", mime_type: "image/png" }] }],
      usage: { total_input_tokens: 700, total_output_tokens: 1120, total_thought_tokens: 210 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const rx = await googleAdapter.generate({ model_identifier: NB_PRO, supported_resolutions: ["1K", "2K", "4K"] } as never, {
    prompt: "P", aspectRatio: "auto", resolution: "2K", quantity: 1, strictSingleImage: true,
    referenceImages: [{ base64: "QUJD", mime: "image/png" }], productLock: { fidelityInstructions: "" },
  } as never, { apiKey: "k", baseUrl: null } as never);
  check("Interactions (Retusz): input 700, output 1120+210, thinking 210",
    rx.usage?.inputTokens === 700 && rx.usage?.outputTokens === 1330 && rx.usage?.thoughtTokens === 210, rx.usage);
  const rxBody = JSON.parse(bodies[0] ?? "{}") as Record<string, unknown>;
  check("Retusz request is exactly {model, input, response_format, store:false} (no response_modalities) — one request",
    bodies.length === 1 && JSON.stringify(Object.keys(rxBody)) === JSON.stringify(["model", "input", "response_format", "store"]) && rxBody.store === false, Object.keys(rxBody));
  // A billed answer with NO final image (e.g. a safety stop): its reported
  // tokens travel with the error, so the failed call is not recorded as $0.
  globalThis.fetch = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "no" }] }, finishReason: "IMAGE_SAFETY" }],
    usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 4, thoughtsTokenCount: 120 },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  let emptyErr: { safeMessage?: string; usage?: { inputTokens?: number; thoughtTokens?: number } } = {};
  try {
    await googleAdapter.generate({ model_identifier: NB_PRO, supported_resolutions: ["1K"] } as never, {
      prompt: "P", aspectRatio: "1:1", resolution: "1K", quantity: 1, referenceImages: [], productLock: { fidelityInstructions: "" },
    } as never, { apiKey: "k", baseUrl: null } as never);
  } catch (e) { emptyErr = e as typeof emptyErr; }
  check("generateContent empty result: error carries the reported usage (600 in, 120 thinking)",
    emptyErr.safeMessage === "provider_empty_result" && emptyErr.usage?.inputTokens === 600 && emptyErr.usage?.thoughtTokens === 120, emptyErr.usage);
  const emptyCost = imageCallCost(UNIT, TOKENS, "google", NB_PRO, 0, { resolution: "1K", inputTokens: emptyErr.usage?.inputTokens, thoughtTokens: emptyErr.usage?.thoughtTokens });
  check("…so the failed call costs its tokens (600×2 + 120×12 = 2640 micros), not a false $0",
    emptyCost.total.basis !== "unknown" && emptyCost.total.usdMicros === 2640, emptyCost);
  globalThis.fetch = (async () => new Response(JSON.stringify({
    id: "int-2", status: "completed", steps: [{ type: "user_input", content: [] }, { type: "model_output", content: [{ type: "text", text: "no" }] }],
    usage: { total_input_tokens: 650, total_output_tokens: 3, total_thought_tokens: 90 },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  let rxErr: { safeMessage?: string; usage?: { inputTokens?: number; thoughtTokens?: number } } = {};
  try {
    await googleAdapter.generate({ model_identifier: NB_PRO, supported_resolutions: ["1K", "2K", "4K"] } as never, {
      prompt: "P", aspectRatio: "auto", resolution: "4K", quantity: 1, strictSingleImage: true,
      referenceImages: [{ base64: "QUJD", mime: "image/png" }], productLock: { fidelityInstructions: "" },
    } as never, { apiKey: "k", baseUrl: null } as never);
  } catch (e) { rxErr = e as typeof rxErr; }
  check("Retusz empty result: error carries the reported usage (650 in, 90 thinking)",
    rxErr.safeMessage === "provider_empty_result" && rxErr.usage?.inputTokens === 650 && rxErr.usage?.thoughtTokens === 90, rxErr.usage);
  globalThis.fetch = realFetch;

  console.log("\nC5. Revenue, cost, margin — list price; FX only converts the cost");
  // 7 kr × 0,19 zł = 1,33 zł ; $0.134 × 4.0 = 0,536 zł → 54 gr ; margin 79 gr = 59.4%
  const m1 = listMargin(7, { usdMicros: 134000, basis: "estimated" }, 0.19, 4.0);
  check("1K: revenue 133 gr, cost 54 gr, margin 79 gr / 59.4%", m1.listRevenueCents === 133 && m1.listMarginCents === 79
    && Math.abs((m1.listMarginPercent ?? 0) - 59.398) < 0.01, m1);
  const m4 = listMargin(12, { usdMicros: 240000, basis: "estimated" }, 0.19, 4.0);
  check("4K: revenue 228 gr, cost 96 gr, margin 132 gr / 57.9%", m4.listRevenueCents === 228 && m4.listMarginCents === 132
    && Math.abs((m4.listMarginPercent ?? 0) - 57.895) < 0.01, m4);
  const mu = listMargin(7, { usdMicros: null, basis: "unknown" }, 0.19, 4.0);
  check("unknown cost → revenue shown, no margin", mu.listRevenueCents === 133 && mu.listMarginCents === null && mu.listMarginPercent === null);
  check("refunded (0 credits) → no revenue, no percent", listMargin(0, { usdMicros: 134000, basis: "estimated" }, 0.19, 4).listMarginPercent === null);
  check("USD→PLN conversion is analytic only (usdMicrosToPlnCents)", usdMicrosToPlnCents(134000, 4.0) === 54);
  const priceSrc = code("lib/server/concept-generation.ts") + code("lib/ai/types.ts") + code("components/genv3/types.ts");
  check("no customer price is derived from a USD figure or the FX rate", !/usd_to_pln|usdToPln|internal_cost_usd_micros/.test(priceSrc));
  const editor = code("components/admin/model-editor.tsx");
  check("admin table: quality · Google USD · cost zł · credits · revenue · margin zł · margin %",
    ["costTable.quality", "costTable.apiUsd", "costTable.apiPln", "costTable.credits", "costTable.revenue", "costTable.margin", "costTable.marginPct"].every((k) => editor.includes(k)));
  const hist = code("components/admin/api-economics.tsx");
  check("admin history: official base cost next to the real (usage) cost, thinking tokens, list margin",
    /aicc\.econ\.baseCost/.test(hist) && /aicc\.econ\.realCost/.test(hist) && /aicc\.econ\.thinking/.test(hist) && /aicc\.econ\.listMargin/.test(hist));

  console.log("\nC6. One successful generation = one call + one cost + one charge");
  const gsrc = code("lib/server/generation.ts");
  check("ledger cost = sum of the traced calls (not flat internal cost × images)",
    /apiCostUsdMicros: sumKnownCosts\(providerCalls\.map\(\(c\) => c\.cost\)\)\.usdMicros/.test(gsrc) && !/internal_cost_usd_micros \?\? 0\) \* stored\.length/.test(gsrc));
  check("every call is priced with the official size price + reported tokens", /imageCallCost\(unitPrices, tokenPrices/.test(gsrc)
    && /resolution: cRequest\.resolution/.test(gsrc));
  check("one startUsage per run (one charge)", (gsrc.match(/await startUsage\(/g) ?? []).length === 1);
  check("a refunded run still records what its calls cost (both failure paths)",
    (gsrc.match(/error: (safe|"storage_failed"),\n\s*apiCostUsdMicros: sumKnownCosts\(providerCalls\.map\(\(c\) => c\.cost\)\)\.usdMicros/g) ?? []).length === 2);
  check("a failed attempt is priced with the usage its error carried", /errorCode: pe\.safeMessage, usage: pe\.usage/.test(gsrc)
    && /priceOf\(pe\.partial\?\.length \?\? 0, pe\.usage\)/.test(code("lib/server/engine/image-call.ts")));
  const row = toRow({
    actorKind: "customer", consumer: "generation", providerSlug: "google", model: NB_PRO, status: "succeeded",
    units: 1, unitKind: "image", resolution: "4K", inputTokens: 700, outputTokens: 1330, thoughtTokens: 210,
    cost: { basis: "estimated", usdMicros: 243920 }, baseCost: { basis: "estimated", usdMicros: 240000 },
  });
  check("trace row keeps total, base, thinking and size apart", row.cost_usd_micros === 243920 && row.base_cost_usd_micros === 240000
    && row.thought_tokens === 210 && row.resolution === "4K", row);
  check("recorder stores the new columns (0133)", /thought_tokens, base_cost_usd_micros, resolution/.test(migration)
    && /v_res := case when coalesce\(v_row->>'resolution', ''\) ~ '\^\[0-9\]\{1,5\}\[Kkp\]\?\$'/.test(migration));
  const wf = code("lib/server/engine/image-call.ts");
  check("workflow image steps use the same pricing", /imageCallCost\(input\.unitPrices, input\.tokenPrices/.test(wf));

  console.log("\nC7. \"Próby = 1\" — one request per image per model, nothing hidden");
  check("attempts cap applies to the primary AND every fallback", /const attemptsFor = \(_candidateId: string\) => maxAttempts;/.test(gsrc));
  check("Retusz stays one model, one attempt, one request", /const maxAttempts = strict \? 1 :/.test(gsrc) && /strict \? \[input\.modelId\]/.test(gsrc));
  check("generator route passes the panel's attempts", /toolMaxAttempts\(supabase, "generator"\)/.test(code("app/api/generate/route.ts"))
    && /maxAttempts,\n\s*\}\);/.test(code("app/api/generate/route.ts")));
  check("custom retake passes the panel's attempts", /toolMaxAttempts\(supabase, "generator"\)/.test(code("app/api/generations/regenerate/route.ts")));
  check("GrovShot passes the panel's attempts", /toolMaxAttempts\(supabase, "prompts"\)/.test(code("lib/server/concept-generation.ts"))
    && /costOverride: credits,\n\s*maxAttempts,/.test(code("lib/server/concept-generation.ts")));
  check("Moda keeps passing the panel's attempts", /maxAttempts: engine\.maxAttempts/.test(code("lib/server/engine/tool-run.ts")));

  console.log("\nC8. The \"GrovBase surcharge\" is gone");
  const sources = ["lib/server/concept-generation.ts", "lib/ai/router.ts", "components/genv3/types.ts", "components/prompts/concept-board.tsx",
    "components/generator/generation-toolbar.tsx", "components/admin/model-editor.tsx", "app/admin/ai/modele/page.tsx",
    "app/(app)/generator/page.tsx", "app/(app)/prompts/page.tsx", "app/(app)/k/[cat]/[wf]/page.tsx"];
  const leftovers = sources.filter((f) => /surcharge|ecomSurcharge|engineSurcharge|costEcom/i.test(code(f)));
  check("no price path or screen reads or adds a surcharge", leftovers.length === 0, leftovers);
  check("admin action refuses to write it", /delete \(patch as \{ ecom_surcharge_credits\?: unknown \}\)\.ecom_surcharge_credits/.test(code("app/actions/admin.ts")));
  check("DB: zeroed + CHECK (ecom_surcharge_credits = 0) + the 10 zł target removed",
    /set ecom_surcharge_credits = 0/.test(migration) && /check \(ecom_surcharge_credits = 0\)/.test(migration) && /value - 'ecom_target_pln'/.test(migration));
  for (const l of ["pl", "en", "de"]) {
    const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as { admin: Record<string, unknown> };
    check(`${l}: no "Dopłata GrovBase" labels left`, !("ecomSurcharge" in d.admin) && !("ecomPriceShort" in d.admin) && "costTable" in d.admin);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
