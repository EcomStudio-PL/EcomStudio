import "server-only";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@/lib/server/crypto";
import { readProviderKey } from "@/lib/server/provider-credentials";
import { dispatchToken } from "@/lib/server/integrations";
import { rankCandidates, type KnowledgeStrategy } from "@/lib/ai/knowledge-ranking";

/**
 * KNOWLEDGE BASE — the engine's memory of past reference sets.
 *
 * Retrieval runs during a CUSTOMER-triggered session, so everything it can
 * pull through PostgREST is ciphertext (see migration 0042): the definer
 * RPCs return encrypted hints/rules and the plaintext exists only behind
 * admin-only RLS. Decryption happens here, server-side, with the same
 * APP_ENCRYPTION_KEY that seals concept prompts — a customer calling the
 * RPCs directly holds bytes they cannot read.
 *
 * All functions are failure-safe: no key, no OpenAI credential, no vector —
 * the engine simply plans without hints, never errors.
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

async function openaiKey(supabase: Client): Promise<{ apiKey: string; baseUrl: string } | null> {
  const { data: provider } = await supabase
    .from("ai_providers").select("id").eq("slug", "openai").eq("active", true).maybeSingle();
  if (!provider) return null;
  const { data: rows } = await supabase.rpc("provider_credential_read", { p_token: dispatchToken(), p_provider_id: provider.id });
  const cred = rows?.[0];
  if (!cred) return null;
  const apiKey = await readProviderKey(supabase, provider.id, cred);
  if (!apiKey) return null;
  return { apiKey, baseUrl: cred.base_url?.replace(/\/$/, "") || "https://api.openai.com" };
}

/** Batch-embed up to ~40 short texts. Returns null when embeddings are not
 *  available (no credential) — callers degrade gracefully. */
