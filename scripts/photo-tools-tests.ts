/**
 * THE FOUR PHOTO TOOLS — Usuń tło, Zmień kolor tła, Dodaj tło AI, Dodaj cień.
 *
 * No network and no real key: Photoroom is a recording stub, the database a
 * small in-memory double. What is tested is everything that decides WHAT is
 * sent, WHAT is charged and WHAT a seller gets back:
 *
 *   A  routing — each tool its own screen, switch and admin key
 *   B  the exact request each tool makes (endpoint, fields, one call)
 *   C  Photoroom's quiet failures turned into refunded errors
 *   D  the full runner: price, reservation, refund, trace, delivery,
 *      the sandbox key, the pin, the free recolour, timeouts
 *   E  the scene presets and what reaches a browser
 *   F  photo intake (prepareInput) and the cutout check
 *   G  the price proposal maths the admin card shows
 *   H  the migration is additive and keeps the private denylist
 *   I  a result is kept, listed, and found again by its press
 *   J  the wiring the review fixes depend on (route, panel, presets save)
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  BACKGROUND_PROVIDERS, EDIT_PROVIDERS, PHOTOROOM_EDIT_URL, PHOTOROOM_SEGMENT_URL, PHOTOROOM_EDIT_USD,
  PHOTOROOM_SEGMENT_USD, ToolProviderError, photoroomUrl, type Creds,
} from "@/lib/images/providers";
import { PHOTO_TOOLS, TOOLS, isPhotoTool, toolBySlug } from "@/lib/images/tools";
import { FEATURE_REGISTRY, featureForPhotoTool, featureForToolSlug } from "@/lib/features";
import { TOOL_SECTIONS } from "@/lib/tool-cards";
import { IMAGE_EDIT_MORE } from "@/lib/topnav";
import { AI_TOOL_KEYS, PHOTO_TOOL_KEYS, TOOL_ENGINE_MODES, apiPathKind } from "@/lib/services/ai-tools";
import { parsePresets, publicPresets, presetsDocument } from "@/lib/images/ai-background-presets";
import { hasRealTransparency } from "@/lib/images/local";
import { creditsForCost, DEFAULT_BILLING } from "@/lib/images/pricing";
import { parseSettings, runTool, toolCatalogue, type DeliverInput } from "@/lib/server/image-tools";
import {
  MAX_SIDE, findDelivered, listPhotoResults, prepareInput, settingsSummary, storeResult, validSourcePath,
} from "@/lib/server/photo-tools";
import { MAX_INPUT_BYTES } from "@/lib/images/local";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${cond || extra === undefined ? "" : ` — ${JSON.stringify(extra)?.slice(0, 300)}`}`);
  if (!cond) failures += 1;
}

/* ── Photoroom, recorded ─────────────────────────────────────────────────── */

type Sent = { url: string; headers: Record<string, string>; fields: Record<string, string>; files: string[] };
let sent: Sent[] = [];
type Answer = {
  status?: number; type?: string; headers?: Record<string, string>; body?: Uint8Array | string; throws?: string;
  /** The headers arrive (200), then the body fails mid-read with this error name. */
  bodyFails?: string;
};
let answer: Answer = {};
let OUT_PNG: Buffer = Buffer.alloc(0);

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const fields: Record<string, string> = {};
  const files: string[] = [];
  if (init?.body instanceof FormData) {
    for (const [k, v] of init.body.entries()) {
      if (typeof v === "string") fields[k] = v; else files.push(k);
    }
  }
  sent.push({ url: String(url), headers: { ...(init?.headers as Record<string, string> ?? {}) }, fields, files });
  if (answer.throws) {
    const e = new Error("stub"); e.name = answer.throws; throw e;
  }
  if (answer.bodyFails) {
    const name = answer.bodyFails;
    const broken = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array([1, 2, 3])); const e = new Error("stub body"); e.name = name; c.error(e); },
    });
    return new Response(broken, { status: 200, headers: { "content-type": "image/png", "x-request-id": "req_1" } });
  }
  return new Response((answer.body ?? new Uint8Array(OUT_PNG)) as BodyInit, {
    status: answer.status ?? 200,
    headers: { "content-type": answer.type ?? "image/png", "x-request-id": "req_1", ...(answer.headers ?? {}) },
  });
}) as typeof fetch;

const IMG = (bytes: Buffer, mime = "image/jpeg") => ({ bytes, mime });
const LIVE: Creds = { apiKey: "live_test_key_123" };
const photoroom = <T extends { slug: string }>(list: T[]) => list.find((p) => p.slug === "photoroom")!;

/* ── the database, in memory ─────────────────────────────────────────────── */

type Row = Record<string, unknown>;
type Db = {
  services: Row[];
  settings: Record<string, unknown>;
  balance: number;
  rpcs: { name: string; args: Row }[];
  startStatus: string;
};
const PRESETS = presetsDocument(parsePresets([
  { key: "studio_premium", label: { pl: "Studio premium" }, prompt: "premium studio, soft grey backdrop", expandPrompt: false, enabled: true },
  { key: "kitchen", label: { pl: "Kuchnia", en: "Kitchen" }, prompt: "white marble kitchen counter", expandPrompt: true, enabled: true },
  { key: "hidden", label: { pl: "Ukryta" }, prompt: "secret scene", enabled: false },
]));

function freshDb(): Db {
  return {
    services: TOOLS.map((t) => ({ slug: t.service, credits_cost: 1, enabled: true, maintenance_mode: false })),
    settings: {},
    balance: 100,
    rpcs: [],
    startStatus: "ok",
  };
}

