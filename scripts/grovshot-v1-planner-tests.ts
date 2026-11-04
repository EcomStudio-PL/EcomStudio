/**
 * GROVSHOT V1 — its own planner (app_settings.generation.grovshot_planner).
 * The production failure of 04.11 (prompt_sessions b9bd4b6d…): the GrovShot
 * session asked OpenAI gpt-5 (the shared planner chain's primary) and died on
 * analysis_quota. With grovshot_planner set, GrovShot asks exactly the chosen
 * Claude model and nothing else; unset, the shared chain is unchanged.
 */
import { grovshotPlannerBackends, textCapableBackends } from "@/lib/server/prompt-engine";

let failures = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failures++; console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
}

type Row = Record<string, unknown>;
function fakeClient(generation: Row, providers: { id: string; slug: string; active: boolean }[]) {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let inFilter: [string, unknown[]] | null = null;
    const rows = () => (table === "app_settings" ? [{ key: "generation", value: generation }] : table === "ai_providers" ? providers : [])
      .filter((r) => filters.every(([k, v]) => (r as Row)[k] === v) && (!inFilter || inFilter[1].includes((r as Row)[inFilter[0]])));
    const api = {
      select() { return api; },
      eq(k: string, v: unknown) { filters.push([k, v]); return api; },
      in(k: string, v: unknown[]) { inFilter = [k, v]; return api; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
      then<A>(res: (v: { data: unknown; error: null }) => A) { return Promise.resolve({ data: rows(), error: null }).then(res); },
    };
    return api;
  };
  return {
    from,
    async rpc(name: string, args: Row) {
      if (name === "provider_credential_read") return { data: [{ base_url: null, encrypted_value: "vault", provider_id: args.p_provider_id }], error: null };
      return { data: null, error: { message: "unknown" } };
    },
  } as never;
}

const providers = [
  { id: "p-openai", slug: "openai", active: true },
  { id: "p-google", slug: "google", active: true },
  { id: "p-anthropic", slug: "anthropic", active: true },
];

async function main() {
  console.log("\nGROVSHOT V1 PLANNER");
  const shared = { planner_provider: "openai", planner_fallback: "" };
  const before = await grovshotPlannerBackends(fakeClient(shared, providers), "gemini-x");
  check("P1 without its own planner GrovShot keeps the shared chain (as before: OpenAI here)",
    before.length === 1 && before[0].provider === "openai", before.map((b) => b.provider));

  const own = { ...shared, grovshot_planner: { provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" } };
  const after = await grovshotPlannerBackends(fakeClient(own, providers), "gemini-x");
  check("P2 with grovshot_planner = Claude: exactly that model and effort, nothing else (no hidden GPT fallback)",
    after.length === 1 && after[0].provider === "anthropic" && after[0].model === "claude-sonnet-5-5" && after[0].effort === "medium"
    && after[0].cred.apiKey === "sk-test-p-anthropic", after.map((b) => ({ p: b.provider, m: b.model, e: b.effort })));

  const off = await grovshotPlannerBackends(fakeClient(own, providers.map((p) => (p.slug === "anthropic" ? { ...p, active: false } : p))), "gemini-x");
  check("P3 Anthropic switched off: no backend at all (the session reports analysis_unavailable, never falls to OpenAI)", off.length === 0, off.map((b) => b.provider));

  const bad = await grovshotPlannerBackends(fakeClient({ ...shared, grovshot_planner: { provider: "anthropic", model: "gpt-5" } }, providers), "gemini-x");
  check("P4 a model id outside the Claude list is refused (no backend), not passed to the API", bad.length === 0);

  const others = await textCapableBackends(fakeClient(own, providers));
  check("P5 the other text tools (workflow, tool runs, GrovNews) keep the shared chain even with GrovShot's own planner set",
    others.length === 1 && others[0].provider === "openai", others.map((b) => b.provider));

  console.log(`\n${passed} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
