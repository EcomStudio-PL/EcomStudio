/** In-memory world for scripts/smart-prompt-tests.ts: the ledger (0100/0101
 *  semantics — the catalogue price, one charge per pending key, one refund),
 *  the provider chain and the cached analysis. */

export type SmartBackend = { provider: "google" | "openai"; cred: { apiKey: string; baseUrl?: string | null }; model?: string };
export type SmartEvent = {
  id: string; status: "pending" | "succeeded" | "failed"; credits_charged: number; idempotency_key: string | null;
  metadata: Record<string, unknown>; workspace_id: string; service_slug: string; refunded: boolean; api_cost: number | null;
  executor?: unknown; error?: string;
};

export type SmartState = {
  token: string | null;
  chain: SmartBackend[];
  named: SmartBackend[];
  backendCalls: { kind: "chain" | "for"; provider?: string; model?: string | null }[];
  analysis: string | null;
  analysisCalls: { workspaceId: string; hash: string; version: unknown }[];
  wallet: { id: string; balance: number } | null;
  events: SmartEvent[];
  usageCalls: { kind: string; args: Record<string, unknown> }[];
  providerCalls: Record<string, unknown>[];
  prices: { providerSlug: string; model: string; inputPerMTok: number; outputPerMTok: number }[];
  config: unknown;
  configError: boolean;
  service: { credits_cost: number; enabled: boolean; maintenance_mode: boolean } | null;
  activity: Record<string, unknown>[];
  seq: number;
};

let state: SmartState;

export function resetSmart(patch: Partial<SmartState> = {}): SmartState {
  state = {
    token: "server-token",
    chain: [{ provider: "openai", cred: { apiKey: "sk-chain" } }],
    named: [{ provider: "openai", cred: { apiKey: "sk-named" }, model: "gpt-5-mini" }],
    backendCalls: [],
    analysis: null,
    analysisCalls: [],
    wallet: { id: "wallet-1", balance: 10 },
    events: [],
    usageCalls: [],
    providerCalls: [],
    prices: [],
    config: { v: 1, provider: "openai", model: "gpt-5-mini", instruction: "" },
    configError: false,
    service: { credits_cost: 1, enabled: true, maintenance_mode: false },
    activity: [],
    seq: 0,
    ...patch,
  };
  return state;
}

export function smart(): SmartState { return state; }
export function nextId(prefix: string): string { state.seq += 1; return `${prefix}-${state.seq}`; }