function fakeSupabase(db: Db) {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const rows = (): Row[] => {
      let r: Row[] = [];
      if (table === "service_catalog") r = db.services;
      else if (table === "app_settings") r = Object.entries(db.settings).map(([key, value]) => ({ key, value }));
      else if (table === "credit_wallets") r = [{ id: "wal-1", balance: db.balance, workspace_id: "w" }];
      for (const [k, v] of filters) r = r.filter((x) => x[k] === v);
      return r;
    };
    const q = {
      select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
      in: () => q, order: () => q, limit: () => q, gte: () => q, lt: () => q, neq: () => q, is: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    };
    return q;
  };
  return {
    from,
    rpc: async (name: string, args: Row) => {
      db.rpcs.push({ name, args });
      if (name === "usage_event_start") {
        return { data: [{ status: db.startStatus, event_id: db.startStatus === "ok" ? `ev-${db.rpcs.length}` : null }], error: null };
      }
      if (name === "ai_background_presets_read") return { data: PRESETS, error: null };
      if (name === "ai_provider_call_record") return { data: (args.p_calls as unknown[]).length, error: null };
      return { data: true, error: null };
    },
  };
}
type Client = Parameters<typeof runTool>[0];

const rpc = (db: Db, name: string) => db.rpcs.filter((r) => r.name === name);
const calls = (db: Db) => rpc(db, "ai_provider_call_record").flatMap((r) => r.args.p_calls as Row[]);

/** A deliver hook that keeps what it was given. */
function keeper(ok = true) {
  const got: DeliverInput[] = [];
  const hook = async (d: DeliverInput) => {
    got.push(d);
    return ok ? { ok: true as const, id: "res-1", path: "w/tools/res-1.png" } : { ok: false as const, error: "storage_failed" };
  };
  return { got, hook };
}

async function run(db: Db, tool: string, file: Buffer, settings: unknown, extra: Partial<Parameters<typeof runTool>[3]> = {}) {
  sent = [];
  return runTool(fakeSupabase(db) as unknown as Client, "u", "w", {
    tool: tool as never, settings, file, mime: "image/jpeg", idempotencyKey: `k-${Math.random()}`, ...extra,
  });
}

