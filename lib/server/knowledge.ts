import "server-only";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@/lib/server/crypto";

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
  if (!encryptionAvailable()) return null;
  const { data: provider } = await supabase
    .from("ai_providers").select("id").eq("slug", "openai").eq("active", true).maybeSingle();
  if (!provider) return null;
  const { data: rows } = await supabase.rpc("get_active_provider_credential", { p_provider_id: provider.id });
  const cred = rows?.[0];
  if (!cred) return null;
  try {
    return {
      apiKey: decryptSecret(cred.encrypted_value, cred.iv, cred.auth_tag),
      baseUrl: cred.base_url?.replace(/\/$/, "") || "https://api.openai.com",
    };
  } catch { return null; }
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
}): { ciphertext: string; iv: string; authTag: string } | null {
  const parts: string[] = [];
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
    const { data } = await supabase.rpc("match_knowledge_examples", {
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

/** Admin-authored engine directives, decrypted, priority order, bounded. */
export async function getEngineRuleDirectives(supabase: Client): Promise<string[]> {
  try {
    if (!encryptionAvailable()) return [];
    const { data } = await supabase.rpc("get_engine_rules");
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
