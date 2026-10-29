/** Test double of the prompt keyring: a reversible, clearly fake seal (the
 *  real one is AES-GCM under the Vault key). */
import { createHash } from "node:crypto";
import { gsv2Env } from "./gsv2-env";

export type Sealed = { ciphertext: string; iv: string; authTag: string };
export type PromptKeyring = {
  canSeal: boolean;
  seal(text: string): Sealed;
  open(s: { ciphertext: string | null; iv: string | null; authTag: string | null }): { text: string; source: "vault" | "legacy" } | null;
};
export class PromptKeyError extends Error {}
export function unopenedError(): string { return "prompt_key_unavailable"; }
export function resetPromptKeyCache(): void {}

const ring: PromptKeyring = {
  get canSeal() { return gsv2Env().ringUp; },
  seal(text) {
    const ciphertext = Buffer.from(text, "utf8").toString("base64");
    return { ciphertext, iv: "test-iv", authTag: createHash("sha256").update(ciphertext).digest("hex").slice(0, 32) };
  },
  open(s) {
    if (!gsv2Env().ringUp || !s.ciphertext) return null;
    if (createHash("sha256").update(s.ciphertext).digest("hex").slice(0, 32) !== s.authTag) return null;
    return { text: Buffer.from(s.ciphertext, "base64").toString("utf8"), source: "vault" };
  },
};

export async function promptKeyring(): Promise<PromptKeyring> { return ring; }