async function main() {
  process.env.GROVBASE_SERVER_KEY = "x".repeat(48);
  delete process.env.FAL_KEY;
  OUT_PNG = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 250, g: 250, b: 250, alpha: 1 } } }).png().toBuffer();
  const JPEG = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
  // A cut-out product: an opaque square on a fully transparent canvas (~44% clear).
  const square = await sharp({ create: { width: 150, height: 150, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const CUTOUT = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: square, left: 25, top: 25 }]).png().toBuffer();

  console.log("\nA. FOUR TOOLS, FOUR SCREENS, FOUR SWITCHES, FOUR ADMIN KEYS");
  {
    check("the four photo tools are named once", PHOTO_TOOLS.join() === "remove_bg,white_bg,ai_background,ai_shadow");
    for (const slug of PHOTO_TOOLS) {
      const tool = toolBySlug(slug);
      check(`${slug} — pinned to Photoroom`, tool?.provider === "photoroom", tool?.provider);
      check(`${slug} — is paid`, tool?.kind === "paid");
      const feature = FEATURE_REGISTRY.find((f) => f.key === featureForPhotoTool(slug));
      check(`${slug} — its own switch at /tools/${slug}`, feature?.path === `/tools/${slug}`, feature?.path);
      check(`${slug} — ships as "Wkrótce" until an operator turns it on`, feature?.defaultStatus === "COMING_SOON", feature?.defaultStatus);
      check(`${slug} — an admin key with a capability path`, AI_TOOL_KEYS.includes(`tool_${slug}` as never)
        && PHOTO_TOOL_KEYS.includes(`tool_${slug}`) && apiPathKind(`tool_${slug}`) === "capability");
      check(`${slug} — no prompt engine to configure`, TOOL_ENGINE_MODES[`tool_${slug}` as keyof typeof TOOL_ENGINE_MODES]?.join() === "off");
    }
    check("only Zmień kolor tła is free on an already cut-out photo",
      PHOTO_TOOLS.filter((s) => toolBySlug(s)?.freeWhenTransparent).join() === "white_bg");
    check("isPhotoTool refuses other slugs", !isPhotoTool("upscale") && !isPhotoTool("retouch") && !isPhotoTool("shadow"));
    // The editor and the run API keep their own contract: one switch, "editor".
    check("the editor's /api/tools/run still answers to the editor switch",
      featureForToolSlug("remove_bg") === "editor" && featureForToolSlug("white_bg") === "editor");
    const cards = TOOL_SECTIONS.flatMap((s) => s.cards);
    const href = (k: string) => cards.find((c) => c.key === k)?.href;
    check("the catalogue opens the screens, not the editor",
      href("remove_bg") === "/tools/remove_bg" && href("white_bg") === "/tools/white_bg"
      && href("background") === "/tools/white_bg" && href("shadow") === "/tools/ai_shadow"
      && href("ai_background") === "/tools/ai_background" && href("ai_shadow") === "/tools/ai_shadow",
      cards.filter((c) => ["remove_bg", "white_bg", "background", "shadow", "ai_background", "ai_shadow"].includes(c.key)).map((c) => `${c.key}→${c.href}`));
    check("search finds the screens by their own routes",
      ["/tools/remove_bg", "/tools/white_bg", "/tools/ai_background", "/tools/ai_shadow"].every((h) => IMAGE_EDIT_MORE.some((e) => e.href === h)));
    check("the editor's own sections stay in the editor", !IMAGE_EDIT_MORE.some((e) => e.href.startsWith("/tools/editor?tool=remove")));
  }

  console.log("\nB. THE EXACT REQUEST EACH TOOL MAKES");
  {
    answer = {};
    const seg = photoroom(BACKGROUND_PROVIDERS);
    sent = [];
    const cut = await seg.removeBackground(IMG(JPEG), LIVE);
    check("Usuń tło — one call", sent.length === 1);
    check("Usuń tło — POST /v1/segment, not /v2/edit", sent[0]?.url === PHOTOROOM_SEGMENT_URL, sent[0]?.url);
    check("Usuń tło — the photo as image_file", sent[0]?.files.join() === "image_file", sent[0]?.files);
    check("Usuń tło — a lossless PNG is asked for, nothing else", JSON.stringify(sent[0]?.fields) === JSON.stringify({ format: "png" }), sent[0]?.fields);
    check("Usuń tło — key in x-api-key, images only", sent[0]?.headers["x-api-key"] === LIVE.apiKey
      && !String(sent[0]?.headers.Accept).includes("json") && !sent[0]?.url.includes(LIVE.apiKey));
    check("Usuń tło — $0.02, named endpoint", cut.costUsd === PHOTOROOM_SEGMENT_USD && cut.endpoint === "v1/segment");

    sent = [];
    await seg.removeBackground(IMG(JPEG), LIVE, { bgColor: "#F5EFE6", format: "png" });
    check("Zmień kolor tła — ONE call to the same cheap endpoint", sent.length === 1 && sent[0]?.url === PHOTOROOM_SEGMENT_URL);
    check("Zmień kolor tła — bg_color as documented, with its #", sent[0]?.fields.bg_color === "#F5EFE6", sent[0]?.fields);

    const edit = photoroom(EDIT_PROVIDERS);
    sent = [];
    const bg = await edit.edit(IMG(JPEG), "ai_background", {
      prompt: "  light oak table, soft daylight  ", expandPrompt: false, seed: 42,
      guidance: { image: IMG(JPEG), scale: 0.6 }, format: "png",
    }, LIVE);
    const f = sent[0]?.fields ?? {};
    check("Dodaj tło AI — one call to /v2/edit", sent.length === 1 && sent[0]?.url === PHOTOROOM_EDIT_URL, sent[0]?.url);
    check("Dodaj tło AI — the prompt, trimmed, nothing appended", f["background.prompt"] === "light oak table, soft daylight", f["background.prompt"]);
    check("Dodaj tło AI — no rewriting of a seller's own prompt", f["background.expandPrompt.mode"] === "ai.never");
    check("Dodaj tło AI — cut out in place, stated explicitly", f.removeBackground === "true" && f.referenceBox === "originalImage", f);
    check("Dodaj tło AI — the inspiration photo and its strength", sent[0]?.files.includes("background.guidance.imageFile")
      && f["background.guidance.scale"] === "0.6", { files: sent[0]?.files, f });
    check("Dodaj tło AI — the seed rides along", f["background.seed"] === "42");
    check("Dodaj tło AI — no colour, no shadow, no relight", !f["background.color"] && !f["shadow.mode"] && !f["lighting.mode"]);
    check("Dodaj tło AI — $0.10", bg.costUsd === PHOTOROOM_EDIT_USD && bg.endpoint === "v2/edit");
    sent = [];
    await edit.edit(IMG(JPEG), "ai_background", { prompt: "kitchen", expandPrompt: true }, LIVE);
    check("Dodaj tło AI — a preset may opt in to Photoroom's expansion", sent[0]?.fields["background.expandPrompt.mode"] === "ai.auto");
    sent = [];
    let code = "";
    try { await edit.edit(IMG(JPEG), "ai_background", { prompt: "   " }, LIVE); } catch (e) { code = (e as ToolProviderError).code; }
    check("Dodaj tło AI — no scene, no call (and no colour fallback)", code === "prompt_required" && sent.length === 0, { code, n: sent.length });

    const MODES = { soft: "ai.soft", hard: "ai.hard", floating: "ai.floating" } as const;
    for (const [style, mode] of Object.entries(MODES)) {
      sent = [];
      await edit.edit(IMG(JPEG), "ai_shadow", { shadow: style as "soft", color: "#ffffff" }, LIVE);
      const s = sent[0]?.fields ?? {};
      check(`Dodaj cień — ${style} → shadow.mode=${mode}`, s["shadow.mode"] === mode, s["shadow.mode"]);
      check(`Dodaj cień — ${style}: cut out in place, on FFFFFF, no scene or light`,
        s.removeBackground === "true" && s.referenceBox === "originalImage" && s["background.color"] === "FFFFFF"
        && !s["background.prompt"] && !s["lighting.mode"], s);
    }
    sent = [];
    await edit.edit(IMG(JPEG), "ai_shadow", { shadow: "soft", transparent: true, format: "jpeg" }, LIVE);
    check("Dodaj cień — transparent: no colour, and never a JPEG (no alpha)",
      sent[0]?.fields["background.color"] === undefined && sent[0]?.fields["export.format"] === "png", sent[0]?.fields);
  }

  console.log("\nC. PHOTOROOM'S QUIET FAILURES BECOME REFUNDED ERRORS");
  {
    const edit = photoroom(EDIT_PROVIDERS);
    answer = { headers: { "pr-unsupported-attributes": "shadow.mode" } };
    let err: ToolProviderError | null = null;
    try { await edit.edit(IMG(JPEG), "ai_shadow", { shadow: "soft" }, LIVE); } catch (e) { err = e as ToolProviderError; }
    check("an ignored field is a failure, not a plain cutout sold as a shadow", err?.code === "provider_unsupported_params", err?.code);
    check("…and it is marked billed (Photoroom processed it)", err?.billed === true);
    answer = { type: "application/json", body: "{\"result\":\"x\"}" };
    err = null;
    try { await photoroom(BACKGROUND_PROVIDERS).removeBackground(IMG(JPEG), LIVE); } catch (e) { err = e as ToolProviderError; }
    check("a 200 that is not an image is never saved as one", err?.code === "provider_empty_result" && err?.billed === true, err?.code);
    answer = {};

    check("a stored proxy ORIGIN keeps each endpoint's path",
      photoroomUrl("https://proxy.example.com", "/v2/edit", PHOTOROOM_EDIT_URL) === "https://proxy.example.com/v2/edit");
    check("a stored cutout URL never receives an edit",
      photoroomUrl("https://sdk.photoroom.com/v1/segment", "/v2/edit", PHOTOROOM_EDIT_URL) === PHOTOROOM_EDIT_URL);
    check("plain http and garbage fall back to Photoroom",
      photoroomUrl("http://x.example.com", "/v1/segment", PHOTOROOM_SEGMENT_URL) === PHOTOROOM_SEGMENT_URL
      && photoroomUrl("not a url", "/v1/segment", PHOTOROOM_SEGMENT_URL) === PHOTOROOM_SEGMENT_URL);
  }

  console.log("\nD. THE RUNNER: PRICE, RESERVATION, REFUND, TRACE, DELIVERY");
  {
    process.env.PHOTOROOM_API_KEY = "live_key_abc";
    process.env.FAL_KEY = "fal_key_that_must_not_be_used";
    let db = freshDb();
    let k = keeper();
    let r = await run(db, "remove_bg", JPEG, { format: "png" }, { deliver: k.hook });
    check("Usuń tło — succeeds and is delivered", r.ok && "delivered" in r && r.delivered?.id === "res-1", r);
    check("pinned: Photoroom answers even with a fal key present", sent.length === 1 && sent[0]?.url === PHOTOROOM_SEGMENT_URL, sent.map((s) => s.url));
    const start = rpc(db, "usage_event_start")[0]?.args;
    check("the reservation is the quoted price", start?.p_credits === creditsForCost(PHOTOROOM_SEGMENT_USD, DEFAULT_BILLING) || start?.p_credits === 1, start?.p_credits);
    check("the ledger names the endpoint and environment",
      (start?.p_metadata as Row)?.endpoint === "v1/segment" && (start?.p_metadata as Row)?.environment === "live", start?.p_metadata);
    check("completed at the list cost", rpc(db, "usage_event_complete")[0]?.args.p_api_cost_usd_micros === 20000, rpc(db, "usage_event_complete")[0]?.args);
    const c = calls(db)[0];
    check("the provider call is traced under the tool's admin key with its endpoint",
      c?.tool_key === "tool_remove_bg" && String(c?.model).includes("v1/segment"), c);
    check("deliver saw live bytes, before the run was booked", k.got[0]?.environment === "live" && k.got[0]?.endpoint === "v1/segment");

    // Sandbox: refused for a customer, free for an operator.
    process.env.PHOTOROOM_API_KEY = "sandbox_key_abc";
    db = freshDb();
    r = await run(db, "ai_shadow", JPEG, { style: "soft" }, { viewerIsAdmin: false, deliver: keeper().hook });
    check("sandbox key + customer → refused, before any call or charge",
      !r.ok && r.error === "provider_sandbox" && sent.length === 0 && rpc(db, "usage_event_start").length === 0, { r, n: sent.length });
    db = freshDb();
    k = keeper();
    r = await run(db, "ai_shadow", JPEG, { style: "hard" }, { viewerIsAdmin: true, deliver: k.hook });
    check("sandbox key + operator → runs at 0 credits, labelled sandbox",
      r.ok && rpc(db, "usage_event_start")[0]?.args.p_credits === 0 && k.got[0]?.environment === "sandbox", rpc(db, "usage_event_start")[0]?.args);
    check("…and books no provider cost", rpc(db, "usage_event_complete")[0]?.args.p_api_cost_usd_micros === 0);

    process.env.PHOTOROOM_API_KEY = "live_key_abc";
    // Zmień kolor tła on a photo that is already cut out: no API, no charge.
    db = freshDb();
    k = keeper();
    r = await run(db, "white_bg", CUTOUT, { color: "#F5EFE6", format: "png" }, { deliver: k.hook });
    check("already cut out → recoloured locally, zero calls, zero credits",
      r.ok && sent.length === 0 && k.got[0]?.environment === "local" && k.got[0]?.credits === 0, { ok: r.ok, n: sent.length, env: k.got[0]?.environment });
    db = freshDb();
    r = await run(db, "white_bg", JPEG, { color: "#F5EFE6", format: "jpeg" }, { deliver: keeper().hook });
    check("a normal photo → ONE /v1/segment call with bg_color",
      r.ok && sent.length === 1 && sent[0]?.fields.bg_color === "#F5EFE6" && sent[0]?.fields.format === "png", sent[0]?.fields);
    check("…and the seller's JPEG is encoded here", r.ok && r.mime === "image/jpeg", r.ok ? r.mime : r);

    // Failures and what they cost.
    db = freshDb();
    answer = { throws: "TimeoutError" };
    r = await run(db, "ai_background", JPEG, { prompt: "oak table" }, { deliver: keeper().hook });
    check("timeout → refunded, error provider_timeout", !r.ok && r.error === "provider_timeout" && rpc(db, "usage_event_fail").length === 1, r);
    check("timeout → cost UNKNOWN, never a confident zero",
      calls(db)[0]?.cost_basis === "unknown" || (calls(db)[0] as Row)?.cost_usd_micros == null, calls(db)[0]);
    db = freshDb();
    answer = { headers: { "pr-unsupported-attributes": "shadow.mode" } };
    r = await run(db, "ai_shadow", JPEG, { style: "floating" }, { deliver: keeper().hook });
    check("ignored field → refunded, the processed call booked at list price",
      !r.ok && r.error === "provider_unsupported_params" && rpc(db, "usage_event_fail")[0]?.args.p_api_cost_usd_micros === 100000, rpc(db, "usage_event_fail")[0]?.args);
    answer = {};
    db = freshDb();
    r = await run(db, "ai_shadow", JPEG, { style: "soft" }, { deliver: keeper(false).hook });
    check("a result that cannot be stored is refunded (and its real cost kept)",
      !r.ok && r.error === "storage_failed" && rpc(db, "usage_event_fail")[0]?.args.p_api_cost_usd_micros === 100000
      && rpc(db, "usage_event_complete").length === 0, { r, fail: rpc(db, "usage_event_fail")[0]?.args });

    // A body that never arrives after a 200: the image was made and billed.
    db = freshDb();
    answer = { bodyFails: "TimeoutError" };
    r = await run(db, "ai_shadow", JPEG, { style: "soft" }, { deliver: keeper().hook });
    check("a 200 whose body times out → refunded, booked at list price (billed), never $0",
      !r.ok && r.error === "provider_timeout" && rpc(db, "usage_event_fail")[0]?.args.p_api_cost_usd_micros === 100000, { r, fail: rpc(db, "usage_event_fail")[0]?.args });
    db = freshDb();
    answer = { bodyFails: "TypeError" };
    r = await run(db, "remove_bg", JPEG, {}, { deliver: keeper().hook });
    check("a 200 whose body drops → refunded, the cutout booked at $0.02",
      !r.ok && r.error === "provider_unreachable" && rpc(db, "usage_event_fail")[0]?.args.p_api_cost_usd_micros === 20000, { r, fail: rpc(db, "usage_event_fail")[0]?.args });
    answer = {};

    // A retry of a press that already delivered: found once the key is held.
    db = freshDb();
    let asked = 0;
    r = await run(db, "ai_background", JPEG, { prompt: "oak table" }, {
      deliver: keeper().hook, alreadyDelivered: async () => { asked++; return true; },
    });
    check("a press that already delivered → refunded at once, no provider call",
      !r.ok && r.error === "already_delivered" && sent.length === 0 && asked === 1
      && rpc(db, "usage_event_fail")[0]?.args.p_api_cost_usd_micros === 0 && rpc(db, "usage_event_complete").length === 0, { r, n: sent.length });
    check("…asked only AFTER the reservation holds the key",
      db.rpcs.findIndex((x) => x.name === "usage_event_start") < db.rpcs.findIndex((x) => x.name === "usage_event_fail"));
    db = freshDb();
    r = await run(db, "ai_background", JPEG, { prompt: "oak table" }, { deliver: keeper().hook, alreadyDelivered: async () => false });
    check("…and a press that did not deliver runs normally", r.ok && sent.length === 1, r);

    // Presets and prompts: resolved before any charge.
    db = freshDb();
    r = await run(db, "ai_background", JPEG, { preset: "kitchen" }, { deliver: keeper().hook });
    check("a preset is resolved on the server, by key", r.ok && sent[0]?.fields["background.prompt"] === "white marble kitchen counter"
      && sent[0]?.fields["background.expandPrompt.mode"] === "ai.auto", sent[0]?.fields);
    check("…and only its KEY is on the ledger", (rpc(db, "usage_event_start")[0]?.args.p_metadata as Row)?.preset === "kitchen"
      && !JSON.stringify(rpc(db, "usage_event_start")[0]?.args).includes("marble"));
    db = freshDb();
    r = await run(db, "ai_background", JPEG, { preset: "hidden" }, { deliver: keeper().hook });
    check("a switched-off preset → preset_unavailable, nothing charged or sent",
      !r.ok && r.error === "preset_unavailable" && sent.length === 0 && rpc(db, "usage_event_start").length === 0, r);
    db = freshDb();
    r = await run(db, "ai_background", JPEG, { preset: "", prompt: "" }, { deliver: keeper().hook });
    check("no scene at all → prompt_required, nothing charged or sent",
      !r.ok && r.error === "prompt_required" && sent.length === 0 && rpc(db, "usage_event_start").length === 0, r);
    db = freshDb();
    r = await run(db, "ai_background", JPEG, { prompt: "Rustic\n  wooden   table" }, { deliver: keeper().hook });
    check("a seller's own prompt goes verbatim (whitespace collapsed), never expanded",
      sent[0]?.fields["background.prompt"] === "Rustic wooden table" && sent[0]?.fields["background.expandPrompt.mode"] === "ai.never", sent[0]?.fields);

    // Guards.
    db = freshDb();
    db.startStatus = "duplicate_request";
    r = await run(db, "remove_bg", JPEG, {}, { deliver: keeper().hook });
    check("the same request twice → duplicate_request, no second call", !r.ok && r.error === "duplicate_request" && sent.length === 0, r);
    db = freshDb();
    db.balance = 0;
    r = await run(db, "ai_shadow", JPEG, {}, { deliver: keeper().hook });
    check("an empty wallet → insufficient_credits, nothing sent", !r.ok && r.error === "insufficient_credits" && sent.length === 0, r);
    delete process.env.PHOTOROOM_API_KEY;
    db = freshDb();
    r = await run(db, "remove_bg", JPEG, {}, { deliver: keeper().hook });
    check("no Photoroom key → no_provider, even with a fal key", !r.ok && r.error === "no_provider" && sent.length === 0, r);
    delete process.env.FAL_KEY;
  }

  console.log("\nD2. WHAT THE CATALOGUE TELLS A SELLER AND AN OPERATOR");
  {
    const db = freshDb();
    const sup = fakeSupabase(db) as unknown as Client;
    let cat = await toolCatalogue(sup);
    const row = (slug: string, list = cat) => list.find((c) => c.slug === slug)!;
    check("no key → the four are unavailable (\"Wkrótce\")", PHOTO_TOOLS.every((s) => !row(s).available && row(s).reason === "no_provider"));
    process.env.PHOTOROOM_API_KEY = "sandbox_x";
    cat = await toolCatalogue(sup);
    check("sandbox key → still unavailable for a customer", PHOTO_TOOLS.every((s) => !row(s).available && row(s).reason === "sandbox"));
    const admin = await toolCatalogue(sup, { admin: true });
    check("sandbox key → usable by an operator, at 0 credits", PHOTO_TOOLS.every((s) => row(s, admin).available && row(s, admin).credits === 0 && row(s, admin).environment === "sandbox"));
    process.env.PHOTOROOM_API_KEY = "live_x";
    cat = await toolCatalogue(sup);
    check("live key → available, priced by the margin rule",
      row("remove_bg").available && row("remove_bg").credits === Math.max(1, creditsForCost(PHOTOROOM_SEGMENT_USD, DEFAULT_BILLING))
      && row("ai_shadow").credits === creditsForCost(PHOTOROOM_EDIT_USD, DEFAULT_BILLING), cat.filter((c) => isPhotoTool(c.slug)).map((c) => `${c.slug}:${c.credits}`));
    delete process.env.PHOTOROOM_API_KEY;
  }

  console.log("\nE. SCENE PRESETS — NAMES TO THE BROWSER, PROMPTS NEVER");
  {
    const list = parsePresets(PRESETS);
    check("the stored document reads back", list.length === 3 && list[1]?.label.en === "Kitchen");
    const shown = publicPresets(list, "en");
    check("the browser gets enabled presets only", shown.map((p) => p.key).join() === "studio_premium,kitchen");
    check("…as key + label, nothing else", shown.every((p) => Object.keys(p).sort().join() === "key,label"));
    check("…and no prompt text anywhere in it", !JSON.stringify(shown).includes("marble") && !JSON.stringify(shown).includes("studio,"));
    check("a missing label falls back to Polish", publicPresets(list, "de")[0]?.label === "Studio premium");
    check("bad entries are dropped, not repaired", parsePresets([
      { key: "Bad Key", label: { pl: "x" }, prompt: "y" }, { key: "ok", label: { pl: "" }, prompt: "y" },
      { key: "ok2", label: { pl: "x" }, prompt: "" }, { key: "dup", label: { pl: "a" }, prompt: "b" }, { key: "dup", label: { pl: "c" }, prompt: "d" },
    ]).map((p) => p.key).join() === "dup");
    const s = parseSettings("ai_background", { preset: "../x", prompt: "a".repeat(500), guidance: 7 });
    check("settings: a bad preset key is dropped, the prompt capped, the strength clamped",
      s.preset === "" && s.prompt.length === 300 && s.guidance === 1, s);
    const sh = parseSettings("ai_shadow", { style: "dramatic", background: "neon", color: "red", format: "gif" });
    check("settings: unknown shadow values fall back to safe defaults",
      sh.style === "soft" && sh.background === "white" && sh.color === "#FFFFFF" && sh.format === "png", sh);
    check("a shadow's colour is kept only on a coloured background",
      settingsSummary("ai_shadow", { style: "soft", background: "white", color: "#123456" }).color === undefined
      && settingsSummary("ai_shadow", { style: "soft", background: "color", color: "#123456" }).color === "#123456");
    check("the history keeps choices, never a prompt",
      JSON.stringify(settingsSummary("ai_background", { preset: "", prompt: "secret words", format: "png" })) === JSON.stringify({ format: "png", custom: "1" }));
    const page = readFileSync("app/(app)/tools/[slug]/page.tsx", "utf8");
    check("the page hands the panel publicPresets(...), not the stored list", page.includes("presets={publicPresets(presets, locale)}"));
    const panel = readFileSync("components/tools/photo-tool.tsx", "utf8");
    check("the panel never imports the preset parser or the presets RPC",
      !panel.includes("parsePresets") && !panel.includes("ai_background_presets") && !panel.includes("readAiBackgroundPresets"));
  }

  console.log("\nF. PHOTO INTAKE AND THE CUTOUT CHECK");
  {
    const same = await prepareInput(JPEG, "remove_bg");
    check("an upright JPEG goes byte for byte", same?.bytes === JPEG && same?.mime === "image/jpeg");
    const rotated = await sharp(JPEG).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const fixed = await prepareInput(rotated, "remove_bg");
    const fm = fixed ? await sharp(fixed.bytes).metadata() : null;
    check("an EXIF-rotated opaque photo is turned upright, as a q95 4:4:4 JPEG (not a heavy PNG)",
      fixed?.mime === "image/jpeg" && fm?.width === 300 && fm?.height === 400 && fm?.chromaSubsampling === "4:4:4", fm);
    const rotatedCut = await sharp(CUTOUT).withMetadata({ orientation: 6 }).png().toBuffer();
    const fixedCut = await prepareInput(rotatedCut, "remove_bg");
    check("an EXIF-rotated cutout keeps its transparency, losslessly (PNG)",
      fixedCut?.mime === "image/png" && (await sharp(fixedCut.bytes).metadata()).hasAlpha === true, fixedCut?.mime);
    // A photo whose lossless form is far over the runner's 15 MB cap: noise,
    // with alpha, re-encoded because it is rotated.
    const side = 2400;
    const noise = randomBytes(side * side * 4);
    const heavy = await sharp(noise, { raw: { width: side, height: side, channels: 4 } }).withMetadata({ orientation: 3 }).png({ compressionLevel: 1 }).toBuffer();
    const lossless = await sharp(heavy).rotate().png({ compressionLevel: 9 }).toBuffer();
    check("(the test photo's lossless form really is over the cap)", lossless.length > MAX_INPUT_BYTES, (lossless.length / 1e6).toFixed(1));
    const light = await prepareInput(heavy, "remove_bg");
    check(`a re-encode never exceeds the runner's cap (${MAX_INPUT_BYTES / 1024 / 1024} MB): it steps down, same pixels`,
      !!light && light.mime === "image/webp" && light.bytes.length <= MAX_INPUT_BYTES && (await sharp(light.bytes).metadata()).width === side,
      { mime: light?.mime, mb: light ? (light.bytes.length / 1e6).toFixed(1) : null, inMb: (heavy.length / 1e6).toFixed(1) });
    const big = await sharp({ create: { width: 5400, height: 2000, channels: 3, background: "#888" } }).jpeg().toBuffer();
    const small = await prepareInput(big, "ai_shadow");
    const sm = small ? await sharp(small.bytes).metadata() : null;
    check(`an oversized photo is reduced to ${MAX_SIDE.ai_shadow} px, never cropped`,
      sm?.width === MAX_SIDE.ai_shadow && sm?.height === Math.round(2000 * MAX_SIDE.ai_shadow / 5400), sm);
    check("not an image → refused", (await prepareInput(Buffer.from("hello"), "remove_bg")) === null);
    check("a cut-out PNG is recognised", await hasRealTransparency(CUTOUT));
    check("an opaque JPEG is not", !(await hasRealTransparency(JPEG)));
    const halo = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } })
      .composite([{ input: Buffer.from([0, 0, 0, 0]), raw: { width: 1, height: 1, channels: 4 }, tile: true, left: 0, top: 0, blend: "dest-in" }])
      .png().toBuffer().catch(() => null);
    // An opaque PNG with an alpha channel (nothing transparent) is not a cutout.
    const opaqueAlpha = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } }).png().toBuffer();
    check("an alpha channel alone is not a cutout", !(await hasRealTransparency(opaqueAlpha)), halo ? "ok" : "n/a");
    check("source paths stay inside the workspace", validSourcePath("w1/photo-tools/a.png", "w1")
      && !validSourcePath("w2/photo-tools/a.png", "w1") && !validSourcePath("w1/../w2/a.png", "w1") && !validSourcePath("w1/a b.png", "w1"));
  }

  console.log("\nG. THE PRICE PROPOSAL THE ADMIN CARD SHOWS");
  {
    const cheapest = 29900 / 3000 / 100; // Business pack incl. bonus: 0.0997 zł
    const at = (usd: number, pln: number) => creditsForCost(usd, { ...DEFAULT_BILLING, plnPerCredit: pln });
    check("$0.02 at the cheapest gross credit → 2 credits minimum", at(0.02, cheapest) === 2, at(0.02, cheapest));
    check("$0.02 net of VAT → 3", at(0.02, cheapest / 1.23) === 3, at(0.02, cheapest / 1.23));
    check("$0.10 at the cheapest gross credit → 9", at(0.10, cheapest) === 9, at(0.10, cheapest));
    check("$0.10 net of VAT → 12", at(0.10, cheapest / 1.23) === 12, at(0.10, cheapest / 1.23));
    check("today's automatic price is set at the reference credit (0.19 zł)",
      creditsForCost(0.02, DEFAULT_BILLING) === 1 && creditsForCost(0.10, DEFAULT_BILLING) === 5);
  }

  console.log("\nH. THE MIGRATION IS ADDITIVE");
  {
    const sql = readFileSync("supabase/migrations/0138_photo_tools.sql", "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
    check("no drop, delete or truncate", !/\b(drop|delete|truncate)\b/.test(code));
    check("no price is written (credits_cost untouched)", !code.includes("credits_cost"));
    check("the private denylist keeps its three keys and adds the presets",
      ["'notifications'", "'login_security_dispatch'", "'auth_email_hook'", "'ai_background_presets'"].every((k) => code.includes(k)));
    check("the presets reader is server-gated and closed to anon",
      code.includes("server_call_ok(p_token)") && code.includes("revoke all on function public.ai_background_presets_read(text) from public, anon"));
    check("eight scenes are seeded", (sql.match(/jsonb_build_object\('key', '/g) ?? []).length === 8);
    check("registry rows use on conflict do nothing", code.includes("on conflict (tool_key) do nothing"));
  }

  console.log("\nI. A RESULT IS KEPT AND LISTED — WITH A GRID COPY");
  {
    type Up = { path: string; type: string; bytes: number };
    const uploads: Up[] = [];
    const removed: string[][] = [];
    let rows: Row[] = [];
    let failInsert = false;
    const store = {
      storage: {
        from: () => ({
          upload: async (path: string, body: Buffer, o: { contentType: string }) => { uploads.push({ path, type: o.contentType, bytes: body.length }); return { error: null }; },
          remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
          createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
        }),
      },
      from: () => {
        const q = {
          insert: (row: Row) => { if (!failInsert) rows.push({ ...row, id: `row-${rows.length + 1}`, created_at: new Date().toISOString() }); return q; },
          select: () => q, eq: () => q, order: () => q, limit: () => q, lt: () => q,
          single: async () => (failInsert ? { data: null, error: { message: "denied" } } : { data: { id: rows[rows.length - 1]!.id }, error: null }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [...rows].reverse(), error: null }).then(res),
        };
        return q;
      },
    } as unknown as Parameters<typeof storeResult>[0];
    const big = await sharp({ create: { width: 2400, height: 1600, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } }).png().toBuffer();
    const hook = storeResult(store, { workspaceId: "w1", userId: "u1", tool: "remove_bg", sourcePath: "w1/photo-tools/a.jpg", guidancePath: null, settings: { format: "png" } });
    const res = await hook({ bytes: big, mime: "image/png", width: 2400, height: 1600, credits: 1, usageEventId: "ev", providerSlug: "photoroom", endpoint: "v1/segment", environment: "live", meta: { uncertainty: "0.7" } });
    const original = uploads.find((u) => u.type === "image/png");
    const thumb = uploads.find((u) => u.type === "image/webp");
    check("the original is stored untouched, byte count and all", original?.bytes === big.length, original);
    check("a 640 px WebP grid copy is written beside it", Boolean(thumb) && thumb!.path === original!.path.replace(/\.png$/, "_t.webp"), uploads);
    const md = rows[0]?.metadata as Row | undefined;
    check("the row records the thumb, the source, the endpoint and the uncertainty",
      res.ok && md?.thumb === thumb?.path && md?.source_path === "w1/photo-tools/a.jpg" && md?.endpoint === "v1/segment" && md?.uncertainty === "0.7", md);
    const listed = await listPhotoResults(store as never, "w1", "remove_bg");
    check("the gallery paints the thumbnail, downloads the original",
      listed.items[0]?.thumbUrl === `https://signed/${thumb?.path}` && listed.items[0]?.url === `https://signed/${original?.path}`, listed.items[0]);
    check("…and knows which photo it came from", listed.items[0]?.sourcePath === "w1/photo-tools/a.jpg" && listed.items[0]?.uncertainty === 0.7);
    failInsert = true;
    uploads.length = 0;
    const lost = await hook({ bytes: big, mime: "image/png", width: 2400, height: 1600, credits: 1, usageEventId: "ev", providerSlug: "photoroom", endpoint: "v1/segment", environment: "live", meta: {} });
    check("a row that cannot be written takes BOTH files back out (and the run is refunded)",
      !lost.ok && removed.at(-1)?.length === 2, removed.at(-1));
    const panel = readFileSync("components/tools/photo-tool.tsx", "utf8");
    check("the panel's tiles prefer the thumbnail, falling back to the original", panel.includes("item.thumbUrl ?? item.url"));

    // The press token: stored with the result, and how a retry finds it.
    rows = []; failInsert = false;
    const pressed = storeResult(store, { workspaceId: "w1", userId: "u1", tool: "ai_shadow", sourcePath: "w1/photo-tools/b.jpg", guidancePath: null, settings: {}, attempt: "press-1" });
    await pressed({ bytes: big, mime: "image/png", width: 2400, height: 1600, credits: 5, usageEventId: "ev", providerSlug: "photoroom", endpoint: "v2/edit", environment: "live", meta: {} });
    check("the row records the press token", (rows[0]?.metadata as Row | undefined)?.attempt === "press-1", rows[0]?.metadata);
    const seen: [string, unknown][] = [];
    const lookup = {
      from: (table: string) => {
        seen.push(["table", table]);
        const q = {
          select: () => q, order: () => q, limit: () => q,
          eq: (k: string, v: unknown) => { seen.push([k, v]); return q; },
          maybeSingle: async () => ({ data: { id: "r9", storage_path: "w1/tools/r9.png", mime_type: "image/png", file_size: 10, metadata: { credits: 5 } }, error: null }),
        };
        return q;
      },
    } as unknown as Parameters<typeof findDelivered>[0];
    const found = await findDelivered(lookup, { workspaceId: "w1", tool: "ai_shadow", sourcePath: "w1/photo-tools/b.jpg", attempt: "press-1" });
    const f = Object.fromEntries(seen);
    check("findDelivered matches workspace, tool, photo AND press",
      f.table === "tool_results" && f.workspace_id === "w1" && f.tool_slug === "ai_shadow"
      && f["metadata->>source_path"] === "w1/photo-tools/b.jpg" && f["metadata->>attempt"] === "press-1" && found?.id === "r9", seen);
    seen.length = 0;
    check("no press token → no lookup at all",
      (await findDelivered(lookup, { workspaceId: "w1", tool: "ai_shadow", sourcePath: "w1/photo-tools/b.jpg", attempt: "" })) === null && seen.length === 0);
  }

  console.log("\nJ. THE ROUTE, THE PANEL AND THE SAVE — WIRING THAT MUST STAY");
  {
    const route = readFileSync("app/api/tools/photo/route.ts", "utf8");
    check("the photo route has no time bucket in its key", !route.includes("DEDUPE_WINDOW_MS") && /return `photo:\$\{workspaceId\}:\$\{digest\}`/.test(route));
    check("…answers a delivered press from storage before loading anything",
      route.indexOf("findDelivered(supabase, press)") < route.indexOf("loadSource(supabase, sourcePath)"));
    check("…asks again once the key is held (alreadyDelivered)", route.includes("alreadyDelivered: attempt ?"));
    check("…refuses a re-encode over the cap as image_too_large", (route.match(/bytes\.length > MAX_INPUT_BYTES/g) ?? []).length === 2);
    const runRoute = readFileSync("app/api/tools/run/route.ts", "utf8");
    check("/api/tools/run honours the white_bg / ai_* screens' own switches",
      runRoute.includes("featureForPhotoTool(tool.slug)") && runRoute.includes('tool.slug !== "remove_bg"'));
    const panel = readFileSync("components/tools/photo-tool.tsx", "utf8");
    check("the panel validates the HEX the field shows", panel.includes("const colorOk = HEX_RE.test(hexDraft)"));
    check("the sandbox notice needs a runnable tool", panel.includes('const sandbox = available && environment === "sandbox"'));
    check("an unavailable tool takes no uploads and shows no price",
      panel.includes("{available && <PhotoUploader") && panel.includes("enabled: available && !busy") && panel.includes("{!available ? ("));
    check("a recovery matches the press, not just the photo", panel.includes("i.sourcePath === job.path && i.attempt === job.attempt"));
    check("a retry looks before it runs", /async function retry[\s\S]{0,400}await recovered\(job\)[\s\S]{0,200}await runOne\(job\)/.test(panel));
    check("credits come off the shown balance once per job", panel.includes("charged.current.has(job.key)"));
    check("local previews are released", panel.includes("URL.revokeObjectURL"));
    const action = readFileSync("app/actions/ai-background-presets.ts", "utf8");
    check("the presets save fails closed until 0138 (probe before upsert)",
      action.indexOf('rpc("ai_background_presets_read"') > 0 && action.indexOf('rpc("ai_background_presets_read"') < action.indexOf(".upsert(")
      && action.includes('"migration_pending"'));
    const sql = readFileSync("supabase/migrations/0138_photo_tools.sql", "utf8");
    check("the migration says it goes BEFORE the deploy", sql.includes("APPLY IT BEFORE THE DEPLOY"));
  }

  globalThis.fetch = realFetch;
  console.log(failures === 0 ? "\nAll photo tool tests passed.\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