export async function embedTexts(supabase: Client, texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const cred = await openaiKey(supabase);
  if (!cred) return null;
  const input = texts.map((t) => t.replace(/\s+/g, " ").trim().slice(0, 6000) || " ");
  const res = await fetch(`${cred.baseUrl}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cred.apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const json = await res.json().catch(() => null) as { data?: { index: number; embedding: number[] }[] } | null;
  if (!json?.data) return null;
  const out: number[][] = new Array(texts.length);
  for (const d of json.data) out[d.index] = d.embedding;
  return out.every((v) => Array.isArray(v) && v.length === EMBEDDING_DIMS) ? out : null;
}

/** Distill one example into the engine-facing hint and seal it. The hint is
 *  intentionally terse: what to reproduce, what to avoid, how it was fixed —
 *  never the whole historical prompt verbatim. */
export function buildHintCiphertext(example: {
  category?: string | null;
  prompt_used?: string | null;
  what_worked?: string | null;
  what_failed?: string | null;
  correction?: string | null;
  scene?: string | null;
}): { ciphertext: string; iv: string; authTag: string } | null {
  const parts: string[] = [];
  if (example.scene?.trim()) parts.push(`Scena: ${example.scene.trim().slice(0, 240)}`);
  if (example.what_worked?.trim()) parts.push(`Sprawdziło się: ${example.what_worked.trim()}`);
  if (example.what_failed?.trim()) parts.push(`Unikaj: ${example.what_failed.trim()}`);
  if (example.correction?.trim()) parts.push(`Poprawka: ${example.correction.trim()}`);
  if (example.prompt_used?.trim()) parts.push(`Fragment działającego promptu: ${example.prompt_used.trim().slice(0, 240)}`);
  const text = parts.join(" · ").slice(0, 700);
  if (!text || !encryptionAvailable()) return null;
  const prefix = example.category?.trim() ? `[${example.category.trim().slice(0, 60)}] ` : "";
  return encryptSecret(prefix + text);
}

export type KnowledgeHints = { hints: string[]; exampleIds: string[] };

/** Top-K most similar curated examples for this product, decrypted. */
export async function retrieveKnowledgeHints(
  supabase: Client, queryText: string, topK = 3,
): Promise<KnowledgeHints> {
  const empty: KnowledgeHints = { hints: [], exampleIds: [] };
  try {
    if (!queryText.trim() || !encryptionAvailable()) return empty;
    const embedded = await embedTexts(supabase, [queryText]);
    const vector = embedded?.[0];
    if (!vector) return empty;
    const { data } = await supabase.rpc("knowledge_match", {
      p_token: dispatchToken(),
      p_embedding: JSON.stringify(vector) as unknown as string,
      p_top_k: topK,
    });
    // The relevance floor and the ordering live in the RPC (migration 0043):
    // no score crosses the boundary, so a customer session cannot use this
    // as a similarity oracle against the curated knowledge base.
    const rows = (data ?? []) as {
      id: string;
      hint_encrypted: string | null; hint_iv: string | null; hint_tag: string | null;
    }[];
    const hints: string[] = [];
    const ids: string[] = [];
    for (const r of rows) {
      if (!r.hint_encrypted || !r.hint_iv || !r.hint_tag) continue;
      try {
        hints.push(decryptSecret(r.hint_encrypted, r.hint_iv, r.hint_tag));
        ids.push(r.id);
      } catch { /* sealed with an older key — skip */ }
      if (hints.length >= topK) break;
    }
    return { hints, exampleIds: ids };
  } catch {
    return empty;
  }
}

export type ToolKnowledge = KnowledgeHints & {
  /** The scene of the best-ranked example that has one — a candidate scene,
   *  still untrusted data wherever it is placed. */
  scene: string | null;
  sceneExampleId: string | null;
};

/**
 * TOOL-SCOPED RETRIEVAL. Only sets ASSIGNED to this tool, only APPROVED and
 * ENABLED examples in READY sets (all enforced in SQL, migration 0126). The
 * ranking is `rankCandidates` — relevance plus a Bayesian quality score, so
 * 👍/👎 reorder examples without ever touching a prompt.
 *
 * Relevance gates are the original matcher's: a query vector is required and
 * an example must be embedded and at least 0.25 similar. Never throws; an
 * empty result is a normal outcome.
 */
export async function retrieveToolKnowledge(
  supabase: Client,
  toolKey: string,
  queryText: string,
  opts: { strategy: KnowledgeStrategy; seed: string; topK?: number },
): Promise<ToolKnowledge> {
  const empty: ToolKnowledge = { hints: [], exampleIds: [], scene: null, sceneExampleId: null };
  try {
    if (!encryptionAvailable() || !queryText.trim()) return empty;
    // Relevance first, as the original matcher: no query vector (no OpenAI
    // credential, no text) means no hints — never "some hint, unrelated".
    const vector = (await embedTexts(supabase, [queryText]))?.[0] ?? null;
    if (!vector) return empty;
    const { data, error } = await supabase.rpc("knowledge_candidates", {
      p_token: dispatchToken(),
      p_tool_key: toolKey,
      p_embedding: vector ? (JSON.stringify(vector) as unknown as string) : null,
      p_limit: 20,
    });
    if (error || !data?.length) return empty;
    // Below this similarity an example is about something else entirely —
    // the same floor the original matcher used.
    const pool = data.filter((r) => typeof r.similarity === "number" && r.similarity >= 0.25);
    const ranked = rankCandidates(
      pool.map((r) => ({
        id: r.id, similarity: r.similarity, resultRating: r.result_rating,
        usageCount: r.usage_count, positiveCount: r.positive_count,
        negativeCount: r.negative_count, scene: r.scene,
      })),
      { strategy: opts.strategy, topK: opts.topK ?? 3, seed: opts.seed },
    );
    const byId = new Map(pool.map((r) => [r.id, r]));
    const hints: string[] = [];
    const ids: string[] = [];
    let scene: string | null = null;
    let sceneExampleId: string | null = null;
    for (const c of ranked) {
      const r = byId.get(c.id);
      if (!r) continue;
      try {
        hints.push(decryptSecret(r.hint_encrypted, r.hint_iv, r.hint_tag));
        ids.push(r.id);
        if (!scene && r.scene?.trim()) { scene = r.scene.trim(); sceneExampleId = r.id; }
      } catch { /* sealed with an older key — skip */ }
    }
    return { hints, exampleIds: ids, scene, sceneExampleId };
  } catch {
    return empty;
  }
}

/** Admin-authored engine directives, decrypted, priority order, bounded. */
export async function getEngineRuleDirectives(supabase: Client): Promise<string[]> {
  try {
    if (!encryptionAvailable()) return [];
    const { data } = await supabase.rpc("engine_rules_read", { p_token: dispatchToken() });
    const rows = (data ?? []) as {
      id: string;
      content_encrypted: string | null; content_iv: string | null; content_tag: string | null;
    }[];
    const out: string[] = [];
    let budget = 1200;
    for (const r of rows) {
      if (!r.content_encrypted || !r.content_iv || !r.content_tag) continue;
      try {
        const text = decryptSecret(r.content_encrypted, r.content_iv, r.content_tag).slice(0, 400);
        // A long high-priority rule must not starve the shorter ones behind
        // it: skip what does not fit, keep filling the budget.
        if (text.length > budget) continue;
        budget -= text.length;
        // The "Unikaj:" framing is sealed into the ciphertext at save time,
        // so the RPC never has to hand the rule taxonomy to the client.
        out.push(text);
      } catch { /* older key — skip */ }
    }
    return out;
  } catch {
    return [];
  }
}
