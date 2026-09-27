import "server-only";
import type { Client } from "@/lib/services/workspace";
import { ensureDispatchHash } from "@/lib/server/integrations";
import { promptKeyring, resetPromptKeyCache, type PromptKeyring } from "@/lib/server/prompt-vault";
import type { PromptVersionRow } from "@/lib/services/ai-tools";

/**
 * The prompt keyring for an ADMIN write (save, publish, restore, curate).
 *
 * The Vault key is handed out against the server's prompt-key token, pinned
 * by the database on the server's first call — and that first call must also
 * pass the generic proof-of-server, checked against the dispatch hash in
 * app_settings. If that hash is stale when nothing is pinned yet, the first
 * call fails closed. An admin session is allowed to publish the hash (the same
 * self-heal the credential panel uses), so one retry after republishing turns
 * it into a non-event instead of a blocked editor. Once pinned, the hash no
 * longer matters to this key. Customer paths never do this: they cannot write
 * app_settings.
 */
export async function adminPromptKeyring(supabase: Client): Promise<PromptKeyring> {
  const ring = await promptKeyring(supabase);
  if (ring.canSeal) return ring;
  try { await ensureDispatchHash(supabase); } catch { /* the retry below reports */ }
  resetPromptKeyCache();
  return promptKeyring(supabase);
}

/**
 * Which key opens each listed version, for the history badges — computed on
 * the server, returned as a state per id and nothing else: no body, no
 * ciphertext leaves this function. Read-only (no self-heal write on a page
 * render). Without the Vault key a row that does not open is left WITHOUT a
 * state rather than marked unreadable: the key is missing, not the prompt,
 * and the row's actions (which do self-heal) stay available.
 */
export async function withKeyStates(supabase: Client, versions: PromptVersionRow[]): Promise<PromptVersionRow[]> {
  if (versions.length === 0) return versions;
  const { data } = await supabase.from("ai_tool_prompts")
    .select("id, body_encrypted, body_iv, body_tag").in("id", versions.map((v) => v.id));
  const ring = await promptKeyring(supabase);
  const state = new Map<string, PromptVersionRow["keyState"]>();
  for (const r of data ?? []) {
    const opened = ring.open({ ciphertext: r.body_encrypted, iv: r.body_iv, authTag: r.body_tag });
    if (opened) state.set(r.id, opened.source);
    else if (ring.canSeal) state.set(r.id, "unreadable");
  }
  return versions.map((v) => ({ ...v, keyState: state.get(v.id) }));
}
