import "server-only";
import { createHash, createHmac } from "node:crypto";
import { dispatchToken } from "@/lib/server/integrations";

/**
 * A KEYED DIGEST OF THE TEXT A MODEL WAS SENT.
 *
 * The job row records it so the admin can check "the text sent is the
 * published text" (Admin → narzędzie → Testuj konfigurację compares it with
 * the same digest of today's prompt). A plain SHA-256 would not do: job rows
 * are readable by the customer's own workspace, and a bare hash of GrovBase's
 * hidden prompt is something anyone could test guesses against. Keyed with a
 * server-only secret (domain-separated from its other use), it proves equality
 * to the server and nothing to anyone else. Null when the secret is missing.
 */
export function promptDigest(text: string): string | null {
  const token = dispatchToken();
  if (!token) return null;
  const key = createHash("sha256").update(`grovbase.prompt-digest.v1:${token}`).digest();
  return createHmac("sha256", key).update(text).digest("hex");
}
