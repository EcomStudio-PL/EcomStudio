/**
 * GALLERY PER TOOL — checked without a browser and without a paid call.
 *
 *   A. the one mapping (lib/gallery-tools.ts): tools, their modes, legacy ops;
 *   B. the query a gallery runs (lib/server/gallery.ts) against a recording
 *      fake client: a tool → `tool_mode in (its modes)` IN THE QUERY, next to
 *      the workspace, the session tab, favourites and the cursor; the Library
 *      → no tool filter at all; the count uses the same scope;
 *   C. the endpoint: a tool is named, never modes; an unknown tool is refused;
 *   D. every surface asks for its own tool, and the in-progress tiles of a
 *      tool are exactly the modes its routes write as the slot's tool;
 *   E. the settings card: no sticky white band over the form.
 *
 * The derivation of `tool_mode` itself is proven in Postgres
 * (scripts/gallery-tool-mode-sql-tests.sh).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GALLERY_TOOLS, galleryModes, galleryToolForMode, galleryToolForOperation, isGalleryTool } from "@/lib/gallery-tools";
import { FASHION_TOOLS } from "@/lib/fashion-tools";
import { countGalleryResults, galleryScope, listGalleryItems } from "@/lib/server/gallery";
import type { Client } from "@/lib/services/workspace";

let failed = 0;
let passed = 0;
function section(title: string) { console.log(`\n${title}`); }
function check(name: string, ok: boolean, detail: unknown = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

type Call = [string, unknown[]];
/** A Supabase client that records every builder call and answers empty. */
function recorder() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(builder, {
    get(_t, prop: string) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 3 });
      return (...args: unknown[]) => { calls.push([prop, args]); return proxy; };
    },
  });
  const client = {
    from: (table: string) => { calls.push(["from", [table]]); return proxy; },
    rpc: async () => ({ data: [], error: null }),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  } as unknown as Client;
  const filters = () => calls.filter(([m]) => ["eq", "in", "is", "or", "lt", "gt"].includes(m));
  return { client, calls, filters };
}
const has = (calls: Call[], m: string, col: string, val?: unknown) =>
  calls.some(([mm, a]) => mm === m && a[0] === col && (val === undefined || JSON.stringify(a[1]) === JSON.stringify(val)));
const WS = "11111111-1111-4111-8111-111111111111";

