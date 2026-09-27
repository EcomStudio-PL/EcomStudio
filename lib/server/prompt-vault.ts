import "server-only";
import type { Client } from "@/lib/services/workspace";
import { decryptSecret, decryptWith, encryptWith, encryptionAvailable } from "@/lib/server/crypto";
import { dispatchToken, promptKeyToken } from "@/lib/server/server-token";

/**
 * THE PROMPT KEY — one key for every piece of GrovBase prompt content.
 *
 * Tool system prompts, workflow step prompts, GrovShot's intermediate prompts,
 * knowledge hints and engine rules are sealed with AES-256-GCM under ONE
 * master key held in Supabase Vault (`grovbase.prompts.master_key_v1`,
 * migration 0130). The database creates it once with a CSPRNG and hands it to
 * the server only — against the prompt-key token (promptKeyToken), whose hash
 * the database pins on the server's first call. Never a browser, never an
 * admin session: the dispatch token an admin can reach is not enough. No new
 * environment variable is involved — the token derives from the server secret
 * the deployment already has — so a deploy cannot lock the prompt editor by
 * missing one.
 *
 * Ciphertext keeps the format the columns always had (base64 ciphertext, iv,
 * tag), so nothing about storage changes. Rows sealed before this with
 * APP_ENCRYPTION_KEY are still OPENED with it when that variable exists (the
 * GCM tag makes a wrong-key attempt fail deterministically, so trying both is
 * safe); they are never written with it again.
 *
 * `import "server-only"` keeps the key — and anything opened with it — out of
 * every client bundle. Nothing here logs a key, a plaintext or a ciphertext.
 */

export type Sealed = { ciphertext: string; iv: string; authTag: string };

/** Which key opened a row: the Vault master key, or the legacy env key. */
export type KeySource = "vault" | "legacy";

/** Raised by `seal` when the Vault key cannot be obtained. The message is a
 *  stable code, safe to hand an admin — it never carries key material. */
export class PromptKeyError extends Error {
  constructor() {
    super("prompt_key_unavailable");
    this.name = "PromptKeyError";
  }
}

export type PromptKeyring = {
  /** True when new content can be sealed (the Vault key was obtained). */
  readonly canSeal: boolean;
  /** True when anything at all could be opened: the Vault key, or a legacy
   *  env key for rows sealed before it. Lets a reader skip paid work (an
   *  embeddings call) whose result it could not decrypt anyway. */
  readonly canOpen: boolean;
  /** Seal with the Vault key. Throws PromptKeyError when there is none —
   *  new content is NEVER sealed with the legacy env key. */
  seal(plaintext: string): Sealed;
  /** Open with the Vault key, then the legacy env key. Null when neither
   *  opens it (missing columns, tampered bytes, a key that no longer exists). */
  open(row: { ciphertext: string | null | undefined; iv: string | null | undefined; authTag: string | null | undefined }):
    { text: string; source: KeySource } | null;
};

const KEY_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * The key is immutable once created, so each server instance keeps it for a
 * while instead of asking Vault on every decrypt (a Retusz request resolves
 * its engine more than once). A failed fetch is never cached.
 */
const CACHE_MS = 10 * 60 * 1000;
let cached: { hex: string; at: number } | null = null;

/** Tests switch keys between cases; production never calls this. */
export function resetPromptKeyCache(): void {
  cached = null;
}

async function fetchKey(supabase: Client): Promise<string | null> {
  const keyToken = promptKeyToken();
  if (!keyToken) return null;
  try {
    // The dispatch token only matters on the very first call ever, when the
    // database pins the prompt-key token (it proves the pinner is the server).
    const { data, error } = await supabase.rpc("prompt_master_key", { p_token: dispatchToken(), p_key_token: keyToken });
    if (error || typeof data !== "string" || !KEY_HEX.test(data)) return null;
    return data;
  } catch {
    return null;
  }
}

/** The Vault key as 64 hex, or null. Never throws. */
export async function promptKeyHex(supabase: Client): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.hex;
  const hex = await fetchKey(supabase);
  if (hex) cached = { hex, at: Date.now() };
  return hex;
}

/** A keyring for one request: the key is fetched ONCE, and sealing/opening
 *  stay synchronous so they can run inside ordinary loops. Never throws. */
export async function promptKeyring(supabase: Client): Promise<PromptKeyring> {
  return keyringFor(await promptKeyHex(supabase));
}

/**
 * Why a row did not open. With the Vault key in hand, only a row sealed with
 * a key that no longer exists (or damaged bytes) fails — that row really is
 * unreadable. Without the Vault key nothing can be said about the row: the
 * key is what is missing, and the admin is told that instead of being told
 * an intact prompt is lost.
 */
export function unopenedError(ring: PromptKeyring): "legacy_unreadable" | "prompt_key_unavailable" {
  return ring.canSeal ? "legacy_unreadable" : "prompt_key_unavailable";
}

/** Build a keyring around a known key (or none). Exported for tests. */
export function keyringFor(vaultHex: string | null): PromptKeyring {
  const vault = vaultHex && KEY_HEX.test(vaultHex) ? vaultHex : null;
  return {
    canSeal: vault !== null,
    get canOpen() { return vault !== null || encryptionAvailable(); },
    seal(plaintext: string): Sealed {
      if (!vault) throw new PromptKeyError();
      return encryptWith(vault, plaintext);
    },
    open(row) {
      const { ciphertext, iv, authTag } = row;
      if (!ciphertext || !iv || !authTag) return null;
      if (vault) {
        try { return { text: decryptWith(vault, ciphertext, iv, authTag), source: "vault" }; } catch { /* not this key */ }
      }
      // Legacy rows: APP_ENCRYPTION_KEY, read at call time. Absent or wrong,
      // decryptSecret throws and the row reads as unreadable.
      try { return { text: decryptSecret(ciphertext, iv, authTag), source: "legacy" }; } catch { return null; }
    },
  };
}
