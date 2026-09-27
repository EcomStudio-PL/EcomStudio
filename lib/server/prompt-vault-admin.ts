import "server-only";
import type { Client } from "@/lib/services/workspace";
import { ensureDispatchHash } from "@/lib/server/integrations";
import { promptKeyring, resetPromptKeyCache, type PromptKeyring } from "@/lib/server/prompt-vault";
import type { PromptVersionRow } from "@/lib/services/ai-tools";

/**
 * The prompt keyring for an ADMIN write (save, publish, restore, curate).
 *
 * The Vault key is handed out against the proof-of-server token, which the
 * database checks against the hash published in app_settings. If that hash is
 * stale — the server key was rotated and nothing has republished it yet —
 * every token-gated call fails closed. An admin session is allowed to publish
 * it (the same self-heal the credential panel uses), so one retry after
 * republishing turns a rotated key into a non-event instead of a blocked
 * editor. Customer paths never do this: they cannot write app_settings.
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
 * render); an unobtainable key simply shows the rows as they are.
 */
export async function withKeyStates(supabase: Client, versions: PromptVersionRow[]): Promise<PromptVersionRow[]> {
  if (versions.length === 0) return versions;
  const { data } = await supabase.from("ai_tool_prompts")
    .select("id, body_encrypted, body_iv, body_tag").in("id", versions.map((v) => v.id));
  const ring = await promptKeyring(supabase);
  const state = new Map<string, PromptVersionRow["keyState"]>();
  for (const r of data ?? []) {
    const opened = ring.open({ ciphertext: r.body_encrypted, iv: r.body_iv, authTag: r.body_tag });
    state.set(r.id, opened ? opened.source : "unreadable");
  }
  return versions.map((v) => ({ ...v, keyState: state.get(v.id) }));
}