async function main() {
  /* ── A ─────────────────────────────────────────────────────────────────── */
  section("A. the one mapping: tool → modes");
  check("GrovBase Shot owns BOTH tabs: GrovBase Shot 1.0 (prompts) and Stwórz zdjęcie (generator)",
    JSON.stringify(galleryModes("grovbase_shot")) === '["prompts","generator"]');
  check("Retusz owns retouch, Miniaturka ecommerce_thumbnail", galleryModes("retouch").join() === "retouch"
    && galleryModes("ecommerce_thumbnail").join() === "ecommerce_thumbnail");
  check("every Moda tool is a tool of its own (mode = tool key = operation)",
    FASHION_TOOLS.every((t) => isGalleryTool(t.toolKey) && galleryModes(t.toolKey).join() === t.toolKey && galleryToolForOperation(t.operation) === t.toolKey));
  const allModes = Object.values(GALLERY_TOOLS).flatMap((t) => [...t.modes]);
  check("no mode belongs to two tools", new Set(allModes).size === allModes.length, allModes);
  check("legacy ?op= lands on its tool (image_retouch → retouch, ecommerce_thumbnail → Miniaturka)",
    galleryToolForOperation("image_retouch") === "retouch" && galleryToolForOperation("ecommerce_thumbnail") === "ecommerce_thumbnail"
    && galleryToolForOperation("none") === null && galleryToolForOperation("whatever") === null);
  check("a mode's tool: prompts and generator → GrovBase Shot", galleryToolForMode("prompts") === "grovbase_shot" && galleryToolForMode("generator") === "grovbase_shot");
  check("an unknown or inherited name is not a tool", !isGalleryTool("library") && !isGalleryTool("toString") && !isGalleryTool("__proto__") && galleryModes("nope").length === 0);
  const copy = galleryModes("grovbase_shot");
  copy.push("retouch");
  check("a caller cannot widen a tool's modes (galleryModes returns a copy)", galleryModes("grovbase_shot").length === 2);

  /* ── B ─────────────────────────────────────────────────────────────────── */
  section("B. the gallery query — filtered in the database");
  {
    const r = recorder();
    await listGalleryItems(r.client, WS, { tool: "grovbase_shot", sessionType: "lifestyle", favorite: true, cursor: "2026-11-08T10:00:00.000Z|22222222-2222-4222-8222-222222222222" });
    check("GrovBase Shot: tool_mode in (prompts, generator) in the query", has(r.calls, "in", "generation_jobs.tool_mode", ["prompts", "generator"]));
    check("…together with the workspace, the session tab, favourites and the cursor (one query)",
      has(r.calls, "eq", "workspace_id", WS) && has(r.calls, "eq", "generation_jobs.prompt_sessions.session_type", "lifestyle")
      && has(r.calls, "eq", "favorite", true) && r.calls.some(([m]) => m === "or"));
  }
  {
    const r = recorder();
    await listGalleryItems(r.client, WS, { operation: "image_retouch" });
    check("Retusz (its page still sends the legacy operation): tool_mode in (retouch)", has(r.calls, "in", "generation_jobs.tool_mode", ["retouch"]));
  }
  {
    const r = recorder();
    await listGalleryItems(r.client, WS, {});
    check("the Library: every result of the workspace, no tool filter", has(r.calls, "eq", "workspace_id", WS)
      && !r.calls.some(([, a]) => String(a[0]).includes("tool_mode") || String(a[0]).includes("operation")));
  }
  {
    const r = recorder();
    await listGalleryItems(r.client, WS, { tool: "not_a_tool" as string });
    check("an unknown tool never reaches the query as a filter value", !r.calls.some(([, a]) => JSON.stringify(a).includes("not_a_tool")));
  }
  {
    const r = recorder();
    const n = await countGalleryResults(r.client, WS, null, "grovbase_shot");
    check("\"Wyniki (N)\" counts over the same scope", n === 3 && has(r.calls, "in", "generations.generation_jobs.tool_mode", ["prompts", "generator"]));
    const r2 = recorder();
    await countGalleryResults(r2.client, WS, "ecommerce_thumbnail");
    check("…and a legacy count by operation too", has(r2.calls, "in", "generations.generation_jobs.tool_mode", ["ecommerce_thumbnail"]));
  }
  check("galleryScope: a tool → its modes, a legacy op → its tool's, nothing → the Library (null)",
    JSON.stringify(galleryScope({ tool: "grovbase_shot" })) === '["prompts","generator"]' && galleryScope({ operation: "image_retouch" })?.join() === "retouch"
    && galleryScope({}) === null && galleryScope({ operation: "none" }) === null);

  /* ── C ─────────────────────────────────────────────────────────────────── */
  section("C. the endpoint");
  const route = read("app/api/generations/route.ts");
  check("?tool= is checked against the mapping and an unknown tool is refused (400), never widened to the Library",
    /isGalleryTool\(toolParam\)/.test(route) && /invalid_tool/.test(route) && /status: 400/.test(route));
  check("the client names a tool, never a list of modes (no modes parameter is read)", !/searchParams\.get\("modes?"\)/.test(route));
  check("the count and the page get the same tool", /countGalleryResults\(supabase, workspace\.id, op, tool\)/.test(route) && /\n\s+tool,\n/.test(route));
  check("still the member's own workspace (getCurrentWorkspace, then workspace.id in every query)",
    /getCurrentWorkspace\(supabase, user\.id\)/.test(route) && /listGalleryItems\(supabase, workspace\.id/.test(route));

  /* ── D ─────────────────────────────────────────────────────────────────── */
  section("D. every surface asks for its own tool");
  const ws = read("components/genv3/workspace.tsx");
  const studio = read("components/genv3/studio-page.tsx");
  const cat = read("app/(app)/k/[cat]/[wf]/page.tsx");
  check("the studio's first page: GrovBase Shot only", /tool: "grovbase_shot"/.test(studio));
  check("a category preset (the same engine): GrovBase Shot only", /listGalleryItems\(supabase, workspace\.id, \{ limit: GALLERY_PAGE_SIZE, tool: "grovbase_shot" \}\)/.test(cat));
  check("the studio: ONE gallery for both tabs, tool-scoped pages, newest results and in-progress tiles",
    (ws.match(/<GenerationGallery/g) ?? []).length === 1 && /tool=\{STUDIO_GALLERY_TOOL\}/.test(ws)
    && /\/api\/generations\?tool=\$\{STUDIO_GALLERY_TOOL\}/.test(ws) && /inflight=\{\{ tools: STUDIO_MODES \}\}/.test(ws));
  check("Miniaturka and Moda read their scope from the mapping",
    /tool=\{THUMBNAIL_TOOL_KEY\}/.test(read("components/thumbnail/workspace.tsx")) && /tool=\{config\.toolKey\}/.test(read("components/fashion/tool-workspace.tsx")));
  check("Retusz is untouched: its own operation, its own tiles", /operation="image_retouch"/.test(read("components/retouch/workspace.tsx"))
    && /inflight=\{\{ tools: \["retouch"\] \}\}/.test(read("components/retouch/workspace.tsx")));
  // The slot's tool each route writes = the mode of the tool whose gallery shows its tile.
  const slots: [string, RegExp, string][] = [
    ["app/api/generate/route.ts", /tool: "generator"/, "generator"],
    ["app/api/concepts/generate/route.ts", /tool: "prompts"/, "prompts"],
    ["app/api/generations/regenerate/route.ts", /tool: "prompts"/, "prompts"],
    ["app/api/retouch/route.ts", /tool: "retouch"/, "retouch"],
  ];
  check("each route's slot tool is a mode of the right tool (Stwórz → GrovBase Shot, concepts/retakes → GrovBase Shot, Retusz → Retusz)",
    slots.every(([f, re, mode]) => re.test(read(f)) && galleryToolForMode(mode) !== null)
    && galleryToolForMode("generator") === "grovbase_shot" && galleryToolForMode("retouch") === "retouch");
  check("GrovBase Shot V2 orders and the tile's paid retake are prompts-mode tiles",
    /tool: "prompts", operation: "grovshot_v2"/.test(ws) && /tool: "prompts", operation: "grovshot_v2"/.test(read("components/genv3/grovshot-regen.tsx")));
  const lib = read("app/(app)/library/page.tsx");
  check("the Library page is unchanged: no tool, no operation", /listGalleryItems\(supabase, workspace\.id, \{ limit: FIRST_PAGE, assetType: "image" \}\)/.test(lib));

  /* ── E ─────────────────────────────────────────────────────────────────── */
  section("E. the settings card");
  const frame = read("components/tool-frame/frame.tsx");
  const css = read("app/globals.css");
  check("no sticky surface-coloured gradient inside the settings card any more",
    !/bg-gradient-to-t from-\[rgb\(var\(--surface\)\)\]/.test(frame) && !/sticky bottom-0[^"]*-mt-10/.test(frame));
  check("\"more below\" is an inset shadow on the card itself (painted under the content, no click target), theme-matched",
    /fade && "tool-panel-more"/.test(frame) && /\.workspace \.panel\.tool-panel-more[\s\S]*inset 0 -14px/.test(css)
    && /\.dark \.workspace \.panel\.tool-panel-more[\s\S]*inset 0 -14px/.test(css) && !/tool-panel-more[^}]*rgb\(255 255 255/.test(css));
  check("the bar keeps its place right under the card (12px gap, same column)", /flex min-w-0 flex-col gap-3/.test(frame) && /\{bar\}/.test(frame));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
